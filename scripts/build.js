// Builds the site into site/: the English resume at the root and the Thai one in
// site/th/, each with its page, PDF and resume.json.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { pdf, render } from 'resumed'

const OUT = 'site'

// Show every employer the way the theme shows a company with several roles: the
// company name as the heading and each role or project under it. Otherwise a lone
// role's title is the heading and the company shrinks into the grey meta line.
const themeSource = readFileSync('node_modules/jsonresume-theme-even/dist/index.js', 'utf8')
const singleRoleLayout = 'const r = l.length === 1 ? l[0] : void 0;'
if (!themeSource.includes(singleRoleLayout)) throw new Error('jsonresume-theme-even changed; update the work layout patch')
mkdirSync('.theme', { recursive: true })
writeFileSync('.theme/even.js', themeSource.replace(singleRoleLayout, 'const r = void 0;'))
const theme = await import(pathToFileURL('.theme/even.js').href)

// Two-column layout (wide screens and the PDF): the header spans both columns and
// section titles sit left-aligned in a column just wide enough for "Certificates"
// (8.25rem), so less space is left empty on the left. The column is a fixed width
// because a content-sized one grows to fit the header.
const layoutCss = `<style>
@media print,screen and (min-width:48em){
  .masthead{grid-template-columns:subgrid}
  .masthead>*{grid-column:main}
  .masthead article{max-width:44em}
  h3{font-size:var(--scale2);text-align:left}
}
/* Each employer starts a clearly separate block under a divider. */
#work .stack>article+article{border-top:1px solid var(--color-dimmed);padding-top:1.5em}
#work article>header h4{font-size:var(--scale3)}
/* With one role, the role line already shows the duration. */
#work article:has(.timeline>div:only-child)>header time-duration{display:none}
</style>`
// The PDF uses block layout instead of the theme's grid, because Chrome does not
// keep grid items whole across pages. Same look: narrow page margins, titles in a
// left column, and bullets, headings and skill groups never split. Long roles and
// projects may break between bullets, since keeping them whole would leave big gaps.
const printCss = `<style>
@media print{
  body{display:block}
  .masthead{display:block;padding:3em 24px}
  .masthead>*+*{margin-top:1.5em}
  section{display:block;position:relative;margin:1.75em 24px 0;padding-left:calc(8.25rem + 1.5em)}
  section>h3{position:absolute;top:0;left:0;width:8.25rem}
  .stack{display:block}
  .stack>*+*{margin-top:1.5em}
  .grid-list{display:block}
  .grid-list>div{display:inline-block;vertical-align:top;width:calc(50% - .75em);margin:0 .5em .75em 0}
  li,article>header,.timeline>div>div:first-child,#education article,#certificates article,.tag-list{break-inside:avoid}
  h4,h5,article>header,.timeline>div>div:first-child{break-after:avoid}
  .tag-list{break-before:avoid}
  #work article>header h4{font-size:var(--scale2)}
  #work .stack>article+article{padding-top:1em}
}
</style>`
// The Thai page is for personal reading: keep it out of search results and stop
// crawlers following its links (to its PDF and JSON). Lato has no Thai glyphs, so it
// adds Noto Sans Thai for them (Latin text stays in Lato), with a little more line
// height for Thai vowels and tone marks.
const thaiCss = `<meta name="robots" content="noindex, nofollow"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap"><style>
body{font-family:Lato,"Noto Sans Thai",sans-serif;line-height:1.6}
h3{letter-spacing:normal!important}
</style>`

// The two versions don't link to each other: the Thai one is for personal reading.
await buildVersion({ file: 'resume.json', dir: OUT, pdfSuffix: '', thai: false, download: 'Download PDF' })
await buildVersion({ file: 'resume.th.json', dir: `${OUT}/th`, pdfSuffix: '-TH', thai: true, download: 'ดาวน์โหลด PDF' })

async function buildVersion({ file, dir, pdfSuffix, thai, download }) {
  const resume = JSON.parse(readFileSync(file, 'utf8'))
  const pdfName = `${resume.basics.name.replace(/\s+/g, '-')}-CV${pdfSuffix}.pdf`

  let html = addAwardKeywords(fixDates(await render(resume, theme)), resume.awards)
  if (thai) html = toThai(html)
  html = html.replace('</head>', `${layoutCss}${printCss}${thai ? thaiCss : ''}</head>`)

  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/index.html`, addActions(html, { pdfName, download }))
  copyFileSync(file, `${dir}/resume.json`)
  for (const icon of ['favicon.svg', 'apple-touch-icon.png']) copyFileSync(`assets/${icon}`, `${dir}/${icon}`)

  if (process.env.SKIP_PDF) {
    console.log(`Skipped PDF for ${dir} (SKIP_PDF is set)`)
  } else {
    // A4 for Thailand; printBackground keeps the header band; 95% scale keeps it short.
    const pdfRenderOptions = { format: 'A4', printBackground: true, scale: 0.95, margin: { top: '12mm', bottom: '12mm' } }
    writeFileSync(`${dir}/${pdfName}`, await pdf(html, resume, { ...theme, pdfRenderOptions }))
  }
  console.log(`Built ${dir}/`)
}

function fixDates(page) {
  return page
    // The theme shows a year-only date ("2018") as "Jan 2018"; show just the year.
    .replace(/<time datetime="(\d{4})">[^<]*<\/time>/g, '<time datetime="$1">$1</time>')
    // <time-duration> adds up every start/end pair it gets. That double-counts
    // overlapping projects at one company, so give it a single first-start to
    // last-end span. Drop it when that span depends on a year-only date, since
    // the months would be a guess.
    .replace(/<time-duration dates="([^"]*)"><\/time-duration>/g, (tag, dates) => {
      const yearOnly = (d) => /^\d{4}$/.test(d)
      const parts = dates.split('|')
      const starts = parts.filter((_, i) => i % 2 === 0).filter(Boolean)
      const ends = parts.filter((_, i) => i % 2 === 1)
      const first = starts.filter((d) => !yearOnly(d)).sort()[0]
      if (!first || starts.some((d) => yearOnly(d) && d < first.slice(0, 4))) return ''
      const ongoing = ends.some((d) => !d)
      if (!ongoing && ends.some(yearOnly)) return ''
      // Count the end month too (Feb-Jul is 6 months, as LinkedIn shows it);
      // the theme measures only up to the first day of the end month.
      const span = [first, ongoing ? '' : nextMonth(ends.sort().at(-1))]
      return `<time-duration dates="${span.join('|')}"></time-duration>`
    })
}

// The theme's own labels, dates and durations are English; translate them for the
// Thai page. Months use Thai names with Gregorian years, matching the content.
function toThai(page) {
  const headings = { Work: 'ประสบการณ์', Education: 'การศึกษา', Projects: 'โปรเจกต์', Awards: 'รางวัล', Certificates: 'ใบรับรอง', Skills: 'ทักษะ', Languages: 'ภาษา' }
  const month = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { month: 'short', year: 'numeric', timeZone: 'UTC' })

  page = mustReplace(page, '<html lang="en"', '<html lang="th"')
  page = mustReplace(page, "${num === 1 ? str : str.concat('s')}", '${str}')
  page = mustReplace(page, "pluralize(years, 'yr')", "pluralize(years, 'ปี')")
  page = mustReplace(page, "pluralize(months, 'mo')", "pluralize(months, 'เดือน')")
  page = mustReplace(page, "pluralize(days, 'day')", "pluralize(days, 'วัน')")
  for (const [en, th] of Object.entries(headings)) page = page.replaceAll(`<h3>${en}</h3>`, `<h3>${th}</h3>`)

  return page
    .replaceAll('– Present', '– ปัจจุบัน')
    .replaceAll('Awarded by <strong>', 'ได้รับจาก <strong>')
    .replaceAll('Issued by <strong>', 'ออกโดย <strong>')
    .replaceAll('at <strong>', 'ที่ <strong>')
    .replace(/<section id="education">[\s\S]*?<\/section>/, (section) => section.replaceAll(' in <strong>', ' สาขา<strong>'))
    .replace(/<time datetime="(\d{4}-\d{2})(-\d{2})?">[^<]*<\/time>/g, (tag, yearMonth, day = '') =>
      `<time datetime="${yearMonth}${day}">${month.format(new Date(`${yearMonth}-01T00:00:00Z`))}</time>`)
}

function mustReplace(source, from, to) {
  if (!source.includes(from)) throw new Error(`Thai page: theme output changed, "${from}" not found`)
  return source.replace(from, () => to)
}

// The theme shows no tech tags on awards, so add an award's keywords (an extra
// field in resume.json) as a tag list styled like the project tags.
function addAwardKeywords(page, awards = []) {
  for (const { title, keywords } of awards) {
    if (!keywords?.length) continue
    const start = page.indexOf(`<h4>${title}</h4>`)
    const end = page.indexOf('</article>', start)
    if (start === -1 || end === -1) throw new Error(`Could not find the award "${title}" to add its keywords`)
    const tags = `<ul class="tag-list">${keywords.map((k) => `<li>${k}</li>`).join('')}</ul>`
    page = page.slice(0, end) + tags + page.slice(end)
  }
  return page
}

function nextMonth(date) {
  const match = /^(\d{4})-(\d{2})$/.exec(date)
  if (!match) return date
  const [year, month] = [Number(match[1]), Number(match[2])]
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

// Web-only download links under the contact list, plus screen layout tweaks.
// Everything here is screen-only, so the PDF keeps the print layout.
function addActions(page, { pdfName, download }) {
  const icons = '<link rel="icon" type="image/png" sizes="180x180" href="apple-touch-icon.png"><link rel="icon" type="image/svg+xml" href="favicon.svg"><link rel="apple-touch-icon" href="apple-touch-icon.png">'
  const css = `${icons}<style>
.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.5rem}
.actions a{padding:.4rem .9rem;border:1px solid var(--color-accent);border-radius:999px;color:var(--color-accent);font-size:.875rem;text-decoration:none}
.actions a:hover,.actions a:focus-visible{background:var(--color-accent);color:var(--color-background)}
@media print{.actions{display:none}}

/* Phones: one left-aligned column with even side margins. */
@media screen and (max-width:47.99em){
  html{font-size:15px}
  body{column-gap:0;grid-template-columns:[full-start] 1.25rem [main-start side-start content-start] minmax(0,1fr) [side-end content-end main-end] 1.25rem [full-end]}
  .masthead{padding:2.5rem 0;text-align:left}
  .masthead h1{font-size:var(--scale4)}
  .masthead h2{font-size:var(--scale2)}
  .icon-list{flex-direction:column;justify-content:flex-start}
  h3{font-size:.85rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding-bottom:.4rem;border-bottom:1px solid var(--color-dimmed)}
  .grid-list h4{font-size:var(--scale1)}
  .timeline{padding-left:1.25rem}
}

/* Wider screens: larger text and a wider content column, closer to the PDF. */
@media screen and (min-width:48em){
  html{font-size:clamp(15px,calc(10px + .55vw),18px)}
  body{grid-template-columns:[full-start] minmax(1.5rem,1fr) [main-start side-start] 8.25rem [side-end content-start] minmax(0,46em) [main-end content-end] minmax(1.5rem,1fr) [full-end]}
}
</style>`
  const actions = `<div class="actions"><a href="${pdfName}" download>${download}</a><a href="resume.json" target="_blank" rel="noopener">JSON Resume</a></div>`

  const list = page.indexOf('<ul class="icon-list">')
  const listEnd = page.indexOf('</ul>', list)
  if (list === -1 || listEnd === -1) throw new Error('Could not find the contact list to add the download links after')
  const at = listEnd + '</ul>'.length
  return page.slice(0, at).replace('</head>', `${css}</head>`) + actions + page.slice(at)
}

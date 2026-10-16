// Builds the site into site/: index.html, the PDF and resume.json.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pdf, render } from 'resumed'
import * as theme from 'jsonresume-theme-even'

const OUT = 'site'

const resume = JSON.parse(readFileSync('resume.json', 'utf8'))
const pdfName = `${resume.basics.name.replace(/\s+/g, '-')}-CV.pdf`

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
}
</style>`
const html = fixDates(await render(resume, theme)).replace('</head>', `${layoutCss}${printCss}</head>`)

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/index.html`, addActions(html))
copyFileSync('resume.json', `${OUT}/resume.json`)
for (const icon of ['favicon.svg', 'apple-touch-icon.png']) copyFileSync(`assets/${icon}`, `${OUT}/${icon}`)

if (process.env.SKIP_PDF) {
  console.log('Skipped PDF (SKIP_PDF is set)')
} else {
  const pdfRenderOptions = { format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm' } }
  writeFileSync(`${OUT}/${pdfName}`, await pdf(html, resume, { ...theme, pdfRenderOptions }))
}
console.log(`Built ${OUT}/`)

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

function nextMonth(date) {
  const match = /^(\d{4})-(\d{2})$/.exec(date)
  if (!match) return date
  const [year, month] = [Number(match[1]), Number(match[2])]
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

// Web-only download links under the contact list, plus screen layout tweaks.
// Everything here is screen-only, so the PDF keeps the theme's print layout.
function addActions(page) {
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
  const actions = `<div class="actions"><a href="${pdfName}" download>Download PDF</a><a href="resume.json" target="_blank" rel="noopener">JSON Resume</a></div>`

  const list = page.indexOf('<ul class="icon-list">')
  const listEnd = page.indexOf('</ul>', list)
  if (list === -1 || listEnd === -1) throw new Error('Could not find the contact list to add the download links after')
  const at = listEnd + '</ul>'.length
  return page.slice(0, at).replace('</head>', `${css}</head>`) + actions + page.slice(at)
}

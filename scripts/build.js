// Builds the site into site/: index.html, the PDF and resume.json.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pdf, render } from 'resumed'
import * as theme from 'jsonresume-theme-even'

const OUT = 'site'

const resume = JSON.parse(readFileSync('resume.json', 'utf8'))
const pdfName = `${resume.basics.name.replace(/\s+/g, '-')}-CV.pdf`

// Keep each role, project and skill group on one page, and headings with what follows.
const printCss = '<style>@media print{.timeline>div,.stack>article>header,#education article,#projects article,.grid-list>div{break-inside:avoid}h3,h4,h5,article>header{break-after:avoid}}</style>'
const html = fixDates(await render(resume, theme)).replace('</head>', `${printCss}</head>`)

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/index.html`, addActions(html))
copyFileSync('resume.json', `${OUT}/resume.json`)

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
    // last-end span. Drop it when a date is year-only, since the months would be a guess.
    .replace(/<time-duration dates="([^"]*)"><\/time-duration>/g, (tag, dates) => {
      const parts = dates.split('|')
      const starts = parts.filter((_, i) => i % 2 === 0).filter(Boolean)
      const ends = parts.filter((_, i) => i % 2 === 1)
      if (!starts.length || parts.some((d) => /^\d{4}$/.test(d))) return ''
      const ongoing = ends.some((d) => !d)
      const span = [starts.sort()[0], ongoing ? '' : ends.sort().at(-1)]
      return `<time-duration dates="${span.join('|')}"></time-duration>`
    })
}

// Web-only download links under the contact list, hidden when printing.
function addActions(page) {
  const css = `<style>
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem;margin-top:1.5rem}
@media (min-width:48em){.actions{justify-content:flex-start}}
.actions a{padding:.4rem .9rem;border:1px solid var(--color-accent);border-radius:999px;color:var(--color-accent);font-size:.875rem;text-decoration:none}
.actions a:hover,.actions a:focus-visible{background:var(--color-accent);color:var(--color-background)}
@media print{.actions{display:none}}
</style>`
  const actions = `<div class="actions"><a href="${pdfName}" download>Download PDF</a><a href="resume.json" target="_blank" rel="noopener">JSON Resume</a></div>`

  const list = page.indexOf('<ul class="icon-list">')
  const listEnd = page.indexOf('</ul>', list)
  if (list === -1 || listEnd === -1) throw new Error('Could not find the contact list to add the download links after')
  const at = listEnd + '</ul>'.length
  return page.slice(0, at).replace('</head>', `${css}</head>`) + actions + page.slice(at)
}

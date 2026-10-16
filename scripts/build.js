// Builds the site into site/: index.html, the PDF and resume.json.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { pdf, render } from 'resumed'

const OUT = 'site'
const THEME_FILE = '.theme/index.js'

// The theme's date formatter turns a year-only date ("2018") into "Jan 2018" and
// prints "2017 - 2017" for a same-year range. Patch it to print just the year.
let datesPatched = false
const yearOnlyDates = {
  name: 'year-only-dates',
  setup(b) {
    b.onLoad({ filter: /@jsonresume[\\/]utils[\\/]src[\\/]dates\.js$/ }, ({ path }) => {
      datesPatched = true
      return {
        loader: 'jsx',
        contents: patch(readFileSync(path, 'utf8'), [
          ['    const isDateOnlyIso =', "    if (typeof dateStr === 'string' && /^\\d{4}$/.test(dateStr)) return dateStr;\n    const isDateOnlyIso ="],
          ['  return `${start} - ${end}`;', '  return start === end ? start : `${start} - ${end}`;'],
        ]),
      }
    })
  },
}

// The brutalist theme ships as JSX source, so bundle it into plain ESM first.
// styled-components must be bundled from its ESM build, or styled.div is undefined.
await build({
  entryPoints: ['node_modules/jsonresume-theme-brutalist/index.jsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  mainFields: ['module', 'main'],
  external: ['react', 'react-dom'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [yearOnlyDates],
  outfile: THEME_FILE,
  logLevel: 'warning',
})
if (!datesPatched) throw new Error('Theme no longer loads @jsonresume/utils/src/dates.js; update the date patch')
const theme = await import(pathToFileURL(THEME_FILE).href)

const resume = JSON.parse(readFileSync('resume.json', 'utf8'))
const { name, email } = resume.basics
const pdfName = `${name.replace(/\s+/g, '-')}-CV.pdf`

// The theme shows "Present" only for an explicit null endDate, which the schema
// rejects, so current jobs (no endDate in resume.json) are marked here instead.
const forTheme = { ...resume, work: resume.work?.map((job) => ({ endDate: null, ...job })) }

// The theme keeps each whole section on one page when printing, which leaves most
// of page 1 empty. Let sections flow across pages but keep each entry together.
const printCss = '<style>@media print{.resume-section{break-inside:auto!important;page-break-inside:auto!important}.resume-section>div{break-inside:avoid;page-break-inside:avoid}}</style>'
const html = (await render(forTheme, theme)).replace('</head>', `${printCss}</head>`)

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/index.html`, addToolbar(html))
copyFileSync('resume.json', `${OUT}/resume.json`)

if (process.env.SKIP_PDF) {
  console.log('Skipped PDF (SKIP_PDF is set)')
} else {
  // A4 for Thailand; printBackground keeps the theme's yellow and black blocks.
  const pdfRenderOptions = { format: 'A4', printBackground: true, scale: 0.85, margin: { top: '10mm', bottom: '10mm' } }
  const pdfTheme = { ...theme, pdfRenderOptions }
  writeFileSync(`${OUT}/${pdfName}`, await pdf(html, forTheme, pdfTheme))
}
console.log(`Built ${OUT}/`)

// Web-only extras: a download/contact bar above the header and a credits footer.
// Both are hidden when printing, so the PDF matches the theme exactly.
function addToolbar(page) {
  const css = `<style>
.toolbar,.credits{font-family:'Space Mono',monospace;text-transform:uppercase;letter-spacing:1px}
.toolbar{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;padding:12px 16px;border-top:4px solid #0a0a0a;border-bottom:2px solid #0a0a0a}
.toolbar a{padding:8px 14px;border:2px solid #0a0a0a;background:#0a0a0a;color:#fff;font-size:13px;font-weight:700;text-decoration:none;box-shadow:4px 4px 0 #ffe600}
.toolbar a:hover,.toolbar a:focus-visible{background:#ffe600;color:#0a0a0a;box-shadow:4px 4px 0 #0a0a0a;outline:none}
.credits{padding:16px;border-top:2px solid #0a0a0a;border-bottom:4px solid #0a0a0a;font-size:11px}
.credits a{color:#0a0a0a}
@media print{.toolbar,.credits{display:none}}
</style>`
  const links = [
    `<a href="${pdfName}" download>Download PDF</a>`,
    '<a href="resume.json" target="_blank" rel="noopener">JSON Resume</a>',
    email && `<a href="mailto:${email}">Email me</a>`,
  ]
  const toolbar = `<nav class="toolbar" aria-label="Actions">${links.filter(Boolean).join('')}</nav>`
  const credits = '<footer class="credits">Made with <a href="https://jsonresume.org">JSON Resume</a> and <a href="https://github.com/rbardini/resumed">resumed</a></footer>'

  return page
    .replace('</head>', `${css}</head>`)
    .replace('<header', `${toolbar}<header`)
    .replace('</main>', `</main>${credits}`)
}

function patch(source, replacements) {
  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`Theme date patch is out of date: "${from}" not found`)
    source = source.replace(from, () => to)
  }
  return source
}

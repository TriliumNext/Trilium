// Build script for Chrome extension using esbuild
// Content scripts MUST be IIFE format (no ES modules supported per research)

import * as esbuild from 'esbuild'
import { copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

//Clean dist folder
console.log('Cleaning dist folder...')
rmSync(resolve(__dirname, 'dist'), { recursive: true, force: true })
mkdirSync(resolve(__dirname, 'dist'), { recursive: true })

// Build content script as IIFE (REQUIRED - ES modules not supported)
console.log('Building content script as IIFE...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/content/index.ts')],
  bundle: true,
  format: 'iife', // CRITICAL: Content scripts MUST be IIFE
  outfile: resolve(__dirname, 'dist/content.js'),
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  minify: false, // Keep readable for debugging
})

// Build background script (can use ES modules but IIFE is safer for compatibility)
console.log('Building background script as IIFE...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/background/index.ts')],
  bundle: true, // This bundles DOMPurify and other dependencies for browser context
  format: 'iife', // Using IIFE for consistency
  outfile: resolve(__dirname, 'dist/background.js'),
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  minify: false,
})

// Build popup
console.log('Building popup...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/popup/popup.ts')],
  bundle: true,
  format: 'iife',
  outfile: resolve(__dirname, 'dist/popup.js'),
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
})

// Build options
console.log('Building options...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/options/options.ts')],
  bundle: true,
  format: 'iife',
  outfile: resolve(__dirname, 'dist/options.js'),
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
})

// Build logs
console.log('Building logs...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/logs/logs.ts')],
  bundle: true,
  format: 'iife',
  outfile: resolve(__dirname, 'dist/logs.js'),
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
})

// Build offscreen document
console.log('Building offscreen document...')
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/offscreen/offscreen.ts')],
  bundle: true,
  format: 'iife',
  outfile: resolve(__dirname, 'dist/offscreen.js'),
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
})

// Copy HTML files and fix script references
console.log('Copying HTML files...')

// Helper to fix HTML script references for IIFE builds
function fixHtmlScriptReferences(htmlContent, scriptName) {
  // Replace <script type="module" src="*.ts"></script> with <script src="*.js"></script>
  return htmlContent
    .replace(/<script type="module" src="[^"]+\.ts"><\/script>/g, `<script src="${scriptName}.js"></script>`)
    .replace(/src="\.\/([^"]+)\.ts"/g, `src="$1.js"`)
    .replace(/src="\.\.\/icons\//g, 'src="icons/') // Fix icon paths from ../icons/ to icons/
    .replace(/href="\.\.\/shared\//g, 'href="shared/') // Fix CSS imports from ../shared/ to shared/
}

// Copy and fix popup.html
let popupHtml = readFileSync(resolve(__dirname, 'src/popup/index.html'), 'utf-8')
popupHtml = fixHtmlScriptReferences(popupHtml, 'popup')
writeFileSync(resolve(__dirname, 'dist/popup.html'), popupHtml)

// Copy and fix options.html
let optionsHtml = readFileSync(resolve(__dirname, 'src/options/index.html'), 'utf-8')
optionsHtml = fixHtmlScriptReferences(optionsHtml, 'options')
writeFileSync(resolve(__dirname, 'dist/options.html'), optionsHtml)

// Copy and fix logs.html
let logsHtml = readFileSync(resolve(__dirname, 'src/logs/index.html'), 'utf-8')
logsHtml = fixHtmlScriptReferences(logsHtml, 'logs')
writeFileSync(resolve(__dirname, 'dist/logs.html'), logsHtml)

// Copy and fix offscreen.html
let offscreenHtml = readFileSync(resolve(__dirname, 'src/offscreen/offscreen.html'), 'utf-8')
offscreenHtml = fixHtmlScriptReferences(offscreenHtml, 'offscreen')
writeFileSync(resolve(__dirname, 'dist/offscreen.html'), offscreenHtml)

// Copy CSS files
console.log('Copying CSS files...')
// Copy shared theme.css first
mkdirSync(resolve(__dirname, 'dist/shared'), { recursive: true })
copyFileSync(
  resolve(__dirname, 'src/shared/theme.css'),
  resolve(__dirname, 'dist/shared/theme.css')
)
// Copy component CSS files
copyFileSync(
  resolve(__dirname, 'src/popup/popup.css'),
  resolve(__dirname, 'dist/popup.css')
)
copyFileSync(
  resolve(__dirname, 'src/options/options.css'),
  resolve(__dirname, 'dist/options.css')
)
copyFileSync(
  resolve(__dirname, 'src/logs/logs.css'),
  resolve(__dirname, 'dist/logs.css')
)

// Copy icons folder
console.log('Copying icons...')
mkdirSync(resolve(__dirname, 'dist/icons'), { recursive: true })
const iconsDir = resolve(__dirname, 'src/icons')
const iconFiles = ['32.png', '48.png', '96.png', '32-dev.png']
iconFiles.forEach(file => {
  try {
    copyFileSync(
      resolve(iconsDir, file),
      resolve(__dirname, 'dist/icons', file)
    )
  } catch (err) {
    console.warn(`Could not copy icon ${file}:`, err.message)
  }
})

// Copy manifest
console.log('Copying manifest...')
copyFileSync(
  resolve(__dirname, 'src/manifest.json'),
  resolve(__dirname, 'dist/manifest.json')
)

console.log('✓ Build complete!')
console.log('')
console.log('Note: Content scripts are bundled as IIFE format because Chrome MV3')
console.log('does NOT support ES modules in content scripts (see mv3-es-modules-research.md)')
console.log('')
console.log('Architecture: MV3 Compliant Full DOM Capture Strategy')
console.log('  Phase 1 (Content Script): Serialize full DOM (document.documentElement.outerHTML)')
console.log('  Phase 2 (Content Script): DOMPurify sanitizes for security (REQUIRED)')
console.log('  Phase 3 (Trilium Server): Server-side parsing with JSDOM, Readability, and Cheerio')
console.log('  See: MV3_Compliant_DOM_Capture_and_Server_Parsing_Strategy.md')

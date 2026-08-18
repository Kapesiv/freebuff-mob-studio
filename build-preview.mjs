/**
 * Builds a fully self-contained preview.html that works from file:// with
 * zero network access. Uses esbuild to bundle three.js + addons + the app
 * into one inline module script (no importmap, no CDN) — ES modules loaded
 * via file:// fail with CORS errors, so the bundle must be self-contained.
 *
 * Usage: node build-preview.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { spawnSync } from 'child_process';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));

// ---- pre-build: verifiers -------------------------------------------
// Run before bundling so bad data / UV layouts fail the build early.
const verifiers = [
    { file: 'tools/verify-render.js', label: 'render' },
    { file: 'tools/verify-uv.js', label: 'UV' }
];
for (const v of verifiers) {
    const res = spawnSync(process.execPath, [path.join(root, v.file)], { encoding: 'utf8' });
    process.stdout.write(res.stdout || '');
    process.stderr.write(res.stderr || '');
    if (res.status !== 0) {
        console.error(`\n❌ ${v.label} verification FAILED — aborting build. Fix the errors above, then rebuild.`);
        process.exit(res.status === null ? 1 : res.status);
    }
}
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'style.css'), 'utf8');

const result = await build({
    entryPoints: ['js/main.js'],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'warning'
});
const bundle = result.outputFiles[0].text;

// Visible error banner + handlers FIRST, so any error during app init is caught
const ERROR_BANNER = `
function showFatal(msg) {
    const el = document.getElementById('fatal-error');
    if (el) { el.style.display = 'block'; el.textContent = msg; }
}
window.addEventListener('error', (e) => showFatal('JS error: ' + e.message));
window.addEventListener('unhandledrejection', (e) => showFatal('JS error: ' + ((e.reason && e.reason.message) || e.reason)));
`;

// NOTE: replacements use FUNCTIONS because String.replace's replacement-string
// syntax interprets `$` sequences, and the bundle contains `$` characters.
let out = html.replace(/<link rel="stylesheet" href="style\.css">/, () => `<style>\n${css}\n</style>`);
out = out.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
out = out.replace(
    /<script type="module" src="js\/main\.js"><\/script>/,
    () => `<div id="fatal-error" style="display:none;position:fixed;top:0;left:0;right:0;z-index:9999;background:#f85149;color:#fff;padding:8px 12px;font:12px monospace;"></div>
<script type="module">\n${ERROR_BANNER}${bundle}</script>`
);

writeFileSync(path.join(root, 'preview.html'), out);
console.log(`✅ preview.html built (${(out.length / 1024).toFixed(1)} KB)`);

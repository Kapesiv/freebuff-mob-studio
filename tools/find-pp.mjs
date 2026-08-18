#!/usr/bin/env node
/** Search Poly Pizza (CC0) and print slug + static GLB url. Usage: node tools/find-pp.mjs "query" */
const q = process.argv[2] || 'wolf';
const page = await (await fetch('https://poly.pizza/search/' + encodeURIComponent(q))).text();
const slugs = [...new Set([...page.matchAll(/href="\/m\/([a-zA-Z0-9_-]+)"/g)].map(m => m[1]))];
for (const slug of slugs.slice(0, 14)) {
    try {
        const p = await (await fetch('https://poly.pizza/m/' + slug)).text();
        const glb = p.match(/https:\/\/static\.poly\.pizza\/([a-f0-9-]+\.glb)/);
        if (glb) console.log(slug, '|', glb[1]);
    } catch { }
}

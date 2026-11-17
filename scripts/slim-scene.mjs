// Create a viewer-only scene pack from a viewfinder export zip:
// keeps export.json, cameras.json and the splat files, drops images/depth maps.
//
// Usage: node scripts/slim-scene.mjs <input.zip> <output.zip>
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/slim-scene.mjs <input.zip> <output.zip>");
  process.exit(1);
}

const SPLAT_EXT = /\.(spz|ply|splat|ksplat|sog)$/i;
const KEEP_JSON = new Set(["export.json", "cameras.json"]);
const base = (p) => p.split("/").pop();

const files = unzipSync(readFileSync(input), {
  filter: (f) => KEEP_JSON.has(base(f.name)) || SPLAT_EXT.test(f.name),
});
if (!Object.keys(files).some((p) => SPLAT_EXT.test(p))) {
  console.error(`No splat file found in ${input}`);
  process.exit(1);
}

// Splats are already compressed; store them as-is so the browser does not inflate twice.
const entries = Object.fromEntries(
  Object.entries(files).map(([p, d]) => [p, [d, { level: SPLAT_EXT.test(p) ? 0 : 9 }]]),
);
const out = zipSync(entries);
writeFileSync(output, out);
for (const [p, d] of Object.entries(files)) console.log(`  ${p}  ${(d.length / 1e6).toFixed(2)} MB`);
console.log(`Wrote ${output} (${(out.length / 1e6).toFixed(1)} MB)`);

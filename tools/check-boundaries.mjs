// Tech spec §3, §6: the pure packages import nothing but each other and relative files.
// A dependency here is how replay silently drifts from the live path.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RULES = {
  "packages/scoring/src": [],
  "packages/items/src": ["node:crypto"],
  "packages/learning/src": ["@qa/scoring", "@qa/items"],
};

let failed = false;
for (const [dir, allowed] of Object.entries(RULES)) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^'"]*from\s*["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".")) continue;
      if (!allowed.includes(spec)) {
        console.error(`${file}: forbidden import "${spec}"`);
        failed = true;
      }
    }
    if (/\bDate\.now\(\)|\bMath\.random\(\)/.test(src)) {
      console.error(`${file}: ambient clock or randomness`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("boundaries ok");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}

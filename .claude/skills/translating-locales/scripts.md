# Reusable scripts

Copy-paste Node snippets used by the workflow in `SKILL.md`. Run from the repo root (or a worktree). All assume the shared `flatten` helper:

```js
function flatten(o, p = "", out = {}) {
  for (const k in o) {
    const key = p ? p + "." + k : k;
    if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) flatten(o[k], key, out);
    else out[key] = o[k];
  }
  return out;
}
```

Set the pair you're working on:
```js
const EN = "apps/client/src/translations/en/translation.json";
const LOC = "apps/client/src/translations/ro/translation.json";
// server pair: apps/server/src/assets/translations/{en/server.json, ro/server.json}
```

## measure — coverage gap

```js
const fs = require("fs");
const en = flatten(JSON.parse(fs.readFileSync(EN, "utf8")));
const loc = flatten(JSON.parse(fs.readFileSync(LOC, "utf8")));
const keys = Object.keys(en);
const missing = keys.filter(k => !(k in loc));
// "identical" = present but never translated; ignore proper nouns (no 4+ letter run is a heuristic)
const identical = keys.filter(k => k in loc && loc[k] === en[k] && typeof en[k] === "string" && /[a-zA-Z]{4,}/.test(en[k]));
console.log(`missing=${missing.length} identical=${identical.length} coverage=${(((keys.length - missing.length) / keys.length) * 100).toFixed(1)}%`);
console.log("missing sample:", missing.slice(0, 20));
console.log("identical (check these are proper nouns):", identical);
```

## export — work list to translate

```js
const fs = require("fs");
const en = flatten(JSON.parse(fs.readFileSync(EN, "utf8")));
const loc = flatten(JSON.parse(fs.readFileSync(LOC, "utf8")));
const todo = {};
for (const k of Object.keys(en)) {
  if (typeof en[k] !== "string") continue;
  const missing = !(k in loc);
  const identical = (k in loc) && loc[k] === en[k] && en[k].trim() !== "";
  if (missing || identical) todo[k] = en[k];
}
fs.writeFileSync(".loc-todo.json", JSON.stringify(todo, null, 2));
console.log("todo:", Object.keys(todo).length);
```

Then translate into a flat `{ key: translatedValue }` file, e.g. `.loc-done.json`.

## validate — placeholder integrity (run BEFORE merging)

Catches dropped/extra `{{var}}`, `{{- var}}`, `{keyword}`, and tags. Must print 0 errors.

```js
const fs = require("fs");
function placeholders(s) {
  const set = new Set();
  (s.match(/\{\{[^}]*\}\}/g) || []).forEach(x => set.add(x.replace(/\s+/g, " ").trim())); // {{x}} and {{- x}}
  (s.match(/(?<!\{)\{[a-zA-Z_][^}{]*\}(?!\})/g) || []).forEach(x => set.add(x));            // single-brace {keyword}
  (s.match(/<[^>]+>/g) || []).forEach(x => set.add(x.replace(/\s+/g, "")));                 // <Note/>, <code>, <buildRevision />
  return set;
}
const en = flatten(JSON.parse(fs.readFileSync(EN, "utf8")));
const done = JSON.parse(fs.readFileSync(".loc-done.json", "utf8"));
let errors = 0;
for (const k of Object.keys(done)) {
  if (!(k in en)) { console.log("! NOT IN EN:", k); errors++; continue; }
  const ep = placeholders(en[k]), rp = placeholders(done[k]);
  for (const p of ep) if (!rp.has(p)) { console.log(`! ${k}: missing ${JSON.stringify(p)}`); errors++; }
  for (const p of rp) if (!ep.has(p)) { console.log(`! ${k}: extra ${JSON.stringify(p)}`); errors++; }
}
console.log("placeholder errors:", errors);
```

## merge — apply translations WITHOUT churning the diff

Preserves existing key order (no sorting), updates values in place, appends new keys to their parent object, and keeps 2-space indent + CRLF + trailing newline.

```js
const fs = require("fs");
function setDeep(obj, path, val) {
  const ks = path.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (typeof o[ks[i]] !== "object" || o[ks[i]] === null) o[ks[i]] = {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = val;
}
const loc = JSON.parse(fs.readFileSync(LOC, "utf8"));
const done = JSON.parse(fs.readFileSync(".loc-done.json", "utf8"));
for (const k of Object.keys(done)) setDeep(loc, k, done[k]);
fs.writeFileSync(LOC, JSON.stringify(loc, null, 2).replace(/\n/g, "\r\n") + "\r\n", "utf8");
console.log("merged", Object.keys(done).length);
```

Then `git diff --stat` — a ~600-string change should be roughly that many added lines, **not** thousands. If it's thousands, you accidentally re-sorted or changed EOLs. Clean up temp files: `rm -f .loc-todo.json .loc-done.json`.

## targeted plural/grammar edits

For a handful of in-place fixes (e.g. converting one base key to plurals in **both** EN and locale, or fixing gender), do **text-level** replacement so unrelated lines stay byte-identical — never `JSON.parse → stringify` the EN file (it can reformat/re-escape). This helper replaces exact unique line(s) and preserves the file's EOL:

```js
const fs = require("fs");
function replaceOnce(path, pairs) { // pairs: [[oldLine, [newLine1, newLine2, ...]], ...]
  let s = fs.readFileSync(path, "utf8");
  const E = s.includes("\r\n") ? "\r\n" : "\n";
  for (const [oldL, newLines] of pairs) {
    if (s.indexOf(oldL) === -1) throw new Error("NOT FOUND: " + oldL);
    if (s.split(oldL).length > 2) throw new Error("NOT UNIQUE: " + oldL);
    s = s.replace(oldL, newLines.join(E));
  }
  fs.writeFileSync(path, s, "utf8");
}
// Example: pluralize a single EN key (4-space indent for a 2-level-deep key)
const I = "    ";
replaceOnce(EN, [[
  I + '"total_notes": "{{count}} notes",',
  [I + '"total_notes_one": "{{count}} note",', I + '"total_notes_other": "{{count}} notes",']
]]);
```

## audit-plurals — find groups missing a required category

Lists plural groups (EN has both `_one` and `_other`) where the locale lacks `_few`, or whose `_other` looks like it's missing "de" (Romanian heuristic).

```js
const fs = require("fs");
const en = flatten(JSON.parse(fs.readFileSync(EN, "utf8")));
const loc = flatten(JSON.parse(fs.readFileSync(LOC, "utf8")));
const bases = new Set();
for (const k of Object.keys(en)) { const m = k.match(/^(.*)_(one|few|other|two|many)$/); if (m) bases.add(m[1]); }
const plural = [...bases].filter(b => (b + "_one") in en && (b + "_other") in en);
for (const b of plural) {
  if (!((b + "_one") in loc || (b + "_other") in loc)) continue; // untranslated, skip
  const other = loc[b + "_other"];
  const missingFew = loc[b + "_few"] === undefined;
  const missingDe = typeof other === "string"
    && /\{\{count\}\}\s+[a-zaăâîșțA-ZĂÂÎȘȚ]/.test(other) && !/\{\{count\}\}\s+de\s/.test(other);
  if (missingFew || missingDe) console.log(b, missingFew ? "[no _few]" : "", missingDe ? "[_other missing 'de']" : "");
}
```

## final validation

```bash
pnpm --filter client test src/services/i18n.spec.ts   # valid JSON + no duplicate keys (the only translation test)
```
Then re-run *measure* → expect 100%, with remaining "identical" entries all legitimate proper nouns.

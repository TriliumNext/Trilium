#!/usr/bin/env node
/**
 * Locale workbench for Trilium's i18next catalogs.
 *
 *   node .claude/skills/translating-locales/locale.mjs <command> [args]
 *
 *   measure [locale] [-v]                   coverage of one locale (both catalogs), or all locales
 *   export <locale> <catalog> [opts]        write the work list (English source) to translate
 *   validate <locale> <catalog> <file...>   placeholder / whitespace / plural-category integrity
 *   merge <locale> <catalog> <file...>      apply translations, preserving order + formatting
 *   audit-plurals <locale> <catalog>        plural groups missing a category the locale requires
 *
 *   catalog: client | server        (measure covers both)
 *   export opts: --chunk N  --out DIR  --only missing|identical|all
 *
 * Everything here exists so a translation pass never hand-rolls a JSON walker: the
 * traps (key order, EOL, locale-only plural categories, `{{- var}}`) are all handled.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SKILL_DIR, "../../..");

const CATALOGS = {
    client: { en: "apps/client/src/translations/en/translation.json", loc: (l) => `apps/client/src/translations/${l}/translation.json` },
    // Separate namespace loaded on its own by the setup wizard, login and password-reset pages.
    entry: { en: "apps/client/src/translations/en/entry.json", loc: (l) => `apps/client/src/translations/${l}/entry.json` },
    server: { en: "apps/server/src/assets/translations/en/server.json", loc: (l) => `apps/server/src/assets/translations/${l}/server.json` }
};

/** Catalog directory names that aren't valid BCP-47 tags. */
const LOCALE_TO_BCP47 = { cn: "zh-CN", tw: "zh-TW", md: "ro-MD", pt_br: "pt-BR" };

const [, , cmd, ...rest] = process.argv;
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") === false ? rest[++i] : true;
    else if (rest[i] === "-v") flags.verbose = true;
    else args.push(rest[i]);
}

const COMMANDS = { measure, export: exportTodo, validate, merge, "audit-plurals": auditPlurals };
const run = COMMANDS[cmd];
if (!run) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].split("/**")[1].replace(/^ \* ?/gm, ""));
    process.exit(cmd ? 1 : 0);
}
run(...args);

// ---------------------------------------------------------------- commands

function measure(locale) {
    const locales = locale ? [locale] : listLocales();
    for (const l of locales) {
        const parts = [];
        for (const name of Object.keys(CATALOGS)) {
            const p = resolvePair(l, name);
            if (!fs.existsSync(p.locPath)) { parts.push(`${name}: (absent)`); continue; }
            const { en, loc } = readPair(p);
            const keys = Object.keys(en);
            const missing = keys.filter((k) => !(k in loc));
            const identical = keys.filter((k) => isUntranslated(k, en, loc));
            parts.push(`${name}: ${pct(keys.length - missing.length, keys.length)} (missing ${missing.length}, untranslated ${identical.length}, of ${keys.length})`);
            if (flags.verbose && locale) {
                if (missing.length) console.log(`  ${name} missing:`, missing.slice(0, 40).join(", "), missing.length > 40 ? `… +${missing.length - 40}` : "");
                if (identical.length) console.log(`  ${name} identical to EN (check these are proper nouns):`, identical.join(", "));
            }
        }
        console.log(`${l.padEnd(6)} ${parts.join("   ")}`);
    }
}

function exportTodo(locale, catalog) {
    const p = requirePair(locale, catalog);
    const { en, loc } = readPair(p);
    const only = flags.only ?? "all";
    const todo = {};
    for (const k of Object.keys(en)) {
        if (typeof en[k] !== "string") continue;
        const missing = !(k in loc);
        const identical = !missing && isUntranslated(k, en, loc);
        if ((only === "all" && (missing || identical)) || (only === "missing" && missing) || (only === "identical" && identical)) todo[k] = en[k];
    }
    const outDir = flags.out ?? fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", `loc-${locale}-`));
    fs.mkdirSync(outDir, { recursive: true });
    const keys = Object.keys(todo);
    const chunk = parseInt(flags.chunk ?? "0", 10);
    const written = [];
    if (!chunk) {
        written.push(writeJson(path.join(outDir, `todo-${catalog}.json`), todo));
    } else {
        for (let i = 0, n = 0; i < keys.length; i += chunk) {
            const part = Object.fromEntries(keys.slice(i, i + chunk).map((k) => [k, todo[k]]));
            written.push(writeJson(path.join(outDir, `todo-${catalog}-${String(++n).padStart(2, "0")}.json`), part));
        }
    }
    console.log(`${keys.length} strings →`);
    written.forEach((f) => console.log("  " + f));
    console.log(`\nTranslate each into a flat { key: "translation" } file, then:\n  validate ${locale} ${catalog} <files…>\n  merge ${locale} ${catalog} <files…>`);
}

function validate(locale, catalog, ...files) {
    const p = requirePair(locale, catalog);
    const { en } = readPair(p);
    const categories = pluralCategories(locale);
    let errors = 0;
    let count = 0;
    const seen = new Set();
    for (const file of files) {
        const done = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const [k, v] of Object.entries(done)) {
            count++;
            const fail = (msg) => { console.log(`! ${k}: ${msg}`); errors++; };
            if (seen.has(k)) fail(`duplicated across the input files`);
            seen.add(k);
            const source = en[k] ?? en[pluralBase(k, categories)];
            if (source === undefined) { fail(`not a key in the English catalog`); continue; }
            if (typeof v !== "string") { fail(`not a string`); continue; }
            if (!v.trim()) { fail(`empty`); continue; }
            for (const ph of placeholders(source)) if (!placeholders(v).has(ph)) fail(`dropped placeholder ${JSON.stringify(ph)}\n    EN: ${source}\n    ${locale.toUpperCase()}: ${v}`);
            for (const ph of placeholders(v)) if (!placeholders(source).has(ph)) fail(`invented placeholder ${JSON.stringify(ph)}\n    EN: ${source}\n    ${locale.toUpperCase()}: ${v}`);
            if (/^\s/.test(source) !== /^\s/.test(v)) fail("leading whitespace differs from EN");
            if (/\s$/.test(source) !== /\s$/.test(v)) fail("trailing whitespace differs from EN");
            if (countOf(source, "\n") !== countOf(v, "\n")) fail("number of line breaks differs from EN");
            const cat = k.match(/_(zero|one|two|few|many|other)$/)?.[1];
            if (cat && !categories.includes(cat)) fail(`plural category "_${cat}" is not used by ${locale} (needs ${categories.map((c) => "_" + c).join("/")})`);
        }
    }
    console.log(`checked ${count} strings from ${files.length} file(s): ${errors} error(s)`);
    if (errors) process.exitCode = 1;
}

function merge(locale, catalog, ...files) {
    const p = requirePair(locale, catalog);
    const raw = fs.readFileSync(p.locPath, "utf8");
    const loc = JSON.parse(raw);
    let n = 0;
    for (const file of files) {
        for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) { setDeep(loc, k, v); n++; }
    }
    // Preserve the file's own formatting — writing CRLF into an LF file (or vice versa) rewrites every line.
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const indent = raw.match(/^[^\n]*\n(\s+)"/)?.[1].replace("\r", "").length ?? 2;
    let out = JSON.stringify(loc, null, indent);
    if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");
    fs.writeFileSync(p.locPath, out + (raw.endsWith("\n") || raw.endsWith("\r\n") ? eol : ""), "utf8");
    console.log(`merged ${n} strings into ${p.loc} (indent ${indent}, ${eol === "\n" ? "LF" : "CRLF"})`);
    console.log("Now check `git diff --stat`: it should be ~the number of changed strings, not thousands.");
}

function auditPlurals(locale, catalog) {
    const p = requirePair(locale, catalog);
    const { en, loc } = readPair(p);
    const categories = pluralCategories(locale);
    const bases = new Set();
    for (const k of Object.keys(en)) { const m = k.match(/^(.*)_(zero|one|two|few|many|other)$/); if (m) bases.add(m[1]); }
    const groups = [...bases].filter((b) => `${b}_one` in en && `${b}_other` in en);
    let n = 0;
    for (const b of groups) {
        if (!categories.some((c) => `${b}_${c}` in loc)) continue; // untranslated group — the export covers it
        const problems = categories.filter((c) => loc[`${b}_${c}`] === undefined).map((c) => `no _${c}`);
        // Romanian: `_other` (≥20) takes "de" before the noun, `_few` (2–19) must not.
        if (locale.startsWith("ro") || locale === "md") {
            const other = loc[`${b}_other`];
            if (typeof other === "string" && /\{\{count\}\}\s+[a-zA-ZăâîșțĂÂÎȘȚ]/.test(other) && !/\{\{count\}\}\s+de\s/.test(other)) problems.push(`_other missing "de": ${JSON.stringify(other)}`);
            const few = loc[`${b}_few`];
            if (typeof few === "string" && /\{\{count\}\}\s+de\s/.test(few)) problems.push(`_few must not use "de": ${JSON.stringify(few)}`);
        }
        if (problems.length) { console.log(`${b}  [${problems.join("] [")}]`); n++; }
    }
    console.log(`${n} of ${groups.length} translated plural groups need attention (${locale} requires ${categories.map((c) => "_" + c).join("/")})`);
}

// ---------------------------------------------------------------- helpers

function resolvePair(locale, catalog) {
    const c = CATALOGS[catalog];
    if (!c) { console.error(`unknown catalog "${catalog}" — use client or server`); process.exit(1); }
    return { enPath: path.join(ROOT, c.en), locPath: path.join(ROOT, c.loc(locale)), en: c.en, loc: c.loc(locale) };
}

function requirePair(locale, catalog) {
    if (!locale || !catalog) { console.error("usage: <command> <locale> <client|server> …"); process.exit(1); }
    const p = resolvePair(locale, catalog);
    if (!fs.existsSync(p.locPath)) { console.error(`no such locale file: ${p.loc}`); process.exit(1); }
    return p;
}

function readPair(p) {
    return { en: flatten(JSON.parse(fs.readFileSync(p.enPath, "utf8"))), loc: flatten(JSON.parse(fs.readFileSync(p.locPath, "utf8"))) };
}

function listLocales() {
    return fs.readdirSync(path.join(ROOT, "apps/client/src/translations")).filter((d) => d !== "en" && fs.statSync(path.join(ROOT, "apps/client/src/translations", d)).isDirectory()).sort();
}

/** A string present in the locale but byte-identical to English — untranslated, unless it's a proper noun. */
function isUntranslated(k, en, loc) {
    return k in loc && typeof en[k] === "string" && loc[k] === en[k] && /[a-zA-Z]{4,}/.test(en[k]);
}

function pluralCategories(locale) {
    const tag = LOCALE_TO_BCP47[locale] ?? locale.replace("_", "-");
    try {
        return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
    } catch {
        console.error(`warning: "${locale}" is not a recognised locale tag; assuming one/other`);
        return ["one", "other"];
    }
}

/** `key_few` has no English counterpart when English only has one/other — fall back to `_other`. */
function pluralBase(k, categories) {
    const m = k.match(/^(.*)_(zero|one|two|few|many|other)$/);
    return m && categories.includes(m[2]) ? `${m[1]}_other` : k;
}

function placeholders(s) {
    const set = new Set();
    (s.match(/\{\{[^}]*\}\}/g) ?? []).forEach((x) => set.add(x.replace(/\s+/g, " ").trim())); // {{var}} and {{- var}}
    (s.match(/(?<!\{)\{[a-zA-Z_][^}{]*\}(?!\})/g) ?? []).forEach((x) => set.add(x)); // single-brace {keyword}
    // <Note/>, <code>, <buildRevision /> — must start with a letter, so the "<- and ->" of a prose
    // sentence about operators isn't mistaken for a tag.
    (s.match(/<\/?[A-Za-z][\w:.-]*(\s[^<>]*)?\/?>/g) ?? []).forEach((x) => set.add(x.replace(/\s+/g, "")));
    (s.match(/%\d/g) ?? []).forEach((x) => set.add(x)); // CKEditor-style %0
    return set;
}

function flatten(o, p = "", out = {}) {
    for (const k of Object.keys(o)) {
        const key = p ? `${p}.${k}` : k;
        if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) flatten(o[k], key, out);
        else out[key] = o[k];
    }
    return out;
}

function setDeep(obj, dotted, val) {
    const ks = dotted.split(".");
    let o = obj;
    for (const k of ks.slice(0, -1)) {
        if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
        o = o[k];
    }
    o[ks[ks.length - 1]] = val;
}

function writeJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
    return file;
}

function countOf(s, ch) {
    return s.split(ch).length - 1;
}

function pct(done, total) {
    return `${((done / total) * 100).toFixed(1)}%`;
}

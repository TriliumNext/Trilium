#!/usr/bin/env node
/**
 * UI-string workbench for Trilium's i18next catalogs. Reads all 39 locales, writes English only.
 *
 *   node .claude/skills/working-with-translations/i18n.mjs <command> [args]
 *
 *   find <text> [--key] [--all]         locate a string by its English text (or by key path)
 *   show <section> [--locales]          dump one section; --locales shows every language's value
 *   add <catalog> <key> <text>          add an English string, preserving key order + formatting
 *   callers <key>                       where a key is referenced in code
 *   missing                             keys used in code but absent from every catalog (typos)
 *   unused                              catalog keys no call site references
 *
 *   catalog: client | entry | server
 *   add opts: --force  (overwrite an existing key instead of refusing)
 *
 * The client catalog is 226 KB / 3400 keys, so reading it to answer a question costs more
 * than the question is worth. `find` and `show` exist so nothing ever has to. `add` exists
 * because hand-editing needs the right file, the right nesting and no reformatting.
 *
 * This tool only ever writes `en/` — the other ~38 locales belong to Weblate. To fill a
 * lagging locale, use the translating-locales skill instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SKILL_DIR, "../../..");

/**
 * `scan` is the set of source trees whose `t()` calls resolve against this catalog.
 * `apps/client/src` resolves against client *and* entry, because the app loads both
 * namespaces with `fallbackNS: "entry"` — a call site writes `t("login.password")`
 * without caring which file holds it.
 *
 * `packages/ckeditor5` is deliberately absent: its plugins pass the English text itself
 * to CKEditor's `t()`, so its arguments are messages, not keys. `apps/client/src/services/i18n.spec.ts`
 * already enforces that mechanism in both directions.
 */
const CATALOGS = {
    client: {
        file: "apps/client/src/translations/en/translation.json",
        dir: "apps/client/src/translations",
        localeFile: (l) => `apps/client/src/translations/${l}/translation.json`,
        scan: ["apps/client/src"]
    },
    entry: {
        file: "apps/client/src/translations/en/entry.json",
        dir: "apps/client/src/translations",
        localeFile: (l) => `apps/client/src/translations/${l}/entry.json`,
        scan: ["apps/client/src"]
    },
    server: {
        file: "apps/server/src/assets/translations/en/server.json",
        dir: "apps/server/src/assets/translations",
        localeFile: (l) => `apps/server/src/assets/translations/${l}/server.json`,
        scan: ["apps/server/src", "apps/desktop/src", "packages/trilium-core/src"]
    }
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", ".vite", "coverage"]);

/**
 * i18next resolves `t("pdf.annotations", { count })` to `pdf.annotations_one` / `_other`, so a
 * pluralized string has no base key at all. Both `missing` and `unused` have to bridge that gap
 * or every plural group in the catalog reads as broken in both directions.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const [, , cmd, ...rest] = process.argv;
const flags = {};
const args = [];
for (const arg of rest) {
    if (arg.startsWith("--")) flags[arg.slice(2)] = true;
    else args.push(arg);
}

const COMMANDS = { find, show, add, callers, missing, unused };
const run = COMMANDS[cmd];
if (!run) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].split("/**")[1].replace(/^ \* ?/gm, ""));
    process.exit(cmd ? 1 : 0);
}
run(...args);

// ---------------------------------------------------------------- commands

function find(text) {
    if (!text) fail("usage: find <text> [--key] [--all]");
    const needle = text.toLowerCase();
    const limit = flags.all ? Infinity : 40;
    const hits = [];
    for (const [name, entries] of Object.entries(readCatalogs())) {
        for (const [key, value] of Object.entries(entries)) {
            const haystack = flags.key ? key : String(value);
            if (haystack.toLowerCase().includes(needle)) hits.push({ name, key, value });
        }
    }
    for (const hit of hits.slice(0, limit)) {
        console.log(`${hit.name.padEnd(6)} ${hit.key}\n         ${JSON.stringify(hit.value)}`);
    }
    if (hits.length > limit) console.log(`\n… +${hits.length - limit} more (pass --all)`);
    console.log(`\n${hits.length} match(es) for ${JSON.stringify(text)} in ${flags.key ? "key paths" : "English values"}`);
    if (!flags.key && !hits.length) console.log("Nothing matched a value — retry with --key to search key paths.");
}

function show(section) {
    if (!section) fail("usage: show <section> [--locales]");
    let total = 0;
    for (const [name, entries] of Object.entries(readCatalogs())) {
        const under = Object.entries(entries).filter(([key]) => key === section || key.startsWith(`${section}.`));
        if (!under.length) continue;
        if (flags.locales) {
            for (const [key] of under) showAcrossLocales(name, key);
        } else {
            console.log(`--- ${name}: ${CATALOGS[name].file}`);
            for (const [key, value] of under) console.log(`  ${key} = ${JSON.stringify(value)}`);
        }
        total += under.length;
    }
    if (!total) {
        const sections = new Set();
        for (const entries of Object.values(readCatalogs())) {
            for (const key of Object.keys(entries)) sections.add(key.split(".")[0]);
        }
        const near = [...sections].filter((s) => s.includes(section) || section.includes(s)).slice(0, 10);
        console.log(`no keys under "${section}"${near.length ? `\ndid you mean: ${near.join(", ")}` : ""}`);
        return;
    }
    console.log(`\n${total} string(s) under "${section}"`);
}

/** One key in every locale that has it, plus the list of locales that don't — "is this translated yet?". */
function showAcrossLocales(catalog, key) {
    const entry = CATALOGS[catalog];
    const english = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), "utf8")))[key];
    console.log(`--- ${catalog}: ${key}`);
    console.log(`  ${"en".padEnd(7)} ${JSON.stringify(english)}`);

    const locales = listLocales(catalog);
    const absent = [];
    const untranslated = [];
    for (const locale of locales) {
        const file = path.join(ROOT, entry.localeFile(locale));
        if (!fs.existsSync(file)) { absent.push(locale); continue; }
        const value = flatten(JSON.parse(fs.readFileSync(file, "utf8")))[key];
        if (value === undefined) { absent.push(locale); continue; }
        console.log(`  ${locale.padEnd(7)} ${JSON.stringify(value)}`);
        if (value === english) untranslated.push(locale);
    }
    const done = locales.length - absent.length;
    console.log(`  ${done}/${locales.length} locales translated`);
    if (absent.length) console.log(`  missing: ${absent.join(", ")}`);
    // Byte-identical to English: either a proper noun, or Weblate carrying the source string through.
    if (untranslated.length) console.log(`  identical to English: ${untranslated.join(", ")}`);
    console.log();
}

function listLocales(catalog) {
    const dir = path.join(ROOT, CATALOGS[catalog].dir);
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "en")
        .map((e) => e.name)
        .sort();
}

function add(catalog, key, text) {
    if (!catalog || !key || text === undefined) fail('usage: add <client|entry|server> <dotted.key> "English text"');
    const entry = CATALOGS[catalog];
    if (!entry) fail(`unknown catalog "${catalog}" — use client, entry or server`);

    const catalogs = readCatalogs();
    const existing = catalogs[catalog][key];
    if (existing !== undefined && !flags.force) {
        fail(`${catalog}.${key} already exists: ${JSON.stringify(existing)}\nPass --force to overwrite it.`);
    }

    // A key can only nest under an object. `a.b.c` is impossible when `a.b` is already a string.
    for (const ancestor of ancestorsOf(key)) {
        if (typeof catalogs[catalog][ancestor] === "string") {
            fail(`cannot nest under "${ancestor}" — it is already a string in ${catalog}: ${JSON.stringify(catalogs[catalog][ancestor])}`);
        }
    }

    warnAboutCatalogChoice(catalog, key, catalogs);
    warnAboutDuplicateText(text, key, catalogs);

    const file = path.join(ROOT, entry.file);
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    setDeep(parsed, key, text);
    fs.writeFileSync(file, serializeLike(raw, parsed), "utf8");

    console.log(`${existing === undefined ? "added" : "updated"} ${key} in ${entry.file}`);
    console.log(`  ${JSON.stringify(text)}`);
    console.log(`\nCall it with t(${JSON.stringify(key)}). Only en/ is edited — Weblate carries it to the other locales.`);
}

function callers(key) {
    if (!key) fail("usage: callers <key>");
    const trees = [...new Set(Object.values(CATALOGS).flatMap((c) => c.scan))];
    const usage = scanSources(trees);
    const literal = usage.literals.filter((u) => u.key === key);
    for (const u of literal) console.log(`${u.file}:${u.line}  t("${u.key}")`);

    const seen = new Set(literal.map((u) => `${u.file}:${u.line}`));
    const bare = usage.quoted.filter((u) => u.key === key && !seen.has(`${u.file}:${u.line}`));
    for (const u of bare) console.log(`${u.file}:${u.line}  "${u.key}"  <- key travelling as data, not a direct t() call`);

    const prefixes = usage.prefixes.filter((p) => key.startsWith(p.prefix));
    for (const p of prefixes) console.log(`${p.file}:${p.line}  t(\`${p.prefix}\${…}\`)  <- could resolve to this key`);

    const parts = [`${literal.length} literal reference(s)`];
    if (bare.length) parts.push(`${bare.length} bare-string reference(s)`);
    if (prefixes.length) parts.push(`${prefixes.length} dynamic prefix(es) that could produce it`);
    console.log(`\n${parts.join(", ")}`);
    if (!literal.length && !bare.length && !prefixes.length) {
        console.log(`Nothing references "${key}". ${usage.opaque.length} opaque t(variable) call site(s) exist repo-wide, so confirm before deleting.`);
    }
}

function missing() {
    let total = 0;
    for (const { trees, names, keys, label } of scanGroups()) {
        const usage = scanSources(trees);
        const absent = usage.literals.filter((u) => !resolvesInKeyspace(u.key, keys));
        if (absent.length) {
            console.log(`--- ${label} (resolves against ${names.join(" + ")})`);
            for (const u of absent) console.log(`  ${u.file}:${u.line}  t("${u.key}")`);
        }
        total += absent.length;
    }
    console.log(`\n${total} key(s) used in code but absent from their catalog.`);
    if (total) console.log('Each is either a typo or a string never added — `find --key <fragment>` to check for a near-miss.');
}

function unused() {
    let total = 0;
    let opaqueTotal = 0;
    for (const { trees, keys, catalogOf, label } of scanGroups()) {
        const usage = scanSources(trees);
        const referenced = new Set([...usage.literals, ...usage.quoted].map((u) => u.key));
        const orphans = [...keys]
            // `pdf.annotations_one` is live when the code calls t("pdf.annotations", { count }).
            .filter((key) => !referenced.has(key) && !referenced.has(key.replace(PLURAL_SUFFIX, "")))
            .filter((key) => !usage.prefixes.some((p) => key.startsWith(p.prefix)));
        if (orphans.length) {
            console.log(`--- ${label}`);
            for (const key of orphans) console.log(`  ${catalogOf.get(key)}  ${key}`);
        }
        total += orphans.length;
        opaqueTotal += usage.opaque.length;
    }
    console.log(`\n${total} key(s) with no t() call, no bare-string mention and no matching dynamic prefix.`);
    console.log(`Not proof they are dead: ${opaqueTotal} t(variable) call site(s) build their key at runtime with`);
    console.log("no visible prefix. Run `callers <key>` and confirm before deleting anything.");
}

// ---------------------------------------------------------------- source scanning

/** The keyspace a `t()` call resolves against depends on which tree it lives in, not which catalog you have open. */
function scanGroups() {
    const catalogs = readCatalogs();
    const byTree = new Map();
    for (const [name, entry] of Object.entries(CATALOGS)) {
        for (const tree of entry.scan) byTree.set(tree, [...(byTree.get(tree) ?? []), name]);
    }
    // Trees sharing an identical catalog set form one group, so client+entry are checked together.
    const groups = new Map();
    for (const [tree, names] of byTree) {
        const id = names.slice().sort().join("+");
        groups.set(id, { names, trees: [...(groups.get(id)?.trees ?? []), tree] });
    }
    return [...groups.values()].map(({ names, trees }) => {
        const keys = new Set();
        const catalogOf = new Map();
        for (const name of names) {
            for (const key of Object.keys(catalogs[name])) {
                keys.add(key);
                catalogOf.set(key, name);
            }
        }
        return { trees, names, keys, catalogOf, label: trees.join(", ") };
    });
}

/** True when `key` names a string, or names a plural group whose suffixed forms exist. */
function resolvesInKeyspace(key, keys) {
    if (keys.has(key)) return true;
    for (const category of ["zero", "one", "two", "few", "many", "other"]) {
        if (keys.has(`${key}_${category}`)) return true;
    }
    return false;
}

function scanSources(trees) {
    const literals = [];
    const prefixes = [];
    const opaque = [];
    const quoted = [];
    for (const tree of trees) {
        for (const file of walk(path.join(ROOT, tree))) {
            const relative = path.relative(ROOT, file);
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((text, index) => {
                const line = index + 1;
                // t("some.key") / t('some.key') — the everyday form.
                for (const m of text.matchAll(/\bt\(\s*["']([a-zA-Z0-9_.-]+)["']/g)) literals.push({ key: m[1], file: relative, line });
                // <Trans i18nKey="some.key"> — same keyspace, different syntax.
                for (const m of text.matchAll(/\bi18nKey=["']([a-zA-Z0-9_.-]+)["']/g)) literals.push({ key: m[1], file: relative, line });
                // t(`about.channel.${channel}`) — the static prefix still tells us which keys are live.
                for (const m of text.matchAll(/\bt\(\s*`([a-zA-Z0-9_.-]*)\$\{/g)) prefixes.push({ prefix: m[1], file: relative, line });
                // t(labelKey) — no prefix at all, so it can vouch for nothing. Counted, not resolved.
                for (const m of text.matchAll(/\bt\(\s*[a-zA-Z_$][\w$.]*\s*[,)]/g)) opaque.push({ file: relative, line, text: m[0] });
                // Any bare "some.key" literal. Keys routinely travel as data — stored in a config
                // table, passed to a helper that calls t() itself (registerToggleHandler), or held
                // in a `labelKey` field. Intersected with the catalog by the caller, so a string
                // that merely looks key-shaped vouches for nothing.
                for (const m of text.matchAll(/["'`]([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)["'`]/g)) quoted.push({ key: m[1], file: relative, line });
            });
        }
    }
    return { literals, prefixes, opaque, quoted };
}

function* walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRECTORIES.has(entry.name)) yield* walk(path.join(dir, entry.name));
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            yield path.join(dir, entry.name);
        }
    }
}

// ---------------------------------------------------------------- helpers

function readCatalogs() {
    const out = {};
    for (const [name, entry] of Object.entries(CATALOGS)) {
        out[name] = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), "utf8")));
    }
    return out;
}

/** `setup.wizard.title` -> ["setup", "setup.wizard"] */
function ancestorsOf(key) {
    const parts = key.split(".");
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("."));
}

/** The entry catalog holds exactly three sections; putting one of them in `client` breaks the pre-login pages. */
function warnAboutCatalogChoice(catalog, key, catalogs) {
    const section = key.split(".")[0];
    const homes = Object.keys(CATALOGS).filter((name) =>
        name !== catalog && Object.keys(catalogs[name]).some((k) => k.split(".")[0] === section)
    );
    const here = Object.keys(catalogs[catalog]).some((k) => k.split(".")[0] === section);
    if (!here && homes.length) {
        console.log(`note: section "${section}" does not exist in ${catalog} but does in ${homes.join(", ")}.`);
        console.log(`      The setup wizard, login and password-reset pages load only "entry"; everything else loads "client".`);
        console.log(`      Server, Electron main and trilium-core read "server".\n`);
    }
}

function warnAboutDuplicateText(text, key, catalogs) {
    const normalized = text.trim().toLowerCase();
    const twins = [];
    for (const [name, entries] of Object.entries(catalogs)) {
        for (const [k, v] of Object.entries(entries)) {
            if (k !== key && typeof v === "string" && v.trim().toLowerCase() === normalized) twins.push(`${name}  ${k}`);
        }
    }
    if (twins.length) {
        console.log(`note: ${twins.length} existing key(s) already carry this exact English text:`);
        for (const t of twins.slice(0, 8)) console.log(`      ${t}`);
        if (twins.length > 8) console.log(`      … +${twins.length - 8} more`);
        console.log(`      Reuse one if it means the same thing — every new key costs ~38 locales a translation.\n`);
    }
}

/** Writes `value` with the indent, EOL and trailing newline the original file already uses. */
function serializeLike(raw, value) {
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const indent = raw.match(/^[^\n]*\n(\s+)"/)?.[1].replace("\r", "").length ?? 2;
    let out = JSON.stringify(value, null, indent);
    if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");
    return out + (/\r?\n$/.test(raw) ? eol : "");
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

function fail(message) {
    console.error(message);
    process.exit(1);
}

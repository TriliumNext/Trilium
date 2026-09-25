#!/usr/bin/env node
/**
 * Workbench for Trilium's documentation trees (`docs/User Guide`, `docs/Developer Guide`,
 * `docs/Release Notes`): Markdown pages described by a `!!!meta.json` note tree.
 *
 *   node .claude/skills/writing-documentation/docs.mjs <command> [args]
 *
 *   find <text> [--content] [--tree t]     pages whose title, alias, path (or body) match
 *   show <page>                            metadata, URL, outline, inbound links, code references
 *   tree [page] [--depth n] [--tree t]     the note tree with aliases and icons
 *   new <parent> <title> [opts]            scaffold a page: .md + meta entry (+ alias, icon)
 *   image <page> <file> [--title t]        register an image as an attachment; prints the <figure>
 *   rename <page> <title>                  retitle a page (meta + H1); links follow on `sync`
 *   move <page> <parent> [--after s|--first]   reparent a page and its files
 *   delete <page>                          remove a page; refuses when the app links to it
 *   icons <query...> [--pack bx|cke]       search the icon fonts the docs can use
 *   impact [--diff [range]] [terms...]     which pages a code change or a term touches
 *   check [--tree t]                       consistency + style audit of the trees
 *   sync                                   regenerate everything (help HTML, meta) headless
 *
 *   <page>  a noteId, a shareAlias, or a unique title/path fragment. <parent> likewise.
 *   --tree  user (default) | dev | release
 *
 * The meta file is 6000+ lines and the HTML mirror is generated, so nothing here should ever
 * need either read by hand. `new`/`image`/`rename`/`move`/`delete` edit `!!!meta.json` through
 * the file's own layout (4-space indent, exporter key order); `sync` then makes the Markdown,
 * the help HTML and the standalone meta agree, the same way edit-docs does after an edit.
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SKILL_DIR, "../../..");

const BASE_URL = "https://docs.triliumnotes.org";

const TREES = {
    user: {
        dir: "docs/User Guide",
        rootId: "pOsGYCXsbNQG",
        html: "apps/server/src/assets/doc_notes/en/User Guide",
        helpMeta: "apps/server/src/assets/doc_notes/en/User Guide/!!!meta.json",
        standaloneMeta: "apps/standalone/src/assets/help_meta.json"
    },
    dev: { dir: "docs/Developer Guide", rootId: "jdjRLhLV3TtI" },
    release: { dir: "docs/Release Notes", rootId: "hD3V4hiu2VW4" }
};

const ICON_PACKS = {
    bx: "packages/trilium-core/src/services/icon_pack_boxicons-v2.json",
    cke: "packages/trilium-core/src/services/icon_pack_text_editor.json"
};

/** `apps/client/src/services/doc_renderer.ts` refuses any other character in a help page path. */
const DOC_NAME_CHARS = /^[a-zA-Z0-9_/\- ()&.,`]+$/;

/** Where the app hard-codes help pages (by noteId) and public docs URLs (by alias path). */
const CODE_SCAN_DIRS = ["apps/client/src", "apps/server/src", "apps/desktop/src", "apps/standalone/src", "apps/website/src", "apps/web-clipper", "apps/edit-docs/demo", "packages/trilium-core/src", "packages/commons/src"];
const URL_SCAN_FILES = ["README.md", ...CODE_SCAN_DIRS];

const treeCache = new Map();
const iconCache = new Map();
/** Key order the exporter writes, kept so a one-page change is a small diff. */
const ENTRY_KEY_ORDER = ["isClone", "noteId", "notePath", "title", "notePosition", "prefix", "isExpanded", "type", "mime", "attributes", "format", "dataFileName", "attachments", "dirFileName", "children"];

const args = process.argv.slice(2);
const command = args.shift();
const flags = parseFlags(args);

const COMMANDS = { find, show, tree, new: newPage, image, rename, move, delete: deletePage, icons, impact, check, sync, help };
if (!command || !(command in COMMANDS)) {
    help();
    process.exit(command ? 1 : 0);
}
COMMANDS[command]();

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

function help() {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf-8").split("\n").slice(1, 26).map((l) => l.replace(/^ \*\/?\s?/, "")).join("\n"));
}

function find() {
    const text = flags._[0];
    if (!text) die("usage: find <text> [--content] [--tree user|dev|release]");
    const needle = text.toLowerCase();
    const trees = flags.tree ? [flags.tree] : Object.keys(TREES);
    let hits = 0;
    for (const treeName of trees) {
        const index = loadTree(treeName);
        for (const page of index.pages) {
            const inMeta = page.title.toLowerCase().includes(needle) || (page.alias ?? "").includes(needle) || page.relPath.toLowerCase().includes(needle);
            let bodyHits = [];
            if (flags.content && page.file) {
                const lines = readPage(page).split("\n");
                bodyHits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => l.toLowerCase().includes(needle));
            }
            if (!inMeta && bodyHits.length === 0) continue;
            hits++;
            console.log(`${page.noteId}  ${page.relPath}${page.url ? `  ${page.url.replace(BASE_URL, "")}` : ""}${page.isClone ? "  (clone)" : ""}`);
            for (const [n, l] of bodyHits.slice(0, 5)) console.log(`    :${n}  ${stripHtml(l).trim().slice(0, 140)}`);
            if (bodyHits.length > 5) console.log(`    … ${bodyHits.length - 5} more lines`);
        }
    }
    if (!hits) console.log(`no page matches "${text}"${flags.content ? "" : " (try --content to search page bodies)"}`);
}

function show() {
    const page = resolvePage(flags._[0]);
    const index = page.index;
    console.log(`${page.title}`);
    console.log(`  noteId     ${page.noteId}${page.isClone ? "  (clone entry; primary is " + index.byId.get(page.noteId).relPath + ")" : ""}`);
    console.log(`  tree       ${page.treeName}`);
    console.log(`  file       ${page.file ?? "(folder only, no data file)"}`);
    console.log(`  path       ${page.ancestors.map((a) => a.title).concat(page.title).join(" › ")}`);
    console.log(`  position   ${page.entry.notePosition ?? "(clone)"}   siblings: ${page.parent ? page.parent.entry.children.length : 0}`);
    console.log(`  type       ${page.entry.type}${page.entry.mime ? ` (${page.entry.mime})` : ""}`);
    console.log(`  alias      ${page.alias ?? "(none — no docUrl, dropped from the standalone help)"}`);
    console.log(`  url        ${page.url ?? "(none)"}`);
    if (page.treeName === "user") console.log(`  docName    ${page.docName ?? "(none)"}`);
    console.log(`  icon       ${page.icon ?? "(none → bx bx-file / bx bx-folder)"}`);
    const otherAttrs = (page.entry.attributes ?? []).filter((a) => !["shareAlias", "iconClass"].includes(a.name));
    if (otherAttrs.length) console.log(`  attributes ${otherAttrs.map((a) => `${a.type === "relation" ? "~" : "#"}${a.name}=${a.value}`).join("  ")}`);
    if (page.entry.attachments?.length) {
        console.log(`  attachments`);
        for (const a of page.entry.attachments) console.log(`    ${a.attachmentId}  ${a.dataFileName}  (${a.mime})`);
    }
    if (page.entry.children?.length) {
        console.log(`  children   ${page.entry.children.length}`);
        for (const c of page.entry.children) console.log(`    ${c.noteId}  ${c.title}${c.isClone ? " (clone)" : ""}`);
    }
    if (page.file) {
        const md = readPage(page);
        const headings = md.split("\n").filter((l) => /^#{2,4} /.test(l));
        if (headings.length) {
            console.log(`  outline`);
            for (const h of headings) console.log(`    ${h.replace(/^(#+) /, (m, hs) => "  ".repeat(hs.length - 2))}`);
        }
        console.log(`  words      ${md.split(/\s+/).length}`);
    }
    const inbound = findInboundLinks(index, page);
    console.log(`  linked from ${inbound.length} page(s)`);
    for (const p of inbound.slice(0, 15)) console.log(`    ${p}`);
    if (inbound.length > 15) console.log(`    … ${inbound.length - 15} more`);
    const refs = findCodeReferences(page);
    console.log(`  referenced from code: ${refs.length ? "" : "none — safe to rename, move or delete"}`);
    for (const r of refs) console.log(`    ${r}`);
    if (page.treeName === "user" && page.file) {
        const html = page.file.replace(/\.md$/, ".html").replace(TREES.user.dir, TREES.user.html);
        console.log(`  help html  ${fs.existsSync(path.join(ROOT, html)) ? html : "(missing — run sync)"}`);
    }
}

function tree() {
    const depthLimit = flags.depth ? Number(flags.depth) : 99;
    let root;
    let index;
    if (flags._[0]) {
        root = resolvePage(flags._[0]);
        index = root.index;
    } else {
        index = loadTree(flags.tree ?? "user");
        root = index.root;
    }
    const print = (page, depth) => {
        const marks = [page.alias ? `/${page.alias}` : "(no alias)", page.icon ?? ""].filter(Boolean).join("  ");
        console.log(`${"  ".repeat(depth)}${page.title}  ${dim(page.noteId)}  ${dim(marks)}${page.isClone ? dim("  clone") : ""}`);
        if (depth >= depthLimit) return;
        for (const child of page.children) print(child, depth + 1);
    };
    print(root, 0);
}

function newPage() {
    const [parentQuery, title] = flags._;
    if (!parentQuery || !title) die('usage: new <parent> "<Title>" [--alias slug] [--icon bx-name] [--after <sibling>|--first] [--tree t]');
    const parent = resolvePage(parentQuery, flags.tree);
    if (parent.isClone) die("the parent is a clone entry; pick its primary location");
    const index = parent.index;
    const treeName = parent.treeName;

    checkTitle(title, parent);
    const alias = flags.alias ?? slugify(title);
    checkAlias(alias, parent);
    const icon = flags.icon ? normalizeIconClass(flags.icon) : undefined;
    if (icon) assertIconExists(icon);
    if (!icon && treeName !== "release") warn("no --icon given; the page will show as a generic file icon in the help tree (see `icons <query>`)");

    const noteId = newEntityId();
    const dataFileName = `${sanitize(title)}.md`;
    const parentDir = childrenDir(parent);
    const filePath = path.join(parentDir, dataFileName);
    if (fs.existsSync(path.join(ROOT, filePath))) die(`${filePath} already exists`);

    const attributes = [];
    if (alias) attributes.push({ type: "label", name: "shareAlias", value: alias, isInheritable: false, position: 10 });
    if (icon) attributes.push({ type: "label", name: "iconClass", value: icon, isInheritable: false, position: 20 });
    const entry = {
        isClone: false,
        noteId,
        notePath: [...parent.entry.notePath, noteId],
        title,
        notePosition: 0,
        prefix: null,
        isExpanded: false,
        type: "text",
        mime: "text/html",
        attributes,
        format: "markdown",
        dataFileName,
        attachments: []
    };

    // A leaf parent becomes a folder: it gains a directory, but keeps its own .md where it was.
    if (!parent.entry.children) {
        parent.entry.dirFileName = sanitize(parent.title);
        parent.entry.children = [];
        fs.mkdirSync(path.join(ROOT, parentDir), { recursive: true });
    }
    insertChild(parent.entry, entry, flags);

    fs.writeFileSync(path.join(ROOT, filePath), `# ${title}\n`);
    writeMeta(index);
    console.log(`created ${filePath}`);
    console.log(`  noteId ${noteId}   alias ${alias ?? "(none)"}   icon ${icon ?? "(none)"}   position ${entry.notePosition}`);
    if (alias) console.log(`  url    ${computeUrl(parent, alias)}`);
    console.log(`\nWrite the page, then \`docs.mjs sync\` to normalize it and generate the help HTML.`);
    console.log(`Link it from its parent with:\n  <a class="reference-link" href="${relativeHref(parent, { ...entry, file: filePath })}">${escapeHtml(title)}</a>`);
}

function image() {
    const [pageQuery, file] = flags._;
    if (!pageQuery || !file) die("usage: image <page> <file.png|.gif|.webp|.jpg> [--title name.png]");
    const page = resolvePage(pageQuery, flags.tree);
    if (!page.file) die("the page has no data file; images attach to a page with content");
    const source = path.resolve(file);
    if (!fs.existsSync(source)) die(`${file} not found`);
    const ext = path.extname(source).toLowerCase();
    const mime = { ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" }[ext];
    if (!mime) die(`unsupported image type ${ext}`);
    const title = flags.title ?? `image${ext}`;
    const dir = path.dirname(page.file);
    const base = `${path.basename(page.file, ".md")}_${title}`;
    const dataFileName = uniqueFileName(path.join(ROOT, dir), base);
    fs.copyFileSync(source, path.join(ROOT, dir, dataFileName));
    const attachment = { attachmentId: newEntityId(), title, role: "image", mime, position: 10, dataFileName };
    page.entry.attachments = [...(page.entry.attachments ?? []), attachment].sort((a, b) => a.attachmentId.localeCompare(b.attachmentId));
    writeMeta(page.index);
    const dims = imageDimensions(fs.readFileSync(source));
    const src = escapeHtml(dataFileName);
    console.log(`added ${path.join(dir, dataFileName)} as attachment ${attachment.attachmentId}`);
    console.log(`\nPaste into ${page.file}:`);
    if (dims) {
        console.log(`  <figure class="image image-style-align-center"><img style="aspect-ratio:${dims.width}/${dims.height};" src="${src}" width="${dims.width}" height="${dims.height}"></figure>`);
        console.log(`  <figure class="image image-style-align-right image_resized" style="width:50%;"><img style="aspect-ratio:${dims.width}/${dims.height};" src="${src}" width="${dims.width}" height="${dims.height}"></figure>`);
    } else {
        console.log(`  <img src="${src}">`);
    }
    console.log(`Then \`docs.mjs sync\` copies it into the help HTML tree.`);
}

function rename() {
    const [pageQuery, title] = flags._;
    if (!pageQuery || !title) die('usage: rename <page> "<New title>"');
    const page = resolvePage(pageQuery, flags.tree);
    if (page.isClone) die("rename the primary entry, not the clone");
    checkTitle(title, page.parent, page);
    const oldTitle = page.title;
    page.entry.title = title;
    if (page.file) {
        const md = readPage(page);
        const lines = md.split("\n");
        if (lines[0] === `# ${oldTitle}`) lines[0] = `# ${title}`;
        fs.writeFileSync(path.join(ROOT, page.file), lines.join("\n"));
    }
    writeMeta(page.index);
    console.log(`retitled "${oldTitle}" → "${title}" (noteId ${page.noteId} unchanged)`);
    console.log(`Now run \`docs.mjs sync\`: it renames the file, its attachments and the folder, and rewrites every link to the page.`);
    if (page.alias === slugify(oldTitle)) console.log(`The alias is still "${page.alias}"; keep it if the URL is referenced (\`show\`), otherwise set the new one in !!!meta.json before syncing.`);
}

function move() {
    const [pageQuery, parentQuery] = flags._;
    if (!pageQuery || !parentQuery) die("usage: move <page> <new-parent> [--after <sibling>|--first]");
    const page = resolvePage(pageQuery, flags.tree);
    if (page.isClone) die("move the primary entry, not the clone");
    const parent = resolvePage(parentQuery, page.treeName);
    if (parent.isClone) die("the destination is a clone entry; pick its primary location");
    if (parent.noteId === page.noteId || parent.ancestors.some((a) => a.noteId === page.noteId)) die("cannot move a page under itself");
    const index = page.index;

    // Files first, so a failure leaves the meta untouched.
    const oldDir = page.file ? path.dirname(page.file) : childrenDir(page.parent);
    const newDir = childrenDir(parent);
    if (!parent.entry.children) {
        parent.entry.dirFileName = sanitize(parent.title);
        parent.entry.children = [];
    }
    fs.mkdirSync(path.join(ROOT, newDir), { recursive: true });
    const moved = [];
    const moveFile = (name) => {
        if (fs.existsSync(path.join(ROOT, newDir, name))) die(`${path.join(newDir, name)} already exists`);
        fs.renameSync(path.join(ROOT, oldDir, name), path.join(ROOT, newDir, name));
        moved.push(name);
    };
    if (page.entry.dataFileName) moveFile(page.entry.dataFileName);
    for (const a of page.entry.attachments ?? []) moveFile(a.dataFileName);
    if (page.entry.dirFileName) moveFile(page.entry.dirFileName);

    const siblings = page.parent.entry.children;
    siblings.splice(siblings.indexOf(page.entry), 1);
    if (siblings.length === 0 && page.parent.entry.dataFileName) {
        delete page.parent.entry.children;
        delete page.parent.entry.dirFileName;
        fs.rmSync(path.join(ROOT, oldDir), { recursive: true, force: true });
    }
    const rePath = (entry, parentPath) => {
        entry.notePath = [...parentPath, entry.noteId];
        for (const c of entry.children ?? []) rePath(c, entry.notePath);
    };
    rePath(page.entry, parent.entry.notePath);
    insertChild(parent.entry, page.entry, flags);
    writeMeta(index);
    console.log(`moved "${page.title}" under "${parent.title}" (position ${page.entry.notePosition}); moved ${moved.length} file(s)`);
    console.log(`Now run \`docs.mjs sync\` to rewrite links and the help tree.`);
    if (page.alias) console.log(`URL changes to ${computeUrl(parent, page.alias)} — check \`show\` for code that hard-codes the old one.`);
}

function deletePage() {
    const page = resolvePage(flags._[0], flags.tree);
    if (page.isClone) die("delete the clone by removing its entry from !!!meta.json; this command removes primary pages");
    if (page.entry.children?.length) die("the page has children; move or delete them first");
    const refs = findCodeReferences(page);
    if (refs.length && !flags.force) {
        console.error(`refusing: the app links to this page\n  ${refs.join("\n  ")}\nRepoint those first (or --force).`);
        process.exit(1);
    }
    const inbound = findInboundLinks(page.index, page);
    const dir = page.file ? path.dirname(page.file) : childrenDir(page.parent);
    if (page.entry.dataFileName) fs.rmSync(path.join(ROOT, dir, page.entry.dataFileName), { force: true });
    for (const a of page.entry.attachments ?? []) fs.rmSync(path.join(ROOT, dir, a.dataFileName), { force: true });
    const siblings = page.parent.entry.children;
    siblings.splice(siblings.indexOf(page.entry), 1);
    if (siblings.length === 0 && page.parent.entry.dataFileName) {
        delete page.parent.entry.children;
        delete page.parent.entry.dirFileName;
        fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
    }
    writeMeta(page.index);
    console.log(`deleted "${page.title}" (${page.noteId})`);
    if (inbound.length) console.log(`${inbound.length} page(s) still link to it — fix them before \`sync\`:\n  ${inbound.join("\n  ")}`);
    else console.log(`Now run \`docs.mjs sync\` to drop it from the help tree.`);
}

function icons() {
    const packs = flags.pack ? [flags.pack] : Object.keys(ICON_PACKS);
    if (flags.check) {
        const problems = checkIconUsage(loadTree("user")).concat(checkIconUsage(loadTree("dev")));
        for (const p of problems) console.log(p);
        console.log(problems.length ? `${problems.length} unknown icon class(es)` : "every icon class in the docs exists in a built-in pack");
        return;
    }
    const query = flags._.map((q) => q.toLowerCase());
    if (!query.length) die("usage: icons <query...> [--pack bx|cke] | icons --check");
    for (const pack of packs) {
        const manifest = loadIconPack(pack);
        const matches = Object.entries(manifest.icons).filter(([name, def]) => query.every((q) => name.includes(q) || (def.terms ?? []).some((t) => t.includes(q))));
        if (!matches.length) continue;
        console.log(`${pack} (${pack === "cke" ? "text editor toolbar" : "app UI, boxicons"}) — ${matches.length} match(es)`);
        for (const [name] of matches.slice(0, 40)) console.log(`  <span class="tn-icon ${pack} ${name}"></span>`);
        if (matches.length > 40) console.log(`  … ${matches.length - 40} more`);
    }
}

function impact() {
    const terms = new Map(); // term → origin
    const pagesFromCode = new Map(); // noteId → files
    if (flags.diff !== undefined) {
        const range = typeof flags.diff === "string" ? flags.diff : defaultDiffBase();
        const diff = git(["diff", range, "--", "apps", "packages", ":!apps/server/src/assets/doc_notes", ":!apps/standalone/src/assets/help_meta.json"]);
        let file = "";
        const touched = new Set();
        for (const line of diff.split("\n")) {
            if (line.startsWith("+++ b/")) { file = line.slice(6); touched.add(file); continue; }
            if (/translations\/en\/(translation|entry|server)\.json$/.test(file) && /^[-+]\s*"[^"]+":\s*"/.test(line)) {
                const value = line.replace(/^[-+]\s*"[^"]+":\s*"/, "").replace(/",?\s*$/, "").replace(/\\"/g, '"');
                const plain = value.replace(/\{\{-?\s*\w+\s*\}\}/g, "").trim();
                if (plain.length >= 4 && !/^[\W\d]*$/.test(plain)) terms.set(plain, `${line[0] === "-" ? "removed" : "added"} string in ${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file)}`);
            }
            if (/^[-+]/.test(line) && !/^[-+]{3}/.test(line) && file.startsWith("apps/client/src")) {
                for (const m of line.matchAll(/(?:helpPage(?:Id)?=["'{]+|_help_)([A-Za-z0-9]{12})/g)) pagesFromCode.set(m[1], `${file}`);
            }
        }
        for (const f of touched) {
            if (!f.startsWith("apps/client/src")) continue;
            const content = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), "utf-8") : "";
            for (const m of content.matchAll(/(?:helpPage(?:Id)?=["'{]+|_help_)([A-Za-z0-9]{12})/g)) pagesFromCode.set(m[1], f);
            if (/options_interface\.ts$/.test(f)) terms.set("Options", "options_interface.ts touched");
            if (/hidden_subtree(_launcherbar|_templates)?\.ts$/.test(f)) terms.set("Launch Bar", "hidden subtree touched");
            if (/keyboard_actions/.test(f)) terms.set("Keyboard Shortcuts", "keyboard actions touched");
        }
        console.log(`diff ${range}: ${touched.size} code file(s), ${terms.size} UI string(s) changed, ${pagesFromCode.size} help page(s) wired from touched code\n`);
    }
    for (const t of flags._) terms.set(t, "argument");
    if (!terms.size && !pagesFromCode.size) die("usage: impact --diff [<git range>] | impact <term...>\n(no changed UI strings or help pages found in the diff — pass the feature's names as terms)");

    const index = loadTree("user");
    const bodies = new Map(index.pages.filter((p) => p.file && !p.isClone).map((p) => [p, stripHtml(readPage(p)).toLowerCase()]));
    const report = new Map(); // page → reasons
    const add = (page, reason) => report.set(page, [...(report.get(page) ?? []), reason]);
    for (const [term, origin] of terms) {
        const needle = term.toLowerCase();
        for (const [page, body] of bodies) {
            if (body.includes(needle)) add(page, `mentions "${term}" (${origin})`);
        }
    }
    for (const [noteId, file] of pagesFromCode) {
        const page = index.byId.get(noteId);
        if (page) add(page, `help page of ${file}`);
        else add({ title: `(missing page ${noteId})`, relPath: "", noteId }, `help page of ${file} — DOES NOT EXIST`);
    }
    if (!report.size) {
        console.log("no User Guide page mentions these terms. If the change is user-facing, that is the finding: the feature needs a page or a section (see `new`).");
        return;
    }
    console.log(`${report.size} page(s) to review:`);
    for (const [page, reasons] of [...report].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${page.relPath || page.title}  ${dim(page.noteId)}`);
        for (const r of [...new Set(reasons)]) console.log(`  - ${r}`);
    }
    console.log(`\nRead every hit; a page that describes a changed control, label, shortcut, default or location is out of date until edited.`);
}

function check() {
    const trees = flags.tree ? [flags.tree] : Object.keys(TREES);
    const errors = [];
    const warnings = [];
    for (const treeName of trees) {
        const index = loadTree(treeName);
        checkStructure(index, errors, warnings);
        checkContent(index, errors, warnings);
        if (treeName === "user") checkHtmlMirror(index, errors, warnings);
    }
    if (trees.includes("user")) {
        checkCodeReferences(loadTree("user"), errors);
        checkUrlLiterals(errors);
    }
    for (const e of errors) console.log(`ERROR  ${e}`);
    for (const w of warnings) console.log(`warn   ${w}`);
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
    if (errors.length) process.exit(1);
}

function sync() {
    console.log("regenerating every docs tree headless (import → export, ~10 s)…");
    const before = gitStatusDocs();
    const result = spawnSync("pnpm", ["edit-docs:sync-docs"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], encoding: "utf-8" });
    if (result.status !== 0) {
        console.error(result.stdout.split("\n").slice(-30).join("\n"));
        die("sync failed — the import rejects a tree whose !!!meta.json and files disagree; run `check`");
    }
    const after = gitStatusDocs();
    const groups = { "docs/ Markdown": [], "docs/ !!!meta.json": [], "help HTML (doc_notes)": [], "help meta": [], images: [] };
    for (const [status, file] of after) {
        const bucket = /!!!meta\.json$/.test(file) && file.startsWith("docs/") ? "docs/ !!!meta.json"
            : /help_meta\.json$|doc_notes.*!!!meta\.json$/.test(file) ? "help meta"
            : /\.(png|gif|webp|jpe?g|svg)$/i.test(file) ? "images"
            : file.startsWith("docs/") ? "docs/ Markdown" : "help HTML (doc_notes)";
        groups[bucket].push(`${status} ${file}`);
    }
    const changedBySync = after.filter(([, f]) => !before.some(([, g]) => g === f)).length;
    console.log(`\nsynced. ${after.length} file(s) differ from HEAD across the docs trees (${changedBySync} first touched by this sync):`);
    for (const [name, files] of Object.entries(groups)) {
        if (!files.length) continue;
        console.log(`  ${name}: ${files.length}`);
        for (const f of files.slice(0, 8)) console.log(`    ${f}`);
        if (files.length > 8) console.log(`    … ${files.length - 8} more`);
    }
    console.log(`\nReview with \`git diff -- docs\` (your Markdown, normalized) and \`git diff --stat -- apps/server/src/assets/doc_notes\`.`);
    console.log(`Reflow, shifted &nbsp; and <li><p> churn in the HTML is expected; a changed href, a dropped <img> or lost text is not.`);
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

function checkStructure(index, errors, warnings) {
    const { treeName } = index;
    const seen = new Map();
    const aliasPaths = new Map();
    const onDisk = new Set();
    const walkDisk = (dir) => {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
            const rel = path.join(dir, name);
            if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walkDisk(rel);
            else if (name !== "!!!meta.json") onDisk.add(rel);
        }
    };
    walkDisk(index.tree.dir);
    const expected = new Set();

    for (const page of index.pages) {
        const where = `${treeName}: ${page.relPath} (${page.noteId})`;
        if (page.isClone) {
            if (!index.byId.has(page.noteId)) errors.push(`${where}: clone of a note that is not in the tree`);
            if (page.file) expected.add(page.file);
            continue;
        }
        if (seen.has(page.noteId)) errors.push(`${where}: duplicate noteId (also ${seen.get(page.noteId)})`);
        seen.set(page.noteId, page.relPath);
        if (!/^[A-Za-z0-9]{12}$/.test(page.noteId)) errors.push(`${where}: noteId is not 12 alphanumerics`);
        const expectedPath = [...page.ancestors.map((a) => a.noteId), page.noteId];
        if (JSON.stringify(page.entry.notePath) !== JSON.stringify(expectedPath)) errors.push(`${where}: notePath does not match the ancestor chain`);
        if (page.file) {
            expected.add(page.file);
            if (!fs.existsSync(path.join(ROOT, page.file))) errors.push(`${where}: dataFileName ${page.entry.dataFileName} is missing on disk`);
        }
        if (page.entry.dirFileName) {
            if (!fs.existsSync(path.join(ROOT, childrenDir(page)))) errors.push(`${where}: dirFileName ${page.entry.dirFileName} is missing on disk`);
            if (!page.entry.children) warnings.push(`${where}: dirFileName without children`);
        } else if (page.entry.children?.length) errors.push(`${where}: has children but no dirFileName`);
        for (const a of page.entry.attachments ?? []) {
            const rel = path.join(page.file ? path.dirname(page.file) : childrenDir(page.parent), a.dataFileName);
            expected.add(rel);
            if (!fs.existsSync(path.join(ROOT, rel))) errors.push(`${where}: attachment ${a.dataFileName} is missing on disk`);
        }
        if (page.entry.type === "text") {
            if (page.entry.format !== "markdown") errors.push(`${where}: text note without format "markdown"`);
            if (page.file && !page.file.endsWith(".md")) errors.push(`${where}: text note data file is not .md`);
        }
        if (page.entry.notePosition !== undefined && page.entry.notePosition % 10 !== 0 && page.depth > 0) warnings.push(`${where}: notePosition ${page.entry.notePosition} is not a multiple of 10`);
        if (page.parent) {
            const siblings = page.parent.entry.children.filter((c) => !c.isClone);
            const i = siblings.indexOf(page.entry);
            if (i > 0 && siblings[i - 1].notePosition > page.entry.notePosition) errors.push(`${where}: children are not in ascending notePosition order`);
            else if (i > 0 && siblings[i - 1].notePosition === page.entry.notePosition) warnings.push(`${where}: shares notePosition ${page.entry.notePosition} with "${siblings[i - 1].title}"`);
        }
        if (treeName === "user" && page.docName && !DOC_NAME_CHARS.test(page.docName)) errors.push(`${where}: title/folder has a character the in-app help refuses (allowed: letters, digits, _ - ( ) & . , \` and space)`);
        if (page.entry.type === "text" && page.file && treeName !== "release") {
            if (!page.alias) warnings.push(`${where}: no shareAlias — no public URL, and dropped from the standalone help`);
            if (!page.icon && treeName === "user") warnings.push(`${where}: no iconClass`);
        }
        if (page.alias && !/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(page.alias)) warnings.push(`${where}: shareAlias "${page.alias}" is not kebab-case`);
        if (page.url) {
            if (aliasPaths.has(page.url)) errors.push(`${where}: URL ${page.url} is also used by ${aliasPaths.get(page.url)}`);
            aliasPaths.set(page.url, page.relPath);
        }
        if (page.icon && !iconExists(page.icon)) errors.push(`${where}: iconClass "${page.icon}" is in no built-in pack`);
        if ((page.entry.attributes ?? []).some((a, i) => i > 0 && page.entry.attributes[i - 1].position >= a.position)) warnings.push(`${where}: attribute positions are not ascending`);
    }
    for (const f of onDisk) if (!expected.has(f)) errors.push(`${treeName}: ${f} is on disk but in no !!!meta.json entry (edit-docs would crash on it)`);
}

function checkContent(index, errors, warnings) {
    const { treeName } = index;
    const titleByFile = new Map(index.pages.filter((p) => p.file).map((p) => [p.file, p.title]));
    for (const page of index.pages) {
        if (!page.file || page.isClone || !page.file.endsWith(".md")) continue;
        const md = readPage(page);
        const where = `${treeName}: ${page.relPath}`;
        const lines = md.split("\n");
        let fenced = false;
        const prose = lines.map((l) => {
            if (/^\s*```/.test(l)) { fenced = !fenced; return ""; }
            return fenced ? "" : l;
        }).join("\n");
        if (!md.trim()) warnings.push(`${where}: empty page`);
        else if (lines[0] !== `# ${page.title}`) warnings.push(`${where}: line 1 is not "# ${page.title}" (the importer demotes a differing H1)`);
        const dir = path.dirname(page.file);
        const usedAttachments = new Set();
        for (const [, href] of prose.matchAll(/(?:href|src)="([^"]+)"/g)) checkLink(unescapeHtml(href), false);
        for (const [, href] of prose.matchAll(/\]\(((?:\\.|[^()\s])+)\)/g)) checkLink(href.replace(/\\([()])/g, "$1"), true);
        for (const [, cls] of prose.matchAll(/<span class="tn-icon ([^"]+)"/g)) {
            if (!iconExists(cls)) errors.push(`${where}: unknown icon class "${cls}"`);
        }
        for (const a of page.entry.attachments ?? []) {
            if (!usedAttachments.has(a.dataFileName)) warnings.push(`${where}: attachment ${a.dataFileName} is not referenced by the page (edit-docs erases unused attachments)`);
        }
        for (const [n, l] of prose.split("\n").entries()) {
            if (treeName !== "user") break;
            const at = `${where}:${n + 1}`;
            if (/[A-Za-z]\\\\[A-Za-z]/.test(l)) warnings.push(`${at}: stray backslash inside a word ("${l.match(/\w*\\\\\w*/)[0]}")`);
            if (/\b(colour|centre|organis(e|ation)|customis|behaviour|synchronis|recognis|licence\b|grey\b)/i.test(l) && !/```|http/.test(l)) warnings.push(`${at}: British spelling (the docs are US English)`);
            if (/TriliumNext Notes/.test(l)) warnings.push(`${at}: "TriliumNext Notes" — the product is "Trilium"`);
            if (/\b(Ctrl|Shift|Alt|Cmd)\s*\+\s*\w/.test(l) && !/<kbd>/.test(l) && !/^\s*[`|]|```/.test(l)) warnings.push(`${at}: plain-text shortcut — write each key as <kbd>…</kbd>`);
            for (const [, href, text] of l.matchAll(/<a class="reference-link" href="([^"]+)">([^<]*)<\/a>/g)) {
                const target = resolveRelative(dir, unescapeHtml(href));
                const title = titleByFile.get(target);
                if (title && unescapeHtml(text) !== title) warnings.push(`${at}: reference-link text "${unescapeHtml(text)}" differs from the target's title "${title}"`);
                if (text === "[missing note]") errors.push(`${at}: reference-link to a missing note`);
            }
        }
        if (md.endsWith("\n") && treeName === "user") warnings.push(`${where}: trailing newline (the exporter writes none; \`sync\` normalizes it)`);

        function checkLink(href, isMarkdown) {
            if (/^(https?:|mailto:|data:)/.test(href)) return;
            const [target, hash] = href.split("#");
            if (href.startsWith("#root/")) {
                const id = href.split("/").pop().split("?")[0];
                if (!id.startsWith("_") && !index.byId.has(id) && !otherTreesHave(id)) errors.push(`${where}: link to #root/${id}, a note in no docs tree`);
                if (href.startsWith("#root/_options") || href.startsWith("#root/_backendLog") || href.startsWith("#root/_sqlConsole")) errors.push(`${where}: ${href} skips _hidden/ — the canonical path is #root/_hidden/…`);
                return;
            }
            if (href.startsWith("#")) return;
            if (!target) return;
            const rel = resolveRelative(dir, isMarkdown ? decodeURIComponent(target) : decodeURIComponent(target));
            if (/^api\//.test(target)) { errors.push(`${where}: link to ${target} (an unresolved in-app URL)`); return; }
            if (!fs.existsSync(path.join(ROOT, rel))) errors.push(`${where}: ${isMarkdown ? "link" : "href/src"} ${href} does not resolve (${rel})`);
            else if (path.dirname(rel) === dir) usedAttachments.add(path.basename(rel));
            void hash;
        }
    }
}

function checkHtmlMirror(index, errors, warnings) {
    const status = gitStatusDocs();
    const modifiedMd = status.filter(([, f]) => f.startsWith(`${TREES.user.dir}/`) && f.endsWith(".md")).map(([, f]) => f);
    for (const page of index.pages) {
        if (!page.file || page.depth === 0) continue;
        const html = page.file.replace(/\.md$/, ".html").replace(TREES.user.dir, TREES.user.html);
        if (page.file.endsWith(".md") && !fs.existsSync(path.join(ROOT, html))) { errors.push(`user: ${page.relPath} has no help HTML twin — run \`sync\``); continue; }
        if (modifiedMd.includes(page.file) && !status.some(([, f]) => f === html)) warnings.push(`user: ${page.relPath} is modified but its help HTML is not — run \`sync\``);
    }
    const helpMeta = JSON.parse(fs.readFileSync(path.join(ROOT, TREES.user.helpMeta), "utf-8"));
    const helpIds = new Set();
    const walk = (items) => { for (const i of items) { helpIds.add(i.id); walk(i.children ?? []); } };
    walk(helpMeta);
    for (const page of index.pages) {
        if (page.depth === 0 || page.isClone) continue;
        if (!helpIds.has(`_help_${page.noteId}`)) errors.push(`user: ${page.relPath} is not in the help meta (${TREES.user.helpMeta}) — run \`sync\``);
    }
}

function checkCodeReferences(index, errors) {
    const ids = new Set();
    const rg = grep(String.raw`(helpPage(Id)?=["'{]+|_help_)[A-Za-z0-9]{12}\b`, ["apps/client/src"]);
    for (const line of rg) {
        const [file, , ...rest] = line.split(":");
        const m = rest.join(":").match(/([A-Za-z0-9]{12})$/);
        if (m) ids.add([m[1], file]);
    }
    const inAppHelp = path.join(ROOT, "apps/client/src/services/in_app_help.ts");
    if (fs.existsSync(inAppHelp)) for (const m of fs.readFileSync(inAppHelp, "utf-8").matchAll(/[:=]\s*"([A-Za-z0-9]{12})"/g)) ids.add([m[1], "apps/client/src/services/in_app_help.ts"]);
    const reported = new Set();
    for (const [id, file] of ids) {
        if (index.byId.has(id) || reported.has(id)) continue;
        reported.add(id);
        errors.push(`code: ${file} links help page ${id}, which is not in the User Guide`);
    }
}

function checkUrlLiterals(errors) {
    const index = loadTree("user");
    const urls = new Set(index.pages.filter((p) => p.url).map((p) => p.url.replace(BASE_URL, "")));
    const devUrls = new Set(loadTree("dev").pages.filter((p) => p.url).map((p) => p.url.replace(BASE_URL, "")));
    for (const line of grep(String.raw`docs\.triliumnotes\.org/(user-guide|developer-guide)[^[:space:]"'\`)<>,]*`, URL_SCAN_FILES)) {
        const [file, ...rest] = line.split(":");
        for (const m of rest.join(":").matchAll(/docs\.triliumnotes\.org(\/(?:user-guide|developer-guide)[^\s"'`)<>,]*)/g)) {
            const p = m[1].replace(/\.html$/, "").replace(/\/$/, "").split(/[#?]/)[0];
            if (!urls.has(p) && !devUrls.has(p)) errors.push(`code: ${file} links ${m[1]}, which no page's shareAlias chain produces`);
        }
    }
}

function checkIconUsage(index) {
    const out = [];
    for (const page of index.pages) {
        if (page.icon && !iconExists(page.icon)) out.push(`${page.relPath}: iconClass "${page.icon}"`);
        if (!page.file || page.isClone || !page.file.endsWith(".md")) continue;
        for (const [, cls] of readPage(page).matchAll(/<span class="tn-icon ([^"]+)"/g)) if (!iconExists(cls)) out.push(`${page.relPath}: <span class="tn-icon ${cls}">`);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------------------------

/** Reads a tree's `!!!meta.json` and indexes every entry with its path, URL and docName. */
function loadTree(treeName) {
    if (treeCache.has(treeName)) return treeCache.get(treeName);
    const tree = TREES[treeName];
    if (!tree) die(`unknown tree "${treeName}" (user | dev | release)`);
    const metaPath = path.join(ROOT, tree.dir, "!!!meta.json");
    const raw = fs.readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(raw);
    const index = { treeName, tree, meta, metaPath, raw, pages: [], byId: new Map(), root: null };
    const visit = (entry, parent, dir, parentUrl, docNameRoot) => {
        const alias = entry.attributes?.find((a) => a.type === "label" && a.name === "shareAlias")?.value;
        const currentUrl = parentUrl && alias ? `${parentUrl}/${alias}` : parentUrl;
        const page = {
            entry, parent, index, treeName, isClone: entry.isClone === true,
            noteId: entry.noteId, title: entry.title, alias,
            url: alias ? currentUrl : undefined,
            icon: entry.attributes?.find((a) => a.type === "label" && a.name === "iconClass")?.value,
            depth: parent ? parent.depth + 1 : 0,
            ancestors: parent ? [...parent.ancestors, parent] : [],
            file: entry.dataFileName ? path.join(dir, entry.dataFileName) : undefined,
            children: []
        };
        page.relPath = page.file ?? path.join(dir, entry.dirFileName ?? entry.title);
        page.docName = treeName === "user" && entry.type === "text" && entry.dataFileName ? `${docNameRoot}/${path.basename(entry.dataFileName, ".md")}`.substring(1) : undefined;
        index.pages.push(page);
        if (!page.isClone) index.byId.set(entry.noteId, page);
        const childDir = entry.dirFileName ? path.join(dir, entry.dirFileName) : dir;
        const childDocRoot = entry.dirFileName ? `${docNameRoot}/${entry.dirFileName}` : docNameRoot;
        for (const child of entry.children ?? []) page.children.push(visit(child, page, childDir, currentUrl, childDocRoot));
        return page;
    };
    index.root = visit(meta.files[0], null, tree.dir, BASE_URL, `/${meta.files[0].dirFileName ?? ""}`);
    treeCache.set(treeName, index);
    return index;
}

function resolvePage(query, treeName) {
    if (!query) die("which page? give a noteId, a shareAlias, or a unique title/path fragment");
    const trees = treeName ? [treeName] : Object.keys(TREES);
    const candidates = [];
    for (const t of trees) {
        const index = loadTree(t);
        const exact = index.byId.get(query);
        if (exact) return exact;
        for (const p of index.pages) {
            if (p.isClone) continue;
            if (p.alias === query || p.title.toLowerCase() === query.toLowerCase()) candidates.push(p);
        }
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
        const q = query.toLowerCase();
        for (const t of trees) for (const p of loadTree(t).pages) if (!p.isClone && (p.title.toLowerCase().includes(q) || p.relPath.toLowerCase().includes(q))) candidates.push(p);
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) die(`no page matches "${query}"`);
    die(`"${query}" is ambiguous:\n${candidates.map((p) => `  ${p.noteId}  ${p.treeName}: ${p.relPath}`).join("\n")}\nuse the noteId`);
}

function readPage(page) {
    return fs.readFileSync(path.join(ROOT, page.file), "utf-8");
}

function childrenDir(page) {
    if (page.depth === 0) return path.join(page.index.tree.dir, page.entry.dirFileName ?? sanitize(page.title));
    const base = page.file ? path.dirname(page.file) : childrenDir(page.parent);
    return path.join(base, page.entry.dirFileName ?? sanitize(page.title));
}

function computeUrl(parent, alias) {
    const parentUrl = parent.url ?? parent.ancestors.concat(parent).reverse().find((a) => a.url)?.url ?? BASE_URL;
    return `${parentUrl}/${alias}`;
}

function relativeHref(fromPage, toEntry) {
    const fromDir = fromPage.file ? path.dirname(fromPage.file) : childrenDir(fromPage.parent);
    return path.relative(fromDir, toEntry.file).split("/").map(encodeURIComponent).join("/");
}

function insertChild(parentEntry, entry, opts) {
    const children = parentEntry.children;
    const positioned = children.filter((c) => !c.isClone);
    let at = children.length;
    if (opts.first) {
        at = 0;
        if (positioned.length && positioned[0].notePosition >= 20) {
            entry.notePosition = positioned[0].notePosition - 10;
        } else {
            for (const c of positioned) c.notePosition += 10;
            entry.notePosition = 10;
        }
    } else if (opts.after) {
        const sibling = children.find((c) => c.noteId === opts.after || c.title.toLowerCase() === String(opts.after).toLowerCase());
        if (!sibling) die(`--after: no sibling "${opts.after}" under "${parentEntry.title}"`);
        at = children.indexOf(sibling) + 1;
        const next = children.slice(at).find((c) => !c.isClone);
        if (next && next.notePosition - sibling.notePosition < 20) {
            for (const c of positioned.slice(positioned.indexOf(next))) c.notePosition += 10;
        }
        entry.notePosition = sibling.notePosition + 10;
    } else {
        entry.notePosition = positioned.length ? positioned[positioned.length - 1].notePosition + 10 : 10;
    }
    children.splice(at, 0, entry);
}

/** Rewrites the meta file in the exporter's layout: 4-space indent, no trailing newline. */
function writeMeta(index) {
    const ordered = orderKeys(index.meta);
    fs.writeFileSync(index.metaPath, JSON.stringify(ordered, null, 4));
}

function orderKeys(value) {
    if (Array.isArray(value)) return value.map(orderKeys);
    if (value && typeof value === "object") {
        const keys = Object.keys(value);
        const isEntry = keys.includes("noteId") && keys.includes("notePath");
        const sorted = isEntry ? [...ENTRY_KEY_ORDER.filter((k) => keys.includes(k)), ...keys.filter((k) => !ENTRY_KEY_ORDER.includes(k))] : keys;
        return Object.fromEntries(sorted.map((k) => [k, orderKeys(value[k])]));
    }
    return value;
}

function findInboundLinks(index, page) {
    if (!page.file) return [];
    const out = [];
    for (const other of index.pages) {
        if (!other.file || other.isClone || other === page || !other.file.endsWith(".md")) continue;
        const dir = path.dirname(other.file);
        const md = readPage(other);
        const hrefs = [...md.matchAll(/href="([^"]+)"/g)].map((m) => unescapeHtml(m[1])).concat([...md.matchAll(/\]\(((?:\\.|[^()\s])+)\)/g)].map((m) => m[1].replace(/\\([()])/g, "$1")));
        if (hrefs.some((h) => !/^(https?:|#)/.test(h) && resolveRelative(dir, decodeURIComponent(h.split("#")[0])) === page.file)) out.push(other.relPath);
    }
    return out;
}

function findCodeReferences(page) {
    const refs = [];
    for (const line of grep(page.noteId, CODE_SCAN_DIRS)) refs.push(`noteId in ${line.slice(0, 160)}`);
    if (page.url) {
        const p = page.url.replace(BASE_URL, "");
        for (const line of grep(`docs\\.triliumnotes\\.org${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.html)?([[:space:]"'\`)<>,/#?]|$)`, URL_SCAN_FILES)) refs.push(`url in ${line.split(":").slice(0, 2).join(":")}`);
    }
    return refs;
}

function otherTreesHave(id) {
    return Object.keys(TREES).some((t) => loadTree(t).byId.has(id));
}

// ---------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------

function checkTitle(title, parent, self) {
    if (!title.trim()) die("empty title");
    const docName = `${parent ? childrenDir(parent) : ""}/${sanitize(title)}`;
    if (parent && parent.treeName === "user" && !DOC_NAME_CHARS.test(docName.replace(/^docs\/User Guide\//, ""))) die(`the in-app help cannot open a page whose title has characters outside letters, digits, _ - ( ) & . , \` and space: "${title}"`);
    const fileBase = sanitize(title).toLowerCase();
    for (const c of parent?.entry.children ?? []) {
        if (c === self?.entry) continue;
        if ((c.dataFileName ?? "").toLowerCase() === `${fileBase}.md` || (c.dirFileName ?? "").toLowerCase() === fileBase) die(`a sibling already produces the file name "${sanitize(title)}"`);
    }
    if (sanitize(title) !== title) warn(`the file will be named "${sanitize(title)}.md" (illegal file-name characters dropped)`);
}

function checkAlias(alias, parent) {
    if (!alias) return;
    if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(alias)) die(`alias "${alias}" must be kebab-case (lowercase letters, digits, hyphens)`);
    const url = computeUrl(parent, alias);
    const clash = parent.index.pages.find((p) => p.url === url);
    if (clash) die(`alias "${alias}" gives ${url}, already used by ${clash.relPath}`);
}

function assertIconExists(cls) {
    if (!iconExists(cls)) die(`icon "${cls}" is in no built-in pack — try \`icons <query>\``);
}

function loadIconPack(pack) {
    if (!iconCache.has(pack)) iconCache.set(pack, JSON.parse(fs.readFileSync(path.join(ROOT, ICON_PACKS[pack]), "utf-8")));
    return iconCache.get(pack);
}

/** `bx bx-star`, `bx bxs-grid`, `cke cke-quote`, with optional modifiers such as `bx-flip-horizontal`. */
function iconExists(cls) {
    const parts = cls.trim().split(/\s+/);
    const pack = parts[0];
    if (!(pack in ICON_PACKS)) return false;
    const name = parts.find((p) => p !== pack && p.startsWith(`${pack}`) && !/^bx-(flip|rotate|spin|tada|flashing|burst|fade|pull|xs|sm|md|lg|fw|border|tada)/.test(p));
    return Boolean(name && loadIconPack(pack).icons[name]);
}

function normalizeIconClass(input) {
    const name = input.trim().replace(/^(bx|cke)\s+/, "");
    const pack = name.startsWith("cke-") ? "cke" : "bx";
    return `${pack} ${name}`;
}

// ---------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------

function newEntityId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (;;) {
        const id = Array.from(crypto.randomBytes(12), (b) => chars[b % chars.length]).join("");
        if (!Object.keys(TREES).some((t) => loadTree(t).raw.includes(id))) return id;
    }
}

/** What `sanitize-filename` does to a title on export. */
function sanitize(name) {
    return name.replace(/[/?<>\\:*|"\x00-\x1f\x80-\x9f]/g, "").replace(/^\.+$/, "").replace(/[. ]+$/, "").trim();
}

function slugify(title) {
    return title.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueFileName(dir, name) {
    const existing = fs.existsSync(dir) ? new Set(fs.readdirSync(dir).map((f) => f.toLowerCase())) : new Set();
    if (!existing.has(name.toLowerCase())) return name;
    for (let i = 1; ; i++) if (!existing.has(`${i}_${name}`.toLowerCase())) return `${i}_${name}`;
}

function imageDimensions(buf) {
    if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.toString("ascii", 0, 3) === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
        const chunk = buf.toString("ascii", 12, 16);
        if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i < buf.length) {
            if (buf[i] !== 0xff) return null;
            const marker = buf[i + 1];
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
            i += 2 + buf.readUInt16BE(i + 2);
        }
    }
    return null;
}

function resolveRelative(dir, href) {
    return path.normalize(path.join(dir, href));
}

function stripHtml(s) {
    return s.replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&");
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeHtml(s) {
    return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function grep(pattern, paths) {
    const existing = paths.filter((p) => fs.existsSync(path.join(ROOT, p)));
    const result = spawnSync("grep", ["-rnoE", "--include=*.ts", "--include=*.tsx", "--include=*.js", "--include=*.json", "--include=*.md", "--include=*.html", "--exclude-dir=node_modules", "--exclude-dir=dist", "--exclude-dir=doc_notes", "--exclude=help_meta.json", pattern, ...existing], { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    return (result.stdout ?? "").split("\n").filter(Boolean);
}

function git(argv) {
    return execFileSync("git", argv, { cwd: ROOT, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
}

function gitStatusDocs() {
    return git(["status", "--porcelain", "--", "docs", TREES.user.html, TREES.user.standaloneMeta]).split("\n").filter(Boolean).map((l) => [l.slice(0, 2).trim() || "M", l.slice(3).replace(/^"|"$/g, "").replace(/\\"/g, '"')]);
}

function defaultDiffBase() {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (branch === "main") return "HEAD";
    for (const main of ["main", "origin/main"]) {
        try { return execFileSync("git", ["merge-base", main, "HEAD"], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* next candidate */ }
    }
    return "HEAD";
}

function parseFlags(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith("--") && !["content", "check", "first", "force"].includes(key)) { out[key] = next; i++; }
            else out[key] = true;
        } else out._.push(a);
    }
    return out;
}

function dim(s) {
    return s ? `\x1b[2m${s}\x1b[0m` : "";
}

function warn(msg) {
    console.error(`warning: ${msg}`);
}

function die(msg) {
    console.error(msg);
    process.exit(1);
}

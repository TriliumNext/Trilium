#!/usr/bin/env node
/**
 * Compares CKEditor 5's stylesheets between two versions and audits Trilium's CSS against the
 * installed one. See references/upgrading-ckeditor.md.
 *
 *   node ck_css.mjs fetch <version>              download that version's dist CSS (cached)
 *   node ck_css.mjs stage <old-version>          copy it and the harnesses into packages/ckeditor5/src
 *   node ck_css.mjs run [content|ui|all]         run the staged harnesses, print their findings
 *   node ck_css.mjs clean                        remove everything `stage` wrote
 *   node ck_css.mjs audit                        our reads of --ck-* variables nothing declares
 *   node ck_css.mjs readers <css> <name...>      selectors that read var(--ck-<name>)
 *   node ck_css.mjs props <css> <prop> [regex]   selectors that set <prop>, optionally filtered
 *
 * <css> is `new` (the installed ckeditor5.css), a version number (fetched first), or a path.
 */
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SKILL_DIR, "../../..");
const PKG_SRC = join(REPO, "packages/ckeditor5/src");
const CACHE = join(tmpdir(), "trilium-ck-css");
const STAGED_PREFIX = "zz_ckcss_";
const OUR_CSS_DIRS = [ "apps/client/src", "packages/ckeditor5/src", "packages/share-theme/src" ];

const [ command, ...args ] = process.argv.slice(2);
const commands = { fetch, stage, run, clean, audit, readers, props };
if (!commands[command]) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1]
        .replace(/^ \* ?/gm, ""));
    process.exit(command ? 1 : 0);
}
commands[command](...args);

function fetch(version) {
    if (!version) throw new Error("fetch <version>");
    const dir = join(CACHE, version);
    const full = join(dir, "package/dist/ckeditor5.css");
    if (!existsSync(full)) {
        mkdirSync(dir, { recursive: true });
        execSync(`npm pack ckeditor5@${version} --silent`, { cwd: dir, stdio: "ignore" });
        const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
        execFileSync("tar", [ "-xzf", tarball, "package/dist/ckeditor5.css", "package/dist/ckeditor5-content.css" ], { cwd: dir });
    }
    const content = join(dir, "package/dist/ckeditor5-content.css");
    if (command === "fetch") console.log(`${full}\n${content}`);
    return { full, content };
}

function stage(version) {
    const { full, content } = fetch(version);
    copyFileSync(full, join(PKG_SRC, `${STAGED_PREFIX}old.css`));
    copyFileSync(content, join(PKG_SRC, `${STAGED_PREFIX}old_content.css`));
    for (const harness of readdirSync(join(SKILL_DIR, "harness"))) {
        copyFileSync(join(SKILL_DIR, "harness", harness), join(PKG_SRC, `${STAGED_PREFIX}${harness}`));
    }
    console.log(`Staged ckeditor5@${version} as the old side in ${relative(REPO, PKG_SRC)}; run, then clean.`);
}

function run(which = "all") {
    const names = which === "all" ? [ "content", "ui" ] : [ which ];
    for (const name of names) {
        const spec = `src/${STAGED_PREFIX}${name}.spec.ts`;
        if (!existsSync(join(REPO, "packages/ckeditor5", spec))) throw new Error(`${spec} is not staged`);
        let output;
        try {
            output = execSync(`pnpm --filter @triliumnext/ckeditor5 exec vitest run ${spec}`,
                { cwd: REPO, encoding: "utf8", stdio: [ "ignore", "pipe", "pipe" ] });
        } catch (e) {
            output = `${e.stdout}\n${e.stderr}`;
        }
        const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
        const findings = lines.filter((l) => /^(DIFF|SAME|RULE) /.test(l));
        const failures = lines.filter((l) => /FAIL|Error:|×/.test(l) && !/map file|ENOENT/.test(l));
        console.log(`=== ${name}`);
        console.log(findings.length ? findings.join("\n") : "(no findings)");
        if (failures.length) console.log(`--- failures\n${failures.join("\n")}`);
    }
}

function clean() {
    for (const f of readdirSync(PKG_SRC).filter((f) => f.startsWith(STAGED_PREFIX))) rmSync(join(PKG_SRC, f));
    console.log("Removed the staged files.");
}

/** Our `var(--ck-x)` reads with no fallback, where neither CKEditor nor our CSS declares `--ck-x`. */
function audit() {
    const installed = readFileSync(join(REPO, "node_modules/ckeditor5/dist/ckeditor5.css"), "utf8");
    const declared = new Set(installed.match(/--ck-[\w-]+(?=\s*:)/g));
    const ours = OUR_CSS_DIRS.flatMap((dir) => walk(join(REPO, dir)).filter((f) => f.endsWith(".css")));
    for (const file of ours) for (const name of readFileSync(file, "utf8").match(/--ck-[\w-]+(?=\s*:)/g) ?? []) declared.add(name);
    let count = 0;
    for (const file of ours) {
        for (const [ index, line ] of readFileSync(file, "utf8").split("\n").entries()) {
            for (const [ , name ] of line.matchAll(/var\((--ck-[\w-]+)\)/g)) {
                if (declared.has(name)) continue;
                console.log(`${relative(REPO, file)}:${index + 1}  ${name}`);
                count++;
            }
        }
    }
    console.log(count ? `\n${count} read(s) of undeclared variables.` : "No reads of undeclared --ck-* variables.");
    console.log("A name also set by our CSS counts as declared: check that its scope covers the reader.");
}

function readers(css, ...names) {
    for (const { selector, line } of declarations(css)) {
        for (const name of names) {
            if (line.includes(`var(--ck-${name})`) || line.includes(`var(--ck-${name},`)) console.log(`--ck-${name}\t${selector}\t${line}`);
        }
    }
}

function props(css, prop, filter) {
    const regex = filter ? new RegExp(filter) : null;
    for (const { selector, line } of declarations(css)) {
        if (line.startsWith(`${prop}:`) && (!regex || regex.test(selector))) console.log(`${selector}\t${line}`);
    }
}

/** Every declaration of a multi-line, natively nested stylesheet, with its resolved selector chain. */
function declarations(css) {
    const file = css === "new" ? join(REPO, "node_modules/ckeditor5/dist/ckeditor5.css")
        : /^\d+\.\d+\.\d+$/.test(css) ? fetch(css).full : resolve(css);
    const stack = [];
    const result = [];
    for (const raw of readFileSync(file, "utf8").split("\n")) {
        const line = raw.trim();
        if (line.endsWith("{")) stack.push(line.slice(0, -1).trim());
        else if (line.includes(":") && !line.startsWith("}")) result.push({ selector: `[${stack.join(" > ")}]`, line });
        for (const c of line) if (c === "}") stack.pop();
    }
    return result;
}

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (entry === "node_modules" || entry === "dist") return [];
        return statSync(path).isDirectory() ? walk(path) : [ path ];
    });
}

#!/usr/bin/env node
/**
 * Review workbench for Trilium pull requests: the facts a merge decision needs, fetched and
 * computed once, so a review never argues from a PR's title or description.
 *
 *   node .claude/skills/reviewing-pull-requests/review.mjs <command> [args]
 *
 *   list [--all] [--json] [--sort=age|size]   every open PR: kind, size by file kind, linked
 *                                             issues, flags, rivals (bots and maintainer drafts
 *                                             skipped unless --all)
 *   dossier <N> [--diff]        one PR in full: description, linked issues with their discussion,
 *                               commits, files by kind, human review threads (bots folded), rivals
 *   verify <N> [--no-typecheck] [--no-standalone] [--no-siblings]
 *                               fetch the PR into .claude/worktrees/pr-N, install, typecheck, run
 *                               its specs green on the branch and red with the production files
 *                               reverted to the merge-base, run the touched modules' own specs,
 *                               list dependency and docs impact
 *   issue <N>                   an issue with its human comments: the problem statement itself
 *   dupes                       open PRs that compete for the same issue or the same subject
 *   clean [N]                   remove the verify worktree(s) and their refs
 *
 * `dossier` and `verify` also save their report under .claude/reviews/pr-N/ (gitignored) so a
 * triage can come back to it. Nothing here writes to GitHub: a review is reading, and the
 * maintainer speaks to contributors in person.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SKILL_DIR, "../../..");
const WORKTREES = path.join(ROOT, ".claude/worktrees");
const REVIEWS = path.join(ROOT, ".claude/reviews");
const DOCS_MJS = path.join(ROOT, ".claude/skills/writing-documentation/docs.mjs");
let repoSlug;

const BOT_LOGIN = /\[bot\]$|^(greptile|codecov|renovate|dependabot|weblate|coderabbit|copilot|github-actions)/i;
const MAINTAINER_ASSOC = new Set(["OWNER", "MEMBER"]);
const PR_FIELDS = [
    "number", "title", "body", "url", "author", "isDraft", "createdAt", "updatedAt", "baseRefName",
    "headRefName", "headRepositoryOwner", "isCrossRepository", "additions", "deletions",
    "changedFiles", "labels", "reviewDecision", "closingIssuesReferences", "files", "commits",
    "reviews", "comments", "statusCheckRollup", "maintainerCanModify"
];
/** Words too common in this repo's PR titles to say two of them are about the same thing. */
const TITLE_NOISE = new Set([
    "note", "notes", "trilium", "with", "from", "that", "this", "into", "when", "then", "than",
    "after", "before", "only", "also", "over", "instead", "should", "adds", "added", "make",
    "makes", "support", "feature", "option", "allow", "allows", "using", "users", "user", "their"
]);

/** Where a spec file's runner lives, and the extra CLI it needs. */
const RUNNERS = {
    "packages/trilium-core": ["apps/server", "apps/standalone"],
    "apps/server": ["apps/server"],
    "apps/client": ["apps/client"],
    "apps/standalone": ["apps/standalone"],
    "apps/desktop": ["apps/desktop"],
    "packages/commons": ["packages/commons"],
    "packages/ckeditor5": ["packages/ckeditor5"]
};
const RUNNER_ARGS = { "apps/desktop": ["--config", "vitest.config.mts"] };

const args = process.argv.slice(2);
const command = args.shift();
const flags = parseFlags(args);

const COMMANDS = { list, dossier, verify, issue, dupes, clean, help };
if (!command || !(command in COMMANDS)) {
    help();
    process.exit(command ? 1 : 0);
}
await COMMANDS[command]();

// ---------------------------------------------------------------------------------------------
// list

async function list() {
    const prs = openPrs();
    const rows = prs.map((pr) => describePr(pr, prs));
    const shown = flags.all ? rows : rows.filter((r) => !r.bot && !(r.isDraft && r.maintainer));
    if (flags.sort === "age") shown.sort((a, b) => b.ageDays - a.ageDays);
    else if (flags.sort === "size") shown.sort((a, b) => b.mix.prod.lines - a.mix.prod.lines);
    if (flags.json) {
        console.log(JSON.stringify(shown, null, 2));
        return;
    }
    const hidden = rows.length - shown.length;
    console.log(`${shown.length} open PR(s)${hidden ? ` (${hidden} bot/maintainer-draft hidden; --all shows them)` : ""}\n`);
    for (const r of shown) console.log(listRow(r));
    const byKind = countBy(shown, (r) => r.kind);
    const rivals = shown.filter((r) => r.rivals.length);
    console.log(`\nby kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    console.log(`without a spec change: ${shown.filter((r) => r.mix.spec.files === 0 && r.kind !== "docs").length}`
        + ` · without docs among feat: ${shown.filter((r) => r.kind === "feat" && r.mix.docs.files === 0).length}`
        + ` · first-time contributors: ${shown.filter((r) => r.association === "FIRST_TIME_CONTRIBUTOR").length}`
        + ` · with rivals: ${rivals.length} (see \`dupes\`)`);
    console.log(`\nA row is a fact sheet, not a verdict: \`dossier <N>\` then \`verify <N>\` before judging one.`);
}

function listRow(r) {
    const who = `${r.author}${r.maintainer ? "·maint" : r.association === "FIRST_TIME_CONTRIBUTOR" ? "·first" : r.association === "COLLABORATOR" ? "·collab" : ""}`;
    const size = (m) => (m.files ? `+${m.add}/-${m.del} (${m.files}f)` : "—");
    const issues = r.issues.closing.length ? `closes #${r.issues.closing.join(",#")}` : r.issues.mentioned.length ? `mentions #${r.issues.mentioned.slice(0, 3).join(",#")}` : "no issue";
    const extra = [
        r.flags.length ? `flags: ${r.flags.join(",")}` : "",
        r.rivals.length ? `rivals: #${r.rivals.join(",#")}` : "",
        r.isDraft ? "DRAFT" : ""
    ].filter(Boolean).join("  ");
    return `#${String(r.number).padEnd(6)} ${r.kind.padEnd(8)} ${`${r.ageDays}d`.padEnd(5)} ${who.padEnd(24)} `
        + `prod ${size(r.mix.prod).padEnd(18)} spec ${size(r.mix.spec).padEnd(16)} docs ${size(r.mix.docs).padEnd(14)} `
        + `${issues.padEnd(22)} ${extra}\n        ${r.title}`;
}

// ---------------------------------------------------------------------------------------------
// dossier

async function dossier() {
    const number = requireNumber();
    const pr = ghJson(["pr", "view", String(number), "--json", PR_FIELDS.join(",")]);
    const rest = ghJson(["api", `repos/${repo()}/pulls/${number}`]);
    const prs = openPrs();
    const d = describePr({ ...pr, authorAssociation: rest.author_association }, prs);
    const threads = reviewThreads(number);
    const out = [];
    const p = (s = "") => out.push(s);

    p(`# PR #${d.number} — ${d.title}`);
    p(pr.url);
    const head = pr.isCrossRepository ? `${pr.headRepositoryOwner?.login}:${pr.headRefName} (fork${pr.maintainerCanModify ? ", maintainers can push" : ", maintainers cannot push"})` : pr.headRefName;
    p(`author ${d.author} (${d.association}) · opened ${d.ageDays}d ago · last update ${d.staleDays}d ago · ${pr.baseRefName} ← ${head}`);
    p(`labels: ${d.labels.join(", ") || "—"} · draft: ${pr.isDraft ? "yes" : "no"} · review decision: ${pr.reviewDecision || "—"}`
        + ` · mergeable: ${rest.mergeable_state ?? "?"} · checks: ${checkSummary(pr.statusCheckRollup)} (informational only)`);
    p(`kind: ${d.kind} · conventional subject: ${d.conventional ? "yes" : "NO"} · \`(closes #N)\` in subject: ${d.closesInSubject ? "yes" : "no"}`);
    p();
    p(`## Size`);
    p(`+${pr.additions}/-${pr.deletions} in ${pr.changedFiles} files: ${mixLine(d.mix)}${d.files.length < pr.changedFiles ? `  (GitHub lists only ${d.files.length} of ${pr.changedFiles} files; the file table and flags below are incomplete — \`git diff --stat\` in the verify worktree has them all)` : ""}`);
    p(`areas: ${d.areas.join(", ") || "—"}`);
    p(`flags: ${d.flags.length ? d.flags.join(", ") : "(none)"}`);
    if (d.rivals.length) p(`rivals: ${d.rivals.map((n) => `#${n}`).join(", ")} (see below)`);
    p();
    p(`## Files`);
    for (const f of d.files) p(`  ${f.kind.padEnd(14)} ${f.path}  +${f.additions}/-${f.deletions}  ${f.changeType?.[0] ?? ""}`);
    p();
    p(`## Commits (${pr.commits.length})`);
    for (const c of pr.commits) {
        p(`  ${c.oid.slice(0, 8)} ${c.messageHeadline}  [${c.authors.map((a) => a.login || a.name).join(", ")}]`);
        if (c.messageBody?.trim()) p(indent(c.messageBody.trim(), 4));
    }
    p();
    p(`## Description (verbatim, by the author)`);
    p(pr.body?.trim() ? clip(pr.body.trim(), 8000) : "(empty)");
    p();
    p(`## Linked issues`);
    if (!d.issues.closing.length && !d.issues.mentioned.length) p("(none — the PR itself is the only statement of the problem; check whether one exists: `gh issue list --search \"<keywords>\"`)");
    for (const n of d.issues.closing) p(issueText(n, "closes"));
    for (const n of d.issues.mentioned.slice(0, 5)) p(issueText(n, "mentions", true));
    p();
    p(`## Discussion (humans; bots folded)`);
    const bots = {};
    for (const c of pr.comments) {
        if (isBot(c.author?.login)) { bots[c.author.login] = (bots[c.author.login] ?? 0) + 1; continue; }
        p(`- comment by ${c.author?.login} (${c.authorAssociation}) ${c.createdAt?.slice(0, 10)}:`);
        p(indent(clip(c.body.trim(), 2500), 4));
    }
    for (const r of pr.reviews) {
        if (isBot(r.author?.login)) { bots[r.author.login] = (bots[r.author.login] ?? 0) + 1; continue; }
        p(`- review by ${r.author?.login} (${r.authorAssociation}) ${r.submittedAt?.slice(0, 10)}: ${r.state}${r.body?.trim() ? "" : " (no summary)"}`);
        if (r.body?.trim()) p(indent(clip(r.body.trim(), 2500), 4));
    }
    for (const t of threads) {
        const first = t.comments[0];
        if (!first || isBot(first.author)) { if (first) bots[first.author] = (bots[first.author] ?? 0) + 1; continue; }
        p(`- thread ${t.path}:${t.line ?? "?"} [${t.isResolved ? "resolved" : "OPEN"}${t.isOutdated ? ", outdated" : ""}] ${first.author} (${first.authorAssociation}), ${t.comments.length - 1} repl${t.comments.length === 2 ? "y" : "ies"}:`);
        p(indent(clip(first.body.trim(), 1500), 4));
        for (const c of t.comments.slice(1, 4)) p(indent(`↳ ${c.author}: ${clip(c.body.trim(), 600)}`, 4));
    }
    const botLine = Object.entries(bots).map(([k, n]) => `${k} ×${n}`).join(", ");
    if (botLine) p(`bots: ${botLine} — not reviewers; their findings are unverified suggestions, not maintainer asks`);
    if (!pr.comments.some((c) => !isBot(c.author?.login)) && !pr.reviews.some((r) => !isBot(r.author?.login)) && !threads.some((t) => t.comments[0] && !isBot(t.comments[0].author))) p("(no human has commented yet)");
    if (d.rivals.length) {
        p();
        p(`## Competing PRs`);
        for (const n of d.rivals) {
            const other = prs.find((x) => x.number === n);
            if (other) p(`- #${n} ${other.title} — ${other.author?.login}, ${daysSince(other.createdAt)}d, +${other.additions}/-${other.deletions}, closes ${other.closingIssuesReferences.map((i) => `#${i.number}`).join(",") || "—"}`);
        }
        p(`One issue, several PRs: judge them side by side and pick one; the others are declined or superseded, not "also fine".`);
    }
    p();
    p(`## Diff`);
    if (flags.diff) p(gh(["pr", "diff", String(number)]));
    else p(`Not inlined. \`gh pr diff ${number}\` prints it; after \`verify ${number}\` the branch is checked out in .claude/worktrees/pr-${number}, where the changed code can be read in the context of what surrounds it.`);

    const text = out.join("\n");
    console.log(text);
    save(number, "dossier.md", text);
}

function issueText(n, relation, brief = false) {
    let iss;
    try {
        iss = ghJson(["issue", "view", String(n), "--json", "number,title,state,stateReason,labels,author,body,comments,createdAt,url"]);
    } catch {
        return `### #${n} (${relation}) — not an issue in this repo, or not readable`;
    }
    const head = `### #${n} ${iss.title}  (${relation} · ${iss.state}${iss.stateReason ? "/" + iss.stateReason : ""} · ${iss.labels.map((l) => l.name).join(", ") || "no labels"} · by ${iss.author?.login} ${iss.createdAt?.slice(0, 10)})`;
    if (brief) return head;
    const lines = [head, iss.body?.trim() ? clip(iss.body.trim(), 5000) : "(no body)"];
    const humans = iss.comments.filter((c) => !isBot(c.author?.login));
    if (humans.length) {
        lines.push(`comments (${humans.length}):`);
        for (const c of humans) {
            const tag = MAINTAINER_ASSOC.has(c.authorAssociation) ? "MAINTAINER" : c.authorAssociation;
            lines.push(`- **${c.author?.login}** (${tag}) ${c.createdAt?.slice(0, 10)}:`);
            lines.push(indent(clip(c.body.trim(), 2000), 4));
        }
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// issue

async function issue() {
    console.log(issueText(requireNumber(), "issue"));
}

// ---------------------------------------------------------------------------------------------
// dupes

async function dupes() {
    const prs = openPrs().filter((pr) => !isBot(pr.author?.login));
    const rows = prs.map((pr) => describePr(pr, prs));
    const groups = [];
    const seen = new Set();
    for (const r of rows) {
        if (seen.has(r.number) || !r.rivals.length) continue;
        const group = [r.number];
        const queue = [...r.rivals];
        while (queue.length) {
            const n = queue.shift();
            if (group.includes(n)) continue;
            group.push(n);
            const other = rows.find((x) => x.number === n);
            if (other) queue.push(...other.rivals);
        }
        for (const n of group) seen.add(n);
        groups.push(group.sort((a, b) => a - b));
    }
    if (!groups.length) { console.log("no open PRs compete for the same issue or subject"); return; }
    console.log(`${groups.length} group(s) of competing PRs:\n`);
    for (const g of groups) {
        const members = g.map((n) => rows.find((x) => x.number === n)).filter(Boolean);
        const shared = members.map((m) => m.issues.closing).reduce((a, b) => a.filter((x) => b.includes(x)));
        console.log(shared.length ? `same issue #${shared.join(", #")}:` : "similar subject:");
        for (const m of members) {
            console.log(`  #${m.number} ${m.title}`);
            console.log(`        ${m.author} (${m.association}) · ${m.ageDays}d · prod +${m.mix.prod.add}/-${m.mix.prod.del} (${m.mix.prod.files}f) · spec ${m.mix.spec.files ? `+${m.mix.spec.add}/-${m.mix.spec.del}` : "—"} · docs ${m.mix.docs.files ? "yes" : "—"}${m.flags.length ? ` · ${m.flags.join(",")}` : ""}`);
        }
        console.log();
    }
    console.log("Review the members of a group together: the smaller change that fixes the cause usually wins, and the earlier PR earns no precedence by age alone.");
}

// ---------------------------------------------------------------------------------------------
// verify

async function verify() {
    const number = requireNumber();
    const pr = ghJson(["pr", "view", String(number), "--json", "number,title,headRefOid,baseRefName,files"]);
    const ref = `refs/pr/${number}`;
    const dir = path.join(WORKTREES, `pr-${number}`);
    const report = [];
    const p = (s = "") => report.push(s);
    const t0 = Date.now();

    step(`fetch #${number} and ${pr.baseRefName}`);
    git(["fetch", "-q", "origin", `+refs/pull/${number}/head:${ref}`, `+refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`]);
    if (fs.existsSync(dir)) git(["worktree", "remove", "--force", dir]);
    fs.mkdirSync(WORKTREES, { recursive: true });
    git(["worktree", "add", "--detach", "-q", dir, ref]);
    const wt = (argv, opts = {}) => execFileSync("git", argv, { cwd: dir, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, ...opts });
    const head = wt(["rev-parse", "HEAD"]).trim();
    const baseTip = git(["rev-parse", `origin/${pr.baseRefName}`]).trim();
    const mergeBase = wt(["merge-base", "HEAD", baseTip]).trim();
    const ahead = wt(["rev-list", "--count", `${mergeBase}..HEAD`]).trim();
    const behind = wt(["rev-list", "--count", `${mergeBase}..${baseTip}`]).trim();
    const changed = wt(["diff", "--name-status", "-M", mergeBase, "HEAD"]).trim().split("\n").filter(Boolean).map((line) => {
        const [status, a, b] = line.split("\t");
        return { status: status[0], path: b ?? a, oldPath: b ? a : undefined };
    });
    const specs = changed.filter((f) => f.status !== "D" && classify(f.path) === "spec" && !f.path.startsWith("packages/trilium-e2e/"));
    const prod = changed.filter((f) => classify(f.path) !== "spec" && /^(apps|packages)\//.test(f.path));
    const e2e = changed.filter((f) => f.path.startsWith("packages/trilium-e2e/"));

    p(`# verify #${number} — ${pr.title}`);
    p(`worktree ${path.relative(ROOT, dir)} @ ${head.slice(0, 10)} · ${pr.baseRefName} @ ${baseTip.slice(0, 10)} · merge-base ${mergeBase.slice(0, 10)} · ${ahead} commit(s) ahead, ${behind} behind`);
    p(`changed: ${changed.length} file(s) — ${specs.length} spec, ${prod.length} production/other under apps|packages, ${e2e.length} e2e`);
    p();

    step("pnpm install");
    const lockChanged = changed.some((f) => /pnpm-lock\.yaml$/.test(f.path));
    let install = run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], dir);
    if (install.status !== 0) install = run("pnpm", ["install", "--frozen-lockfile", "--offline"], dir);
    p(`## Toolchain`);
    p(`install: ${install.status === 0 ? "ok" : "FAILED"} in ${install.seconds}s${lockChanged ? " (the PR changes pnpm-lock.yaml)" : ""}`);
    if (install.status !== 0) p(indent(tail(install.output, 15), 4));

    if (!flags["no-typecheck"]) {
        step("pnpm typecheck");
        const tc = run("pnpm", ["typecheck"], dir);
        p(`typecheck: ${tc.status === 0 ? "ok" : "FAILED"} in ${tc.seconds}s`);
        if (tc.status !== 0) p(indent(tail(tc.output, 30), 4));
    } else p("typecheck: skipped (--no-typecheck)");
    p();

    // Test names the PR adds: the ones that must fail without the production change.
    const newTests = new Map();
    for (const s of specs) {
        const diff = s.status === "A" ? fs.readFileSync(path.join(dir, s.path), "utf-8").split("\n").map((l) => "+" + l).join("\n") : wt(["diff", mergeBase, "HEAD", "--", s.path]);
        const names = new Set();
        for (const m of diff.matchAll(/^\+\s*(?:it|test)(?:\.(?:each|only|concurrent))?\(\s*["'`](.+?)["'`]/gm)) names.add(m[1]);
        newTests.set(s.path, names);
    }

    p(`## Specs in the PR`);
    if (!specs.length) p(`NONE — the PR changes no spec file${e2e.length ? ` (it does change ${e2e.length} e2e file(s), not run here)` : ""}. A fix without a failing-then-passing spec is unverified by its author too.`);
    const plans = plan(specs.map((s) => s.path));
    const green = new Map();
    for (const [runner, files] of plans) {
        step(`green: ${runner} ← ${files.length} spec(s)`);
        green.set(runner, vitest(dir, runner, files, `green-${runner.replace("/", "-")}`));
    }

    let red = new Map();
    if (specs.length && prod.length) {
        step("red: revert production files to the merge-base");
        for (const f of prod) {
            if (f.status === "A") fs.rmSync(path.join(dir, f.path), { force: true });
            else if (f.status === "R") { fs.rmSync(path.join(dir, f.path), { force: true }); wt(["checkout", mergeBase, "--", f.oldPath]); }
            else wt(["checkout", mergeBase, "--", f.path]);
        }
        for (const [runner, files] of plans) {
            step(`red: ${runner} ← ${files.length} spec(s)`);
            red.set(runner, vitest(dir, runner, files, `red-${runner.replace("/", "-")}`));
        }
        step("restore the branch");
        for (const f of prod) {
            if (f.status === "D") fs.rmSync(path.join(dir, f.path), { force: true });
            else if (f.status === "R") { fs.rmSync(path.join(dir, f.oldPath), { force: true }); wt(["checkout", "HEAD", "--", f.path]); }
            else wt(["checkout", "HEAD", "--", f.path]);
        }
    } else if (specs.length) p("red run skipped: the PR changes no production file under apps|packages, so the specs have nothing to prove.");

    for (const [runner, files] of plans) {
        const g = green.get(runner);
        const r = red.get(runner);
        for (const file of files) {
            const gf = g.files.get(file);
            const rf = r?.files.get(file);
            p(`${file}  [${runner}]`);
            if (!gf) { p(`  green: NOT RUN — vitest did not pick the file up (wrong runner, or an include glob excludes it)`); continue; }
            p(`  green: ${gf.passed} passed, ${gf.failed} failed${gf.error ? ` — file error: ${clip(gf.error, 300)}` : ""} (${g.seconds}s)`);
            if (!rf) { if (r) p(`  red: NOT RUN`); continue; }
            p(`  red (production reverted): ${rf.passed} passed, ${rf.failed} failed${rf.error ? ` — file error: ${clip(rf.error, 300)}` : ""} (${r.seconds}s)`);
            const added = newTests.get(file) ?? new Set();
            const proves = [], vacuous = [], broken = [], unchanged = [];
            for (const [name, gs] of gf.tests) {
                const rs = rf.tests.get(name) ?? (rf.error ? "failed" : "missing");
                const isNew = [...added].some((n) => name.endsWith(n));
                if (gs === "passed" && rs === "failed") proves.push(name);
                else if (gs === "passed" && rs === "passed") (isNew ? vacuous : unchanged).push(name);
                else if (gs !== "passed") broken.push(name);
            }
            if (rf.error && !rf.tests.size) p(`  red: the whole file failed to load without the production change (a new module) — proves existence, not behavior`);
            p(`  proves the change (fails without it, passes with it): ${proves.length}`);
            for (const n of proves) p(`    ✓ ${n}${[...added].some((a) => n.endsWith(a)) ? "" : "  (pre-existing test)"}`);
            if (vacuous.length) {
                p(`  NEW tests that also pass WITHOUT the change (they cover existing behavior, not this fix): ${vacuous.length}`);
                for (const n of vacuous) p(`    ○ ${n}`);
            }
            if (broken.length) {
                p(`  failing on the PR branch: ${broken.length}`);
                for (const n of broken) p(`    ✗ ${n}`);
            }
            if (unchanged.length) p(`  pre-existing tests unaffected by the change: ${unchanged.length}`);
            if (!proves.length && !rf.error && !broken.length) p(`  VERDICT: the spec does not test this change — nothing in it fails with the production code reverted`);
        }
    }
    p();

    if (!flags["no-siblings"]) {
        const siblings = [];
        for (const f of prod) {
            if (f.status === "D") continue;
            const base = f.path.replace(/\.(ts|tsx|mts)$/, "");
            if (base === f.path) continue;
            for (const cand of [`${base}.spec.ts`, `${base}.spec.tsx`, `${base}.test.ts`, `${base}.test.tsx`]) {
                if (fs.existsSync(path.join(dir, cand)) && !specs.some((s) => s.path === cand) && !siblings.includes(cand)) siblings.push(cand);
            }
        }
        p(`## Specs of touched modules not in the PR (regression, green only)`);
        if (!siblings.length) p("(none: no touched module has a sibling spec the PR left alone)");
        for (const [runner, files] of plan(siblings)) {
            step(`siblings: ${runner} ← ${files.length} spec(s)`);
            const res = vitest(dir, runner, files, `siblings-${runner.replace("/", "-")}`);
            for (const file of files) {
                const rf = res.files.get(file);
                p(`${file}  [${runner}] ${rf ? `${rf.passed} passed, ${rf.failed} failed${rf.error ? ` — ${clip(rf.error, 200)}` : ""}` : "NOT RUN"}`);
                if (rf) for (const [name, s] of rf.tests) if (s !== "passed" && s !== "skipped" && s !== "todo") p(`    ✗ ${name}`);
            }
        }
        p();
    }

    p(`## Dependencies`);
    const depLines = wt(["diff", mergeBase, "HEAD", "--", "package.json", "apps/*/package.json", "packages/*/package.json", "pnpm-workspace.yaml"])
        .split("\n").filter((l) => /^[-+]\s*"[^"]+":\s*"/.test(l) && !/^[-+]\s*"(name|version|description|main|types|type|license|private|scripts?)"/.test(l));
    p(depLines.length ? indent(depLines.join("\n"), 2) : "(no package.json dependency lines changed)");
    p();

    p(`## Docs impact (writing-documentation skill, \`docs.mjs impact\`)`);
    const impact = spawnSync("node", [DOCS_MJS, "impact", "--diff", `${mergeBase}..${ref}`], { cwd: ROOT, encoding: "utf-8" });
    const impactText = (impact.stdout + impact.stderr).trim();
    p(indent(/no changed UI strings or help pages/.test(impactText) ? "no UI string or help-page reference changes in the diff; if the change is user-facing anyway, run `docs.mjs impact \"<feature name>\"`" : impactText || "(no output)", 2));
    const docsFiles = changed.filter((f) => classify(f.path) === "docs").length;
    const genFiles = changed.filter((f) => classify(f.path) === "docs-generated").length;
    p(`User Guide files in the PR: ${docsFiles} · generated help files: ${genFiles}${docsFiles && !genFiles ? " (docs edited but not synced: run `docs.mjs sync` before merging)" : ""}${!docsFiles && genFiles ? " (generated help edited by hand — the Markdown is the source)" : ""}`);
    p();

    const status = wt(["status", "--porcelain"]).trim();
    p(`## Worktree`);
    p(status ? `left DIRTY (restore failed?):\n${indent(status, 2)}` : `clean; read the code in ${path.relative(ROOT, dir)}. \`clean ${number}\` removes it.`);
    p(`total ${((Date.now() - t0) / 1000).toFixed(0)}s`);

    const text = report.join("\n");
    console.log("\n" + text);
    save(number, "verify.md", text);
}

/** Groups spec paths by the package whose Vitest config runs them. */
function plan(paths) {
    const out = new Map();
    for (const file of paths) {
        const key = Object.keys(RUNNERS).find((k) => file.startsWith(k + "/"));
        let runners = key ? RUNNERS[key] : [];
        if (!key) {
            const pkg = file.split("/").slice(0, 2).join("/");
            if (["vite.config.mts", "vite.config.ts", "vitest.config.mts", "vitest.config.ts"].some((c) => fs.existsSync(path.join(ROOT, pkg, c)))) runners = [pkg];
            else { console.error(`  ! no runner known for ${file}; skipped`); continue; }
        }
        if (flags["no-standalone"]) runners = runners.filter((r) => r !== "apps/standalone" || key === "apps/standalone");
        for (const r of runners) out.set(r, [...(out.get(r) ?? []), file]);
    }
    return out;
}

/** Runs vitest once in a package and returns per-file, per-test results. */
function vitest(dir, runner, files, label) {
    const outFile = path.join(REVIEWS, "tmp", `${label}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    // Vitest matches a filter against the path relative to the package, so `../../packages/...` for core.
    const relative = files.map((f) => path.relative(path.join(dir, runner), path.join(dir, f)));
    const res = run("pnpm", ["exec", "vitest", "run", ...(RUNNER_ARGS[runner] ?? []), "--reporter=json", `--outputFile=${outFile}`, ...relative], path.join(dir, runner));
    const result = { seconds: res.seconds, files: new Map(), raw: res.output };
    let json;
    try { json = JSON.parse(fs.readFileSync(outFile, "utf-8")); } catch { console.error(`  ! vitest produced no JSON in ${runner}: ${tail(res.output, 8)}`); return result; }
    fs.rmSync(outFile, { force: true });
    for (const tr of json.testResults ?? []) {
        const rel = path.relative(dir, tr.name).replace(/\\/g, "/");
        const file = files.find((f) => rel === f) ?? rel;
        const entry = { passed: 0, failed: 0, tests: new Map(), error: tr.status === "failed" && !tr.assertionResults?.length ? (tr.message || "").split("\n")[0] : "" };
        for (const a of tr.assertionResults ?? []) {
            entry.tests.set(a.fullName, a.status);
            if (a.status === "passed") entry.passed++;
            else if (a.status === "failed") entry.failed++;
        }
        if (entry.error) entry.failed = Math.max(entry.failed, 1);
        result.files.set(file, entry);
    }
    return result;
}

// ---------------------------------------------------------------------------------------------
// clean

async function clean() {
    const which = flags._[0] ? [`pr-${flags._[0]}`] : fs.existsSync(WORKTREES) ? fs.readdirSync(WORKTREES).filter((d) => /^pr-\d+$/.test(d)) : [];
    for (const name of which) {
        const dir = path.join(WORKTREES, name);
        if (fs.existsSync(dir)) { git(["worktree", "remove", "--force", dir]); console.log(`removed ${path.relative(ROOT, dir)}`); }
        try { git(["update-ref", "-d", `refs/pr/${name.slice(3)}`]); } catch { /* no ref */ }
    }
    git(["worktree", "prune"]);
    if (!which.length) console.log("no verify worktrees");
}

// ---------------------------------------------------------------------------------------------
// facts

function openPrs() {
    const prs = ghJson(["pr", "list", "--state", "open", "--limit", "300", "--json", PR_FIELDS.filter((f) => !["body", "commits", "reviews", "comments", "statusCheckRollup"].includes(f)).join(",")]);
    const assoc = new Map();
    for (const r of ghJson(["api", `repos/${repo()}/pulls?state=open&per_page=100`, "--paginate"])) assoc.set(r.number, r.author_association);
    for (const pr of prs) pr.authorAssociation = assoc.get(pr.number) ?? "?";
    return prs;
}

function describePr(pr, allOpen) {
    const files = (pr.files ?? []).map((f) => ({ ...f, kind: classify(f.path), area: area(f.path) }));
    const mix = {};
    for (const kind of ["prod", "spec", "docs", "docs-generated", "i18n-en", "i18n-locale", "deps", "ci", "other"]) {
        const of = files.filter((f) => f.kind === kind);
        mix[kind] = { files: of.length, add: sum(of, "additions"), del: sum(of, "deletions"), lines: sum(of, "additions") + sum(of, "deletions") };
    }
    const m = /^(fix|feat|refactor|chore|docs|test|perf|build|ci|style|spike)(\(([^)]+)\))?!?:\s/i.exec(pr.title);
    const kind = m ? m[1].toLowerCase() : /^spike\b/i.test(pr.title) ? "spike" : "other";
    // GitHub links an issue from the body, not from a `(closes #N)` subject; the subject counts here.
    const closing = [...new Set([...(pr.closingIssuesReferences ?? []).map((i) => i.number), ...[...pr.title.matchAll(/\((?:closes|fixes|resolves) #(\d+)\)/gi)].map((x) => Number(x[1]))])];
    const mentioned = [...new Set([...(pr.body ?? "").matchAll(/(?:^|[^\w/])#(\d{3,6})\b/g), ...pr.title.matchAll(/#(\d{3,6})\b/g)].map((x) => Number(x[1])))].filter((n) => !closing.includes(n));
    const areas = [...new Set(files.map((f) => f.area).filter(Boolean))];
    const fl = [];
    if (mix.deps.files) fl.push("deps");
    if (files.some((f) => /packages\/trilium-core\/src\/(migrations\/|assets\/schema\.sql)/.test(f.path))) fl.push("migration");
    if (files.some((f) => /options_interface\.ts|options_init\.ts|routes\/api\/options\.ts/.test(f.path))) fl.push("options");
    if (files.some((f) => /apps\/server\/src\/etapi\//.test(f.path))) fl.push("etapi");
    if (files.some((f) => /services\/(sync|entity_changes)|sync_/.test(f.path))) fl.push("sync");
    if (mix["i18n-locale"].files) fl.push("locales(weblate-owned)");
    if (mix["docs-generated"].files && !mix.docs.files) fl.push("generated-docs-only");
    if (mix.docs.files && !mix["docs-generated"].files) fl.push("docs-unsynced");
    if (files.some((f) => f.changeType === "ADDED" && f.kind === "prod")) fl.push(`new-files:${files.filter((f) => f.changeType === "ADDED" && f.kind === "prod").length}`);
    if (areas.length > 2) fl.push(`areas:${areas.length}`);
    if (kind === "fix" && mix.prod.add > 150) fl.push("big-for-a-fix");
    if (kind !== "fix" && files.some((f) => /^apps\/client\/src\/.*\.(tsx|ts)$/.test(f.path) && /widgets|menus|dialogs|components/.test(f.path)) && !mix.docs.files) fl.push("ui-without-docs");
    if (files.some((f) => f.path.startsWith("packages/ckeditor5/"))) fl.push("ckeditor5");
    if (files.some((f) => /^apps\/(desktop|mobile)\//.test(f.path))) fl.push("platform-specific");
    const rivals = allOpen.filter((o) => o.number !== pr.number && !isBot(o.author?.login)).filter((o) => {
        const oc = (o.closingIssuesReferences ?? []).map((i) => i.number);
        if (oc.some((n) => closing.includes(n))) return true;
        const a = titleTokens(pr.title), b = titleTokens(o.title);
        const shared = [...a].filter((x) => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        return shared >= 3 || (shared >= 2 && union && shared / union >= 0.4);
    }).map((o) => o.number);
    if (files.length < (pr.changedFiles ?? 0)) fl.push(`files-capped:${files.length}/${pr.changedFiles}`);
    return {
        number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login, bot: isBot(pr.author?.login),
        association: pr.authorAssociation, maintainer: MAINTAINER_ASSOC.has(pr.authorAssociation), isDraft: pr.isDraft,
        ageDays: daysSince(pr.createdAt), staleDays: daysSince(pr.updatedAt), labels: (pr.labels ?? []).map((l) => l.name),
        kind, conventional: Boolean(m), closesInSubject: /\((closes|fixes|resolves) #\d+\)/i.test(pr.title),
        files, mix, areas, issues: { closing, mentioned }, flags: fl, rivals
    };
}

function classify(p) {
    if (/^packages\/trilium-e2e\//.test(p) || /\.(spec|test)\.[cm]?[jt]sx?$/.test(p) || /^apps\/server\/spec\//.test(p) || /\/spec\/|\/test\/|__tests__\//.test(p)) return "spec";
    if (/^docs\//.test(p)) return "docs";
    if (/^apps\/server\/src\/assets\/doc_notes\//.test(p) || p === "apps/standalone/src/assets/help_meta.json") return "docs-generated";
    if (/translations\/en\/[^/]+\.json$/.test(p)) return "i18n-en";
    if (/translations\/[^/]+\/[^/]+\.json$/.test(p)) return "i18n-locale";
    if (/(^|\/)package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$/.test(p)) return "deps";
    if (/^\.github\//.test(p)) return "ci";
    if (/^(apps|packages)\/[^/]+\/src\//.test(p)) return "prod";
    return "other";
}

function area(p) {
    const m = /^(apps|packages)\/([^/]+)\//.exec(p);
    if (!m) return /^docs\//.test(p) ? "docs" : "";
    return m[2].replace(/^trilium-/, "");
}

function reviewThreads(number) {
    const [owner, name] = repo().split("/");
    const q = `query($owner:String!,$name:String!,$n:Int!){ repository(owner:$owner,name:$name){ pullRequest(number:$n){ reviewThreads(first:100){ nodes{ isResolved isOutdated path line comments(first:20){ nodes{ author{login} authorAssociation body } } } } } } }`;
    const data = ghJson(["api", "graphql", "-f", `query=${q}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${number}`]);
    return (data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).map((t) => ({
        ...t, comments: t.comments.nodes.map((c) => ({ author: c.author?.login ?? "?", authorAssociation: c.authorAssociation, body: c.body }))
    }));
}

function titleTokens(title) {
    return new Set(title.toLowerCase().replace(/^\w+(\([^)]*\))?!?:\s*/, "").replace(/\(closes #\d+\)/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !TITLE_NOISE.has(w)));
}

function checkSummary(rollup) {
    const by = countBy(rollup ?? [], (c) => (c.conclusion || c.status || "pending").toLowerCase());
    return Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ") || "none";
}

function mixLine(mix) {
    const s = (k, label) => (mix[k].files ? `${label} +${mix[k].add}/-${mix[k].del} (${mix[k].files}f)` : `${label} —`);
    return [s("prod", "prod"), s("spec", "spec"), s("docs", "docs"), s("docs-generated", "generated-help"), s("i18n-en", "i18n"), s("i18n-locale", "other-locales"), s("deps", "deps"), s("ci", "ci"), s("other", "other")].join(" · ");
}

// ---------------------------------------------------------------------------------------------
// plumbing

function help() {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf-8").split("\n").slice(1).join("\n").split(" */")[0].replace(/^ \* ?/gm, ""));
}

function parseFlags(argv) {
    const out = { _: [] };
    for (const a of argv) {
        if (a.startsWith("--")) {
            const [key, value] = a.slice(2).split("=");
            out[key] = value ?? true;
        } else out._.push(a);
    }
    return out;
}

function requireNumber() {
    const n = Number(String(flags._[0] ?? "").replace(/^#/, ""));
    if (!Number.isInteger(n) || n <= 0) die(`usage: ${command} <PR number>`);
    return n;
}

function repo() {
    repoSlug ??= ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
    return repoSlug;
}

function gh(argv) {
    return execFileSync("gh", argv, { cwd: ROOT, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
}

function ghJson(argv) {
    const text = gh(argv);
    // `--paginate` on a REST list endpoint concatenates arrays; join them into one.
    if (argv.includes("--paginate")) return JSON.parse(`[${text.trim().replace(/\]\s*\[/g, ",").slice(1, -1)}]`);
    return JSON.parse(text);
}

function git(argv) {
    return execFileSync("git", argv, { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

function run(cmd, argv, cwd) {
    const t0 = Date.now();
    const res = spawnSync(cmd, argv, { cwd, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    return { status: res.status, output: (res.stdout ?? "") + (res.stderr ?? ""), seconds: ((Date.now() - t0) / 1000).toFixed(1) };
}

function step(msg) {
    console.error(`▸ ${msg}`);
}

function save(number, name, text) {
    const dir = path.join(REVIEWS, `pr-${number}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), text + "\n");
    console.error(`saved ${path.relative(ROOT, path.join(dir, name))}`);
}

function isBot(login) {
    return Boolean(login) && BOT_LOGIN.test(login);
}

function daysSince(iso) {
    return iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : -1;
}

function sum(arr, key) {
    let n = 0;
    for (const x of arr) n += x[key] ?? 0;
    return n;
}

function countBy(arr, fn) {
    const out = {};
    for (const x of arr) { const k = fn(x); out[k] = (out[k] ?? 0) + 1; }
    return out;
}

function indent(text, n) {
    const pad = " ".repeat(n);
    return text.split("\n").map((l) => pad + l).join("\n");
}

function clip(text, max) {
    return text.length > max ? `${text.slice(0, max)}\n… [${text.length - max} more chars]` : text;
}

function tail(text, n) {
    return text.trim().split("\n").slice(-n).join("\n");
}

function die(msg) {
    console.error(msg);
    process.exit(1);
}

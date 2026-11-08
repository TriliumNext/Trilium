/**
 * Drafts the release note for an upcoming version from the issues its commits close.
 *
 * An issue counts as closed by the release when either a commit since the previous release
 * carries a closing keyword for it (`fix(search): … (closes #10021)`), or a pull request
 * merged since then lists it under "closing issues" on GitHub, which covers a `Closes #N`
 * written only in the PR description. Each issue becomes one entry, linked by its title and
 * credited to the contributor who fixed it, under the section of `Release Template.md` that
 * the closing change's commit type selects. The web clipper ships on its own, so its issues
 * are left out.
 *
 * A locale that became a display language since the previous release gets an entry under
 * Internationalization, credited to the translators whose commits added lines to its catalogues,
 * or to the reporter of the issue its commit closes when no translator has a GitHub account.
 *
 * Every other change reaches the note through a changelog entry: a Markdown file in `.changelog/`
 * whose frontmatter names its section and area, the issues it closes and the people to credit
 * (see `.changelog/README.md`). An entry that closes an issue replaces that issue's generated
 * entry, so the wording is the entry's own.
 *
 * The previous release defaults to the newest `v*` tag reachable from `HEAD`, so a hotfix
 * tagged on the `stable` branch is skipped. GitHub data comes from the `gh` CLI. Usage:
 *
 *   pnpm chore:release-notes v0.107.0 [--from v0.106.0] [--stdout] [--force] [--unlisted]
 *   pnpm chore:release-notes consume v0.107.0
 *   pnpm changelog:new <slug>
 *
 * `--unlisted` reports the fixes and features that neither close an issue nor come with an entry,
 * leaving out fixes that only change code written since the previous release. `consume` runs in
 * the release commit, once the note is final: it deletes the entries, or moves them to
 * `.changelog/pre-release/` for an rc or beta version, so that the final release lists them again.
 */

import { execFileSync } from "node:child_process";
import {
    existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const NOTES_DIR = join(ROOT, "docs", "Release Notes", "Release Notes");
const TEMPLATE_PATH = join(NOTES_DIR, "Release Template.md");
const DEFAULT_REPOSITORY = "TriliumNext/Trilium";
const UNCREDITED = new Set([ "eliandoran", "claude", "renovate", "weblate" ]);
const LOCALES_PATH = "packages/commons/src/lib/i18n.ts";
const CATALOGUE_DIRS = [ "apps/client/src/translations", "apps/server/src/assets/translations" ];
const LOCALE_TAGS: Record<string, string> = { cn: "zh-CN", tw: "zh-TW" };
const LANGUAGE_NAMES: Record<string, string> = { fa: "Persian (Farsi)" };
const SEPARATELY_SHIPPED_LABELS = new Set([ "web-clipper" ]);
const SEPARATELY_SHIPPED_AREAS = /^(?:web-)?clipper\b/;
const GRAPHQL_BATCH_SIZE = 50;
const CHANGELOG_DIR = join(ROOT, ".changelog");
const PRE_RELEASE_DIR = join(CHANGELOG_DIR, "pre-release");
const ENTRY_FILE_NAME = /^(\d{14})_[\w.-]+\.md$/;
/** Changes in these areas never reach a user, so `--unlisted` does not ask for an entry. */
const INTERNAL_AREAS =
    /^(?:deps|ci|build|release|skills|edit-docs|e2e|test|dev|nix|website|(?:web-)?clipper)\b/;

/** The changelog entry `type` values, each naming the release note section it goes to. */
export const ENTRY_TYPES = {
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    highlight: "Key highlights",
    breaking: "Breaking changes",
    mobile: "Mobile improvements",
    fix: "Bugfixes",
    improvement: "Improvements",
    documentation: "Documentation",
    i18n: "Internationalization",
    technical: "Technical updates",
    security: "Security improvements"
} as const;

export type Section = typeof ENTRY_TYPES[keyof typeof ENTRY_TYPES];

/** Sections rendered as GitHub admonitions above the first heading instead of as a list. */
const ADMONITIONS = new Set<Section>([ "Tip", "Important", "Warning" ]);
/** Sections listed with bullets; the others are numbered. */
const BULLETED_SECTIONS =
    new Set<Section>([ "Key highlights", "Breaking changes", "Documentation" ]);

export interface Commit {
    hash: string;
    /** The commit time, in seconds since the epoch. */
    date: number;
    subject: string;
    body: string;
}

export interface PullRequest {
    number: number;
    title: string;
    author?: string;
    closes: number[];
}

export interface Issue {
    number: number;
    title: string;
    url: string;
    state: string;
    issueType?: string;
    labels: string[];
    author?: string;
}

/** A locale that became a display language in the release. */
export interface NewLanguage {
    id: string;
    /** The commit that made it a display language. */
    hash: string;
    contributors: string[];
    /** The issues that commit closes, listed under the language instead of on their own. */
    issues: number[];
}

/** An issue the release closes, with the changes that close it, oldest first. */
export interface Closing {
    issue: number;
    /** The time of the first commit that closes it, in seconds since the epoch. */
    date: number;
    /** Subjects of the commits or pull requests that close it, used to pick the section. */
    subjects: string[];
    contributors: string[];
}

/** A file in `.changelog/`, describing one change the way the release note lists it. */
export interface ChangelogEntry {
    file: string;
    /** The time in the file name, in seconds since the epoch. */
    date: number;
    section: Section;
    area?: string;
    closes: number[];
    credits: string[];
    /** The first paragraph, which becomes the list item. */
    text: string;
    /** The lines after it, nested under the list item. */
    details: string[];
}

/** One list item of the release note, before areas are grouped and items numbered. */
export interface NoteItem {
    section: Section;
    area?: string;
    /** Orders the items of a section, in seconds since the epoch. */
    date: number;
    text: string;
    details: string[];
    credits: string[];
}

interface Options {
    version: string;
    from?: string;
    stdout: boolean;
    force: boolean;
    unlisted: boolean;
    repository: string;
}

export function main({ version, from, stdout, force, unlisted, repository }: Options) {
    const outputPath = join(NOTES_DIR, `${version}.md`);
    if (!stdout && !force && existsSync(outputPath)) {
        throw new Error(`${outputPath} already exists; `
            + "pass --force to overwrite it or --stdout to print instead.");
    }

    const base = from
        ?? git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD").trim();
    const commits = parseCommits(
        git("log", "--reverse", "--format=%H%x1f%ct%x1f%s%x1f%b%x1e", `${base}..HEAD`));
    const github = new GitHub(repository);

    const pullRequests = github.fetchPullRequests(commits.flatMap((commit) => {
        const number = parsePullRequestNumber(commit.subject);
        return number ? [ number ] : [];
    }));
    const authors = github.fetchCommitAuthors(commits
        .filter((commit) => parseClosingReferences(`${commit.subject}\n${commit.body}`).length > 0
            && !parsePullRequestNumber(commit.subject))
        .map((commit) => commit.hash));

    const closings = collectClosings(commits, pullRequests, authors);
    const issues = github.fetchIssues(closings.map((closing) => closing.issue));
    const languages = collectNewLanguages(base, commits, issues, github);
    const { entries, invalid } = readChangelogEntries();

    const items = collectItems({ closings, issues, languages, entries, pullRequests, repository });
    const note = renderReleaseNote(readFileSync(TEMPLATE_PATH, "utf-8"), version, items);
    if (stdout) {
        process.stdout.write(note);
    } else {
        writeFileSync(outputPath, note);
        console.error(`Wrote ${outputPath} from ${commits.length} commits `
            + `and ${entries.length} changelog entries since ${base}.`);
    }

    for (const closing of closings) {
        const issue = issues.get(closing.issue);
        if (!issue) {
            console.error(`  skipped #${closing.issue}: not found on GitHub`);
        } else if (issue.state === "OPEN") {
            console.error(`  #${closing.issue} is still open: ${issue.title}`);
        }
    }
    for (const { file, errors } of invalid) {
        console.error(`  left out ${file}:\n    ${errors.join("\n    ")}`);
    }

    if (unlisted) {
        const changes = findUnlistedChanges(base, commits);
        console.error(`\n${changes.length} fixes and features close no issue `
            + "and come with no changelog entry:");
        for (const commit of changes) {
            console.error(`  ${commit.hash.slice(0, 10)} ${commit.subject}`);
        }
    }
}

function collectNewLanguages(base: string, commits: Commit[], issues: Map<number, Issue>,
    github: GitHub) {
    const versions = git("log", "--reverse", "--format=%H", `${base}..HEAD`, "--", LOCALES_PATH)
        .split("\n")
        .filter((hash) => hash.length > 0)
        .map((hash) => ({ hash, source: git("show", `${hash}:${LOCALES_PATH}`) }));

    const languages: NewLanguage[] = [];
    for (const { id, hash } of findNewLanguages(git("show", `${base}:${LOCALES_PATH}`), versions)) {
        const additions = parseNumstat(git("log", "--numstat", "--format=%x1e%H", `${base}..HEAD`,
            "--", ...CATALOGUE_DIRS.map((dir) => `${dir}/${id}/`)));
        const translators = rankContributors(additions,
            github.fetchCommitAuthors([ ...additions.keys() ]));

        const commit = commits.find((it) => it.hash === hash);
        const closed = commit ? parseClosingReferences(`${commit.subject}\n${commit.body}`) : [];
        const reporters = closed.flatMap((number) => {
            const author = issues.get(number)?.author;
            return author && isCredited(author) ? [ author ] : [];
        });

        const contributors = translators.length > 0 ? translators : reporters;
        languages.push({ id, hash, contributors, issues: closed });
    }
    return languages;
}

/** Returns the ids of the display languages in a version of `i18n.ts`, in their listed order. */
export function parseDisplayLocales(source: string): string[] {
    const ids: string[] = [];
    for (const [ entry ] of source.matchAll(/\{[^{}]*\bid:\s*"[^"]+"[^{}]*\}/g)) {
        const id = /\bid:\s*"([^"]+)"/.exec(entry)?.[1];
        if (id && !/\b(?:contentOnly|devOnly):\s*true\b/.test(entry)) {
            ids.push(id);
        }
    }
    return ids;
}

/**
 * Returns the locales that are display languages after the last version but not in the base one,
 * each with the commit (from `versions`, oldest first) that made it one.
 */
export function findNewLanguages(baseSource: string, versions: { hash: string; source: string }[]) {
    const base = new Set(parseDisplayLocales(baseSource));
    const introducedBy = new Map<string, string>();
    let previous = base;
    for (const { hash, source } of versions) {
        const current = new Set(parseDisplayLocales(source));
        for (const id of current) {
            if (!previous.has(id) && !base.has(id)) {
                introducedBy.set(id, hash);
            }
        }
        for (const id of previous) {
            if (!current.has(id)) {
                introducedBy.delete(id);
            }
        }
        previous = current;
    }
    return [ ...introducedBy ].map(([ id, hash ]) => ({ id, hash }));
}

/** Reads `git log --numstat --format=%x1e%H` output into the lines each commit adds. */
export function parseNumstat(output: string) {
    const additions = new Map<string, number>();
    for (const record of output.split("\x1e")) {
        const [ hash, ...files ] = record.trim().split("\n");
        if (!hash) {
            continue;
        }
        let added = 0;
        for (const file of files) {
            const count = Number(file.split("\t")[0]);
            added += Number.isFinite(count) ? count : 0;
        }
        additions.set(hash, added);
    }
    return additions;
}

/** Sums the lines added per GitHub login and returns the credited logins, most lines first. */
export function rankContributors(additions: Map<string, number>, logins: Map<string, string>) {
    const totals = new Map<string, number>();
    for (const [ hash, added ] of additions) {
        const login = logins.get(hash);
        if (login && isCredited(login) && added > 0) {
            totals.set(login, (totals.get(login) ?? 0) + added);
        }
    }
    return [ ...totals ].sort((a, b) => b[1] - a[1]).map(([ login ]) => login);
}

/** Names a locale in English, the way the release note lists it. */
export function languageName(id: string) {
    if (LANGUAGE_NAMES[id]) {
        return LANGUAGE_NAMES[id];
    }
    try {
        const tag = LOCALE_TAGS[id] ?? id.replaceAll("_", "-");
        return new Intl.DisplayNames([ "en" ], { type: "language" }).of(tag) ?? id;
    } catch {
        return id;
    }
}

/** Reads `git log` output in the `%H%x1f%ct%x1f%s%x1f%b%x1e` format. */
export function parseCommits(output: string): Commit[] {
    return output.split("\x1e")
        .map((record) => record.replace(/^\n/, ""))
        .filter((record) => record.length > 0)
        .map((record) => {
            const [ hash, date, subject, body = "" ] = record.split("\x1f");
            return { hash, date: Number(date), subject, body: body.trim() };
        });
}

/**
 * Returns the issue numbers a message closes through GitHub's closing keywords. A bare
 * reference (`(#12477)`, `regression of #5264`) does not close anything.
 */
export function parseClosingReferences(message: string): number[] {
    const numbers: number[] = [];
    const keyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)/gi;
    for (const match of message.matchAll(keyword)) {
        numbers.push(Number(match[1]));
    }
    return numbers;
}

/** Returns the pull request a merge or squash commit came from. */
export function parsePullRequestNumber(subject: string): number | undefined {
    const match = /^Merge pull request #(\d+)\b/.exec(subject) ?? /\(#(\d+)\)$/.exec(subject);
    return match ? Number(match[1]) : undefined;
}

/**
 * Groups the closing references by issue, in the order the release first closes them. A
 * commit closing an issue that its own pull request also closes counts once.
 */
export function collectClosings(commits: Commit[], pullRequests: Map<number, PullRequest>,
    commitAuthors: Map<string, string>): Closing[] {
    const closings = new Map<number, Closing>();

    function add(issue: number, date: number, subject: string, contributor: string | undefined) {
        let closing = closings.get(issue);
        if (!closing) {
            closing = { issue, date, subjects: [], contributors: [] };
            closings.set(issue, closing);
        }
        if (!closing.subjects.includes(subject)) {
            closing.subjects.push(subject);
        }
        if (contributor && isCredited(contributor) && !closing.contributors.includes(contributor)) {
            closing.contributors.push(contributor);
        }
    }

    for (const commit of commits) {
        const pullRequestNumber = parsePullRequestNumber(commit.subject);
        const pullRequest = pullRequestNumber ? pullRequests.get(pullRequestNumber) : undefined;
        const contributor = pullRequest?.author ?? commitAuthors.get(commit.hash);

        for (const issue of parseClosingReferences(`${commit.subject}\n${commit.body}`)) {
            add(issue, commit.date, pullRequest?.title ?? commit.subject, contributor);
        }
        for (const issue of pullRequest?.closes ?? []) {
            add(issue, commit.date, pullRequest?.title ?? commit.subject, contributor);
        }
    }

    return [ ...closings.values() ];
}

function isCredited(login: string) {
    return !UNCREDITED.has(login) && !login.endsWith("[bot]");
}

/**
 * Picks the release note section for an issue: from the conventional-commit type and area of
 * the first change that closes it, or from the issue's GitHub type when that change has none.
 */
export function categorize(subjects: string[], issueType: string | undefined): Section {
    for (const subject of subjects) {
        const parsed = parseConventionalSubject(subject);
        if (!parsed) {
            continue;
        }

        const { type, area } = parsed;
        if (/^mobile\b/.test(area)) return "Mobile improvements";
        if (/^i18n\b/.test(area)) return "Internationalization";
        if (type === "fix") return "Bugfixes";
        if (type === "feat" || type === "perf") return "Improvements";
        if (type === "docs") return "Documentation";
        if (type === "build" || type === "chore" || type === "refactor") return "Technical updates";
    }

    return issueType === "Feature" ? "Improvements" : "Bugfixes";
}

/**
 * Tells whether an issue belongs to a product released on its own (the web clipper): it carries
 * that product's label, or every change closing it is in that product's area.
 */
export function isShippedSeparately(subjects: string[], labels: string[]) {
    return labels.some((label) => SEPARATELY_SHIPPED_LABELS.has(label))
        || subjects.every((subject) =>
            SEPARATELY_SHIPPED_AREAS.test(parseConventionalSubject(subject)?.area ?? ""));
}

function parseConventionalSubject(subject: string) {
    const match = /^(\w+)(?:\(([^)]*)\))?!?:/.exec(subject);
    return match ? { type: match[1], area: match[2] ?? "" } : undefined;
}

interface ItemSources {
    closings: Closing[];
    issues: Map<number, Issue>;
    languages: NewLanguage[];
    entries: ChangelogEntry[];
    /** Lets an entry that names a pull request cover the issues that pull request closes. */
    pullRequests?: Map<number, PullRequest>;
    repository: string;
}

/**
 * Turns everything the release lists into note items: the new languages, the changelog entries
 * and the closed issues that no entry or language covers. Issues GitHub does not know, issues of
 * separately shipped products and nightly-only issues are left out.
 */
export function collectItems(sources: ItemSources): NoteItem[] {
    const { closings, issues, languages, entries, pullRequests, repository } = sources;
    const closedBy = (entry: ChangelogEntry) => [ ...new Set(entry.closes.flatMap((number) =>
        [ number, ...pullRequests?.get(number)?.closes ?? [] ])) ];
    const items: NoteItem[] = [];
    for (const language of languages) {
        items.push({ section: "Internationalization", date: 0, text: languageName(language.id),
            details: [], credits: language.contributors });
    }

    const closingsByIssue = new Map(closings.map((closing) => [ closing.issue, closing ]));
    for (const entry of entries) {
        const links = entry.closes.map((number) =>
            ({ number, url: `https://github.com/${repository}/issues/${number}` }));
        const unlinked = links.filter(({ number }) =>
            !new RegExp(`/(?:issues|pull)/${number}(?!\\d)`).test(entry.text));
        let text = entry.text;
        if (links.length === 1 && !/\]\(/.test(text)) {
            text = `[${text}](${links[0].url})`;
        } else if (unlinked.length > 0) {
            const references = unlinked.map(({ number, url }) => `[#${number}](${url})`);
            text = `${text} (${references.join(", ")})`;
        }

        const inferredCredits = [ ...new Set(closedBy(entry).flatMap((number) =>
            closingsByIssue.get(number)?.contributors ?? [])) ];
        items.push({ section: entry.section, area: entry.area, date: entry.date, text,
            details: entry.details,
            credits: entry.credits.length > 0 ? entry.credits : inferredCredits });
    }

    const covered = new Set([
        ...languages.flatMap((language) => language.issues),
        ...entries.flatMap(closedBy)
    ]);
    for (const closing of closings) {
        const issue = issues.get(closing.issue);
        if (!issue || covered.has(closing.issue)
            || isShippedSeparately(closing.subjects, issue.labels)) {
            continue;
        }

        const title = cleanTitle(issue.title);
        if (isNightlyOnly(title)) {
            continue;
        }

        items.push({ section: categorize(closing.subjects, issue.issueType), date: closing.date,
            text: `[${escapeMarkdown(title)}](${issue.url})`, details: [],
            credits: closing.contributors });
    }

    return items;
}

/**
 * Fills `Release Template.md` with the items, oldest first in each section. Sections that receive
 * no item keep the template's placeholder.
 */
export function renderReleaseNote(template: string, version: string, items: NoteItem[]): string {
    const lines = template.replace(/^# .*$/m, `# ${version}`).split("\n");
    const admonitions = items
        .filter((item) => ADMONITIONS.has(item.section))
        .sort((a, b) => a.date - b.date);
    const output: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        if (lines[index].startsWith("## ") && admonitions.length > 0) {
            output.push(...admonitions.flatMap((item) => [ ...renderAdmonition(item), "" ]));
            admonitions.length = 0;
        }

        output.push(lines[index]);
        const heading = /^## \S+\s+(.*)$/.exec(lines[index])?.[1].trim().toLowerCase();
        const sectionItems = items.filter((item) => item.section.toLowerCase() === heading);
        if (sectionItems.length === 0) {
            continue;
        }

        // Replace the section's placeholder list with the items.
        while (index + 1 < lines.length && !lines[index + 1].startsWith("## ")) {
            index++;
        }
        const bulleted = BULLETED_SECTIONS.has(sectionItems[0].section);
        output.push("", ...renderSection(sectionItems, bulleted), "");
    }

    return output.join("\n").replace(/\n*$/, "\n");
}

function renderAdmonition(item: NoteItem) {
    const [ first, ...rest ] = renderItem("", item.text, item, "");
    return [
        `> [!${item.section.toUpperCase()}]`,
        `> ${first}`,
        ...rest.map((line) => (line ? `> ${line}` : ">"))
    ];
}

/**
 * Lists a section's items, nesting the items of an area that has several under one item named
 * after it, and prefixing a lone item with its area.
 */
export function renderSection(items: NoteItem[], bulleted = false): string[] {
    const sorted = [ ...items ].sort((a, b) => a.date - b.date);
    const groups: { area?: string; items: NoteItem[] }[] = [];
    for (const item of sorted) {
        const group = item.area ? groups.find((it) => it.area === item.area) : undefined;
        if (group) {
            group.items.push(item);
        } else {
            groups.push({ area: item.area, items: [ item ] });
        }
    }

    const lines: string[] = [];
    const markerOf = (index: number) => (bulleted ? "*   " : `${index + 1}.  `);
    for (const [ index, group ] of groups.entries()) {
        const marker = markerOf(index);
        if (group.items.length === 1) {
            const [ item ] = group.items;
            const text = group.area ? `${group.area}: ${item.text}` : item.text;
            lines.push(...renderItem(marker, text, item, " ".repeat(4)));
            continue;
        }

        lines.push(`${marker}${group.area}`);
        for (const [ position, item ] of group.items.entries()) {
            lines.push(...renderItem(`    ${markerOf(position)}`, item.text, item, " ".repeat(8)));
        }
    }
    return lines;
}

function renderItem(marker: string, text: string, item: NoteItem, indent: string) {
    const credit = item.credits.length > 0
        ? ` by ${item.credits.map((login) => `@${login}`).join(" & ")}` : "";
    return [
        `${marker}${text}${credit}`,
        ...item.details.map((line) => (line ? `${indent}${line}` : ""))
    ];
}

/**
 * Reads the changelog entries of `.changelog/` and `.changelog/pre-release/`, oldest first. Files
 * whose name does not start with a timestamp (`README.md`) are not entries.
 */
function readChangelogEntries() {
    const entries: ChangelogEntry[] = [];
    const invalid: { file: string; errors: string[] }[] = [];
    for (const dir of [ PRE_RELEASE_DIR, CHANGELOG_DIR ]) {
        if (!existsSync(dir)) {
            continue;
        }
        for (const name of readdirSync(dir).filter((it) => ENTRY_FILE_NAME.test(it)).sort()) {
            const file = join(dir, name);
            const { entry, errors } = parseChangelogEntry(file, readFileSync(file, "utf-8"));
            if (entry) {
                entries.push(entry);
            } else {
                invalid.push({ file, errors });
            }
        }
    }
    return { entries, invalid };
}

/**
 * Parses a changelog entry: frontmatter in a small subset of YAML (`key: value`, `key: [a, b]` or a
 * `- item` list, `#` comments), then the text. Returns the problems instead when it is not valid.
 */
export function parseChangelogEntry(file: string, source: string):
    { entry?: ChangelogEntry; errors: string[] } {
    const errors: string[] = [];
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
    const name = file.split(/[\\/]/).at(-1) ?? file;
    const timestamp = ENTRY_FILE_NAME.exec(name)?.[1];
    if (!match || !timestamp) {
        return {
            errors: [ "expected a `YYYYMMDDHHMMSS_<slug>.md` file starting with `---` frontmatter" ]
        };
    }

    const fields = new Map<string, string[]>();
    let current: string[] | undefined;
    for (const rawLine of match[1].split(/\r?\n/)) {
        const line = rawLine.replace(/\s+#\s.*$/, "").trimEnd();
        if (line.trim() === "" || line.trim().startsWith("#")) {
            continue;
        }

        const item = /^\s+-\s*(.*)$/.exec(line);
        if (item) {
            if (!current) {
                errors.push(`list item outside a key: ${line.trim()}`);
            } else if (item[1]) {
                current.push(unquote(item[1]));
            }
            continue;
        }

        const field = /^([A-Za-z]+):\s*(.*)$/.exec(line);
        if (!field) {
            errors.push(`unreadable line: ${line.trim()}`);
            continue;
        }
        const [ , key, value ] = field;
        const inline = /^\[(.*)\]$/.exec(value);
        if (inline) {
            current = inline[1].split(",").map((it) => unquote(it.trim())).filter(Boolean);
        } else {
            current = value ? [ unquote(value) ] : [];
        }
        fields.set(key, current);
    }

    for (const key of fields.keys()) {
        if (![ "type", "area", "closes", "credits" ].includes(key)) {
            errors.push(`unknown key \`${key}\`; expected type, area, closes or credits`);
        }
    }

    const type = fields.get("type")?.[0];
    const section = type ? ENTRY_TYPES[type as keyof typeof ENTRY_TYPES] : undefined;
    if (!section) {
        const found = type ? `, not \`${type}\`` : "";
        errors.push(`\`type\` must be one of ${Object.keys(ENTRY_TYPES).join(", ")}${found}`);
    }

    const closes: number[] = [];
    const issueUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/(\d+)$/;
    for (const reference of fields.get("closes") ?? []) {
        const number = /^#?(\d+)$/.exec(reference) ?? issueUrl.exec(reference);
        if (number) {
            closes.push(Number(number[1]));
        } else {
            errors.push(`\`closes\` takes issue numbers or URLs, not \`${reference}\``);
        }
    }

    const credits: string[] = [];
    for (const credit of fields.get("credits") ?? []) {
        const login = credit.replace(/^@/, "");
        if (/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(login)) {
            credits.push(login);
        } else {
            errors.push(`\`credits\` takes GitHub usernames, not \`${credit}\``);
        }
    }

    const [ text, ...details ] = match[2].trim().split(/\r?\n/);
    if (!text) {
        errors.push("the entry has no text after the frontmatter");
    }

    if (errors.length > 0 || !section || !text) {
        return { errors };
    }

    const [ year, month, day, hour, minute, second ] =
        (timestamp.match(/^\d{4}|\d\d/g) ?? []).map(Number);
    const date = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
    return {
        entry: { file, date, section, area: fields.get("area")?.[0], closes, credits,
            text: trimKeepingBreak(text.trimStart()),
            details: trimBlankLines(details.map(trimKeepingBreak)) },
        errors
    };
}

/** Trims the end of a line but keeps a Markdown hard break (two trailing spaces). */
function trimKeepingBreak(line: string) {
    if (line.trim() === "") {
        return "";
    }
    return line.replace(/\s+$/, (space) => (/^ {2,}$/.test(space) ? "  " : ""));
}

function unquote(value: string) {
    return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function trimBlankLines(lines: string[]) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start] === "") start++;
    while (end > start && lines[end - 1] === "") end--;
    return lines.slice(start, end);
}

/**
 * Deletes the entries a release note has listed, or keeps them in `.changelog/pre-release/` for a
 * pre-release. Invalid entries stay where they are, so the next run reports them again.
 */
function consumeChangelogEntries(version: string) {
    const { entries, invalid } = readChangelogEntries();
    if (invalid.length > 0) {
        console.error(`Keeping ${invalid.length} invalid entries: `
            + invalid.map(({ file }) => file).join(", "));
    }

    const isPreRelease = version.includes("-");
    for (const { file } of entries) {
        if (!isPreRelease) {
            unlinkSync(file);
        } else if (dirname(file) !== PRE_RELEASE_DIR) {
            mkdirSync(PRE_RELEASE_DIR, { recursive: true });
            renameSync(file, join(PRE_RELEASE_DIR, file.split(/[\\/]/).at(-1) ?? file));
        }
    }
    console.error(`${isPreRelease ? "Moved" : "Deleted"} ${entries.length} changelog entries.`);
}

/** Writes a changelog entry to fill in, named after the current time and the slug. */
function createChangelogEntry(slug: string) {
    if (!/^[\w.-]+$/.test(slug)) {
        throw new Error("Usage: pnpm changelog:new <slug>, "
            + "with a slug of letters, digits, `-`, `_` or `.`.");
    }

    const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const file = join(CHANGELOG_DIR, `${timestamp}_${slug}.md`);
    mkdirSync(CHANGELOG_DIR, { recursive: true });
    writeFileSync(file, [
        "---",
        `# ${Object.keys(ENTRY_TYPES).join(" | ")}`,
        "type: fix",
        "# Optional: groups entries under one item, such as LLM, Search or Table collection.",
        "area:",
        "# Optional: issue numbers. Their generated entries give way to this one.",
        "closes: []",
        "# Optional: GitHub usernames to thank. Defaults to whoever fixed the closed issues.",
        "credits: []",
        "---",
        "",
        "What changed, the way a user notices it.",
        ""
    ].join("\n"));
    console.log(file);
}

/**
 * Returns the fixes, features and performance changes since `base` that a user might notice but
 * the note does not list: they close no issue, their area is not an internal one, no changelog
 * entry arrives with them (in the same commit on `main` or the same merged branch), and, for a
 * fix, they change code that `base` already had.
 */
function findUnlistedChanges(base: string, commits: Commit[]) {
    const inRange = new Set(commits.map((commit) => commit.hash));
    const byHash = new Map(commits.map((commit) => [ commit.hash, commit ]));
    const unlisted: Commit[] = [];

    const firstParentLog =
        git("log", "--first-parent", "--reverse", "--format=%H %P", `${base}..HEAD`);
    for (const line of firstParentLog.split("\n")) {
        const [ hash, firstParent, ...otherParents ] = line.split(" ");
        if (!hash || !firstParent) {
            continue;
        }

        const added =
            git("diff", "--name-only", "--diff-filter=A", firstParent, hash, "--", ".changelog/");
        if (added.split("\n").some((path) => ENTRY_FILE_NAME.test(path.split("/").at(-1) ?? ""))) {
            continue;
        }

        const unit = otherParents.length > 0
            ? git("rev-list", "--no-merges", "--reverse", `${firstParent}..${hash}`).split("\n")
                .filter(Boolean)
            : [ hash ];
        for (const commitHash of unit) {
            const commit = byHash.get(commitHash);
            const parsed = commit ? parseConventionalSubject(commit.subject) : undefined;
            if (!commit || !parsed || ![ "fix", "feat", "perf" ].includes(parsed.type)
                || INTERNAL_AREAS.test(parsed.area)
                || parseClosingReferences(`${commit.subject}\n${commit.body}`).length > 0) {
                continue;
            }
            if (parsed.type === "fix" && !changesShippedCode(commit.hash, inRange)) {
                continue;
            }
            unlisted.push(commit);
        }
    }
    return unlisted;
}

/**
 * Tells whether a commit changes a line that existed before the release, judged by `git blame` on
 * its parent: a line last changed by a commit outside `inRange` already shipped. A pure insertion
 * is judged by the line it follows.
 */
function changesShippedCode(hash: string, inRange: Set<string>) {
    const diff = git("diff", "-U0", "--no-color", `${hash}^`, hash, "--", ".",
        ":!**/translations/**", ":!**/*.spec.ts", ":!**/*.spec.tsx", ":!docs/**",
        ":!pnpm-lock.yaml", ":!.changelog/**");
    let file: string | undefined;
    for (const line of diff.split("\n")) {
        if (line.startsWith("--- ")) {
            file = line === "--- /dev/null" ? undefined : line.slice("--- a/".length);
            continue;
        }

        const hunk = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
        if (!hunk || !file) {
            continue;
        }
        const start = Math.max(Number(hunk[1]), 1);
        const count = Math.max(hunk[2] === undefined ? 1 : Number(hunk[2]), 1);
        let blame: string;
        try {
            blame = git("blame", "--porcelain", "-L", `${start},+${count}`, `${hash}^`, "--", file);
        } catch {
            continue;
        }
        for (const [ , blamed ] of blame.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)) {
            if (!inRange.has(blamed)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Removes the marker an issue template puts before a title (`(Bug report)`, `[Feature Request]:`)
 * and capitalizes what follows it.
 */
export function cleanTitle(title: string) {
    const kind = String.raw`(?:bug|feature|fr)(?:\s+(?:report|request))?`;
    const marker =
        new RegExp(String.raw`^\s*(?:[[(]\s*${kind}\s*[\])]|${kind}(?=\s*:))\s*:?\s*`, "i");
    const stripped = title.replace(marker, "");
    return stripped === title || stripped.length === 0
        ? title : stripped[0].toUpperCase() + stripped.slice(1);
}

/**
 * Tells whether a title reports a problem seen only in a nightly build (`Nightly: …`,
 * `[Nightly Android] …`), which no stable release shipped.
 */
export function isNightlyOnly(title: string) {
    return /^\s*[[(]?\s*nightly\b/i.test(title);
}

/** Escapes an issue title so it renders as text inside a link label. */
export function escapeMarkdown(text: string) {
    return text
        .replace(/[\\[\]*_]/g, (character) => `\\${character}`)
        .replace(/</g, "&lt;");
}

class GitHub {
    private owner: string;
    private name: string;

    constructor(repository: string) {
        [ this.owner, this.name ] = repository.split("/");
    }

    fetchPullRequests(numbers: number[]) {
        const result = new Map<number, PullRequest>();
        const nodes = this.query(numbers, (number) => `pullRequest(number: ${number}) {
            number title author { login }
            closingIssuesReferences(first: 25) { nodes { number repository { nameWithOwner } } }
        }`);
        const repository = `${this.owner}/${this.name}`;
        for (const node of nodes) {
            result.set(node.number, {
                number: node.number,
                title: node.title,
                author: node.author?.login,
                closes: node.closingIssuesReferences.nodes
                    .filter((issue: any) => issue.repository.nameWithOwner === repository)
                    .map((issue: any) => issue.number)
            });
        }
        return result;
    }

    /** Maps each commit to its author's login, for commits that reached GitHub. */
    fetchCommitAuthors(hashes: string[]) {
        const result = new Map<string, string>();
        const nodes = this.query(hashes, (hash) => `object(expression: "${hash}") {
            ... on Commit { oid author { user { login } } }
        }`);
        for (const node of nodes) {
            if (node.author?.user?.login) {
                result.set(node.oid, node.author.user.login);
            }
        }
        return result;
    }

    fetchIssues(numbers: number[]) {
        const result = new Map<number, Issue>();
        const nodes = this.query(numbers, (number) => `issueOrPullRequest(number: ${number}) {
            ... on Issue {
                number title url state author { login } issueType { name }
                labels(first: 25) { nodes { name } }
            }
            ... on PullRequest {
                number title url state author { login }
                labels(first: 25) { nodes { name } }
            }
        }`);
        for (const node of nodes) {
            result.set(node.number, {
                number: node.number,
                title: node.title,
                url: node.url,
                state: node.state,
                issueType: node.issueType?.name,
                labels: node.labels.nodes.map((label: any) => label.name),
                author: node.author?.login
            });
        }
        return result;
    }

    /** Runs one aliased field per key, in batches, and returns the non-null results. */
    private query<T>(keys: T[], field: (key: T) => string): any[] {
        const unique = [ ...new Set(keys) ];
        const nodes: any[] = [];
        for (let start = 0; start < unique.length; start += GRAPHQL_BATCH_SIZE) {
            const batch = unique.slice(start, start + GRAPHQL_BATCH_SIZE);
            const fields = batch.map((key, index) => `n${index}: ${field(key)}`).join("\n");
            const query =
                `{ repository(owner: "${this.owner}", name: "${this.name}") { ${fields} } }`;
            // A number that resolves to nothing makes GitHub report an error next to the data,
            // which `gh` turns into a non-zero exit, so the output is read either way.
            let output: string;
            try {
                output = execFileSync("gh", [ "api", "graphql", "-f", `query=${query}` ], {
                    encoding: "utf-8",
                    stdio: [ "ignore", "pipe", "ignore" ],
                    maxBuffer: 64 * 1024 * 1024
                });
            } catch (err: any) {
                output = err.stdout ?? "";
            }
            const repository = JSON.parse(output || "{}").data?.repository;
            if (!repository) {
                throw new Error(
                    `GitHub query failed for ${batch.join(", ")}; is \`gh\` logged in?`);
            }
            nodes.push(...Object.values(repository)
                .filter((node: any) => node && Object.keys(node).length > 0));
        }
        return nodes;
    }
}

function git(...args: string[]) {
    return execFileSync("git", args, {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: [ "ignore", "pipe", "pipe" ],
        maxBuffer: 256 * 1024 * 1024
    });
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    const args = process.argv.slice(2);
    const version = args.find((arg, index) =>
        !arg.startsWith("--") && args[index - 1] !== "--from");
    const fromIndex = args.indexOf("--from");

    try {
        if (args[0] === "new") {
            createChangelogEntry(args[1] ?? "");
        } else if (args[0] === "consume" && args[1] && /^v\d/.test(args[1])) {
            consumeChangelogEntries(args[1]);
        } else if (!version || !/^v\d/.test(version)) {
            throw new Error([
                "Usage: release-notes.mts <version, e.g. v0.107.0> [--from <tag>]",
                "           [--stdout] [--force] [--unlisted]",
                "       release-notes.mts consume <version>",
                "       release-notes.mts new <slug>"
            ].join("\n"));
        } else {
            main({
                version,
                from: fromIndex >= 0 ? args[fromIndex + 1] : undefined,
                stdout: args.includes("--stdout"),
                force: args.includes("--force"),
                unlisted: args.includes("--unlisted"),
                repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY
            });
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

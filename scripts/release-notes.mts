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
 * A change of the sync protocol version (`SYNC_VERSION` in `app_info.ts`) or of the database
 * version (the newest entry of `MIGRATIONS` in `migrations.ts`) since the previous release gets an
 * entry under Compatibility, read from both files at the two revisions.
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
 *   pnpm chore:release-notes unreleased [--from v0.106.0]
 *   pnpm chore:release-notes consume v0.107.0
 *   pnpm changelog:new <slug>
 *   pnpm changelog:lint
 *
 * `--unlisted` reports the fixes and features that neither close an issue nor come with an entry,
 * leaving out fixes that only change code written since the previous release. `unreleased` prints
 * the same note for the changes since the previous release, without the template's preamble and
 * empty sections, for the body of the nightly release (`nightly.yml`). `consume` runs in the
 * release commit, once the note is final: it deletes the entries, or moves them to
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
const SEPARATELY_SHIPPED_AREAS = /^(?:(?:web-)?clipper|website)\b/;
/**
 * The areas a changelog entry can name, each a collapsible group of the note. A fix or an
 * improvement must name one, so that Bugfixes and Improvements list no loose items.
 */
export const AREAS = [
    "Attributes", "Authentication", "Board", "Calendar", "Code", "Collections", "Desktop",
    "Drawing canvases", "ETAPI", "Flatpak", "General", "Geo map", "Import and export", "Interface",
    "Launch bar", "LLM", "Markdown", "Mermaid", "Mind map", "PDF", "Performance", "Printing",
    "Quick edit", "Relation map", "Render notes", "Scripting", "Search", "Server", "Settings",
    "Share", "Spreadsheet", "Sync", "Table collection", "Tables in text notes", "Tabs",
    "Templates", "Text editor", "Tree", "Web clipper"
];
/** Sections whose entries must name an area. */
const AREA_SECTIONS = new Set<string>([ "Bugfixes", "Improvements" ]);
/**
 * The release note area for a commit area, so a closed issue joins the entries of its subject.
 * Areas too broad to name one (`client`, `collections`, `server`) are left out.
 */
export const AREA_NAMES: Record<string, string> = {
    "attributes": "Attributes",
    "promoted_attributes": "Attributes",
    "promoted-attributes": "Attributes",
    "board": "Board",
    "collections/board": "Board",
    "calendar": "Calendar",
    "collections/calendar": "Calendar",
    "canvas": "Drawing canvases",
    "code": "Code",
    "codemirror": "Code",
    "desktop": "Desktop",
    "etapi": "ETAPI",
    "geomap": "Geo map",
    "collections/geomap": "Geo map",
    "import": "Import and export",
    "export": "Import and export",
    "llm": "LLM",
    "llm_chat": "LLM",
    "llm-chat": "LLM",
    "markdown": "Markdown",
    "mermaid": "Mermaid",
    "mind_map": "Mind map",
    "note-menu": "Interface",
    "oauth": "Authentication",
    "auth": "Authentication",
    "print": "Printing",
    "print_preview": "Printing",
    "relation_map": "Relation map",
    "search": "Search",
    "quick_search": "Search",
    "share": "Share",
    "sort": "Tree",
    "spreadsheet": "Spreadsheet",
    "sync": "Sync",
    "collections/table": "Table collection",
    "tabs": "Tabs",
    "templates": "Templates",
    "text": "Text editor",
    "ckeditor": "Text editor",
    "code-block": "Text editor",
    "tree": "Tree"
};
const GRAPHQL_BATCH_SIZE = 50;
const CHANGELOG_DIR = join(ROOT, ".changelog");
const PRE_RELEASE_DIR = join(CHANGELOG_DIR, "pre-release");
const ENTRY_FILE_NAME = /^(\d{14})_[\w.-]+\.md$/;
/** The files that hold the versions the Compatibility section compares between two releases. */
const VERSION_SOURCES = {
    sync: "packages/trilium-core/src/services/app_info.ts",
    db: "packages/trilium-core/src/migrations/migrations.ts"
};
/** Changes in these areas never reach a user, so `--unlisted` does not ask for an entry. */
const INTERNAL_AREAS =
    /^(?:deps|ci|build|release|skills|edit-docs|e2e|test|dev|nix|website|(?:web-)?clipper)\b/;

/** The changelog entry `type` values, each naming the release note section it goes to. */
export const ENTRY_TYPES = {
    note: "Note",
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    highlight: "Key highlights",
    compatibility: "Compatibility",
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
const ADMONITIONS = new Set<Section>([ "Note", "Tip", "Important", "Warning" ]);
/** Sections that fold each area into a `<details>` block; `notable` keeps an entry out of it. */
const COLLAPSIBLE_SECTIONS = new Set<Section>(Object.values(ENTRY_TYPES)
    .filter((section) => section !== "Key highlights" && !ADMONITIONS.has(section)));
/** Sections listed with bullets; the others are numbered. Key highlights are headings instead. */
const BULLETED_SECTIONS =
    new Set<Section>([ "Compatibility", "Breaking changes", "Documentation" ]);

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
    /** Lists the entry above its section's collapsible blocks instead of inside its area's. */
    notable: boolean;
    /** The `###` heading of a Key highlights entry, written over its paragraphs. */
    title?: string;
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
    /** The issues and pull requests the item's changelog entry closes, when it has one. */
    closes?: number[];
    /** Keeps the item out of its area's collapsible block, listed before them. */
    notable?: boolean;
    /** The heading a Key highlights item is written under. */
    title?: string;
}

interface Options {
    version: string;
    from?: string;
    stdout: boolean;
    force: boolean;
    unlisted: boolean;
    /** Prints the changes since the previous release as the nightly release body. */
    unreleased?: boolean;
    repository: string;
}

export function main(
    { version, from, stdout, force, unlisted, unreleased = false, repository }: Options
) {
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

    const collected =
        collectItems({ closings, issues, languages, entries, pullRequests, repository });
    const explanations = splitExplanations(collected, findVersionBumps(base, github));
    const versions = { before: readProtocolVersions(base), after: readProtocolVersions("HEAD") };
    const items = [
        ...explanations.kept,
        ...compatibilityItems(versions.before, versions.after, explanations)
    ];
    const loose = items.filter((item) => !item.area && item.section !== "Key highlights"
        && items.some((other) => other.section === item.section && other.area));
    if (unreleased) {
        const [ hash, date ] = git("log", "-1", "--format=%h %cs", "HEAD").trim().split(" ");
        items.push(unreleasedNotice(base, { hash, date }));
    }
    const note = renderReleaseNote(readFileSync(TEMPLATE_PATH, "utf-8"),
        unreleased ? `Changes since ${base}` : version, items,
        { preamble: !unreleased, emptySections: !unreleased });
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
    if (loose.length > 0) {
        console.error(`  ${loose.length} items have no area, so they stay outside the groups:`);
        for (const item of loose) {
            console.error(`    ${item.section}: ${item.text.slice(0, 80)}`);
        }
    }
    for (const { file, errors } of invalid) {
        console.error(`  left out ${file}:\n    ${errors.join("\n    ")}`);
    }

    if (unlisted) {
        const listed = {
            numbers: new Set(entries.flatMap((entry) => entry.closes)),
            hashes: new Set(languages.map((language) => language.hash))
        };
        const changes = findUnlistedChanges(base, commits, pullRequests, listed);
        console.error(`\n${changes.pullRequests.length} merged pull requests and `
            + `${changes.commits.length} commits on main close no issue and come with no `
            + "changelog entry:");
        for (const { number, title, author } of changes.pullRequests) {
            console.error(`  #${number} ${title} (@${author ?? "?"})`);
        }
        for (const commit of changes.commits) {
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
 * Names the release note area of a closed issue from the area of the first conventional commit
 * that closes it, through `AREA_NAMES`.
 */
export function areaOf(subjects: string[]): string | undefined {
    for (const subject of subjects) {
        const area = parseConventionalSubject(subject)?.area;
        if (area) {
            return AREA_NAMES[area] ?? AREA_NAMES[area.split("/")[0]];
        }
    }
    return undefined;
}

/** Drops an `Area: ` prefix from a title that its group already names. */
export function stripAreaPrefix(title: string, area: string) {
    const prefix = new RegExp(`^${area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i");
    const stripped = title.replace(prefix, "");
    return stripped === title || !stripped
        ? title : stripped[0].toUpperCase() + stripped.slice(1);
}

/**
 * Tells whether an issue belongs to a product released on its own (the web clipper, the website):
 * it carries that product's label, or every change closing it is in that product's area.
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
        const links = entry.closes.map((number) => {
            const kind = pullRequests?.has(number) ? "pull" : "issues";
            return { number, url: `https://github.com/${repository}/${kind}/${number}` };
        });
        const unlinked = links.filter(({ number }) =>
            !new RegExp(`/(?:issues|pull)/${number}(?!\\d)`).test(entry.text));
        let text = entry.text;
        const linked = entry.section !== "Key highlights";
        if (linked && links.length === 1 && !/\]\(/.test(text)) {
            text = `[${text}](${links[0].url})`;
        } else if (linked && unlinked.length > 0) {
            const references = unlinked.map(({ number, url }) => `[#${number}](${url})`);
            text = `${text} (${references.join(", ")})`;
        }

        const inferredCredits = [ ...new Set(closedBy(entry).flatMap((number) =>
            closingsByIssue.get(number)?.contributors ?? [])) ]
            .filter((login) => !entry.text.includes(`@${login}`));
        items.push({ section: entry.section, area: entry.area, date: entry.date, text,
            details: entry.details,
            credits: entry.credits.length > 0 ? entry.credits : inferredCredits,
            closes: closedBy(entry), notable: entry.notable, title: entry.title });
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

        const cleaned = cleanTitle(issue.title);
        if (isNightlyOnly(cleaned)) {
            continue;
        }

        const area = areaOf(closing.subjects);
        const title = area ? stripAreaPrefix(cleaned, area) : cleaned;
        items.push({ section: categorize(closing.subjects, issue.issueType), area,
            date: closing.date, text: `[${escapeMarkdown(title)}](${issue.url})`, details: [],
            credits: closing.contributors });
    }

    return items;
}

/**
 * Fills `Release Template.md` with the items, oldest first in each section. Sections that receive
 * no item keep the template's placeholder, unless `emptySections` is off, which drops them along
 * with their placeholder; `preamble` off drops the template's lines between the title and the
 * first section.
 */
export function renderReleaseNote(template: string, version: string, items: NoteItem[],
    { preamble = true, emptySections = true } = {}): string {
    const lines = template.replace(/^# .*$/m, `# ${version}`).split("\n");
    const admonitions = items
        .filter((item) => ADMONITIONS.has(item.section))
        .sort((a, b) => a.date - b.date);
    const output: string[] = [];
    let inPreamble = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.startsWith("## ") && admonitions.length > 0) {
            output.push(...admonitions.flatMap((item) => [ ...renderAdmonition(item), "" ]));
            admonitions.length = 0;
        }

        const heading = /^## \S+\s+(.*)$/.exec(line)?.[1].trim().toLowerCase();
        if (line.startsWith("# ")) {
            inPreamble = true;
        } else if (heading !== undefined) {
            inPreamble = false;
        } else if (inPreamble && !preamble) {
            continue;
        }

        const sectionItems = items.filter((item) => item.section.toLowerCase() === heading);
        if (sectionItems.length === 0) {
            if (heading !== undefined && !emptySections) {
                while (index + 1 < lines.length && !lines[index + 1].startsWith("## ")) {
                    index++;
                }
            } else {
                output.push(line);
            }
            continue;
        }

        // Replace the section's placeholder list with the items.
        output.push(line);
        while (index + 1 < lines.length && !lines[index + 1].startsWith("## ")) {
            index++;
        }
        const { section } = sectionItems[0];
        output.push("", ...section === "Key highlights" ? renderHighlights(sectionItems)
            : renderSection(sectionItems, {
                bulleted: BULLETED_SECTIONS.has(section),
                collapsible: COLLAPSIBLE_SECTIONS.has(section)
            }), "");
    }

    return output.join("\n").replace(/\n*$/, "\n");
}

export interface ProtocolVersions {
    sync?: number;
    db?: number;
}

/**
 * Reads the sync protocol version from the source of `app_info.ts` and the database version from
 * the source of `migrations.ts`, whose newest migration comes first.
 */
export function parseProtocolVersions(sources: { sync?: string; db?: string }): ProtocolVersions {
    const sync = /^const SYNC_VERSION = (\d+);/m.exec(sources.sync ?? "")?.[1];
    const db = /^\s*version:\s*(\d+)/m.exec(sources.db ?? "")?.[1];
    return { sync: sync ? Number(sync) : undefined, db: db ? Number(db) : undefined };
}

/** The issue and pull request numbers of the changes that moved each version. */
export interface VersionBumps {
    sync: number[];
    db: number[];
}

/** The Compatibility entries that explain each version's bump, and every other item. */
export interface Explanations {
    kept: NoteItem[];
    sync: NoteItem[];
    db: NoteItem[];
}

/**
 * One Compatibility item per version that differs between the two releases, with the entries that
 * explain its bump nested under it.
 */
export function compatibilityItems(before: ProtocolVersions, after: ProtocolVersions,
    explanations: Partial<Pick<Explanations, "sync" | "db">> = {}): NoteItem[] {
    const items: NoteItem[] = [];
    const changed = (key: keyof ProtocolVersions) =>
        before[key] !== undefined && after[key] !== undefined && before[key] !== after[key];
    if (changed("sync")) {
        items.push(compatibilityItem(`The sync protocol version went from ${before.sync} to `
            + `${after.sync}: instances on different versions cannot sync with each other, so `
            + "update the server and every desktop and mobile client together.",
        explanations.sync ?? []));
    }
    if (changed("db")) {
        items.push(compatibilityItem(`The database version went from ${before.db} to ${after.db}: `
            + "the database is migrated the first time this version opens it, after an automatic "
            + "backup, and an earlier version refuses to open it afterwards.",
        explanations.db ?? []));
    }
    return items;
}

function compatibilityItem(text: string, explanations: NoteItem[]): NoteItem {
    const details = explanations.flatMap((item) => renderItem("*   ", item.text, item, "    "));
    return { section: "Compatibility", date: 0, text, details, credits: [] };
}

/**
 * Takes the Compatibility items whose entry closes a change behind a version bump out of `items`,
 * so that `compatibilityItems` nests them under that version's item.
 */
export function splitExplanations(items: NoteItem[], bumps: VersionBumps): Explanations {
    const result: Explanations = { kept: [], sync: [], db: [] };
    for (const item of items) {
        const explains = ([ "sync", "db" ] as const).find((key) => item.section === "Compatibility"
            && item.closes?.some((number) => bumps[key].includes(number)));
        result[explains ?? "kept"].push(item);
    }
    return result;
}

/**
 * Finds the commits since `base` whose diff moves `SYNC_VERSION` or adds a migration, and names
 * the pull requests GitHub lists them in and the issues their messages close.
 */
function findVersionBumps(base: string, github: GitHub): VersionBumps {
    const moves = { sync: /^[-+]const SYNC_VERSION = /m, db: /^\+\s*version:\s*\d+/m };
    const bumps: VersionBumps = { sync: [], db: [] };
    for (const key of [ "sync", "db" ] as const) {
        const commits = parseCommits(git("log", "--no-merges", "--reverse",
            "--format=%H%x1f%ct%x1f%s%x1f%b%x1e", `${base}..HEAD`, "--", VERSION_SOURCES[key]))
            .filter((commit) =>
                moves[key].test(git("show", "--format=", commit.hash, "--", VERSION_SOURCES[key])));
        const associated = github.fetchAssociatedPullRequests(commits.map((commit) => commit.hash));
        bumps[key] = [ ...new Set(commits.flatMap((commit) => [
            ...associated.get(commit.hash) ?? [],
            ...parseClosingReferences(`${commit.subject}\n${commit.body}`)
        ])) ];
    }
    return bumps;
}

/** The versions at a revision; a file that does not exist there yields no version. */
export function readProtocolVersions(ref: string): ProtocolVersions {
    const show = (path: string) => {
        try {
            return git("show", `${ref}:${path}`);
        } catch {
            return undefined;
        }
    };
    return parseProtocolVersions({
        sync: show(VERSION_SOURCES.sync),
        db: show(VERSION_SOURCES.db)
    });
}

/** The notice above the unreleased changes, naming the build they come from. */
export function unreleasedNotice(base: string, head: { hash: string; date: string }): NoteItem {
    return {
        section: "Note",
        date: 0,
        text: `The changes on \`main\` since ${base}, as the next release note will list them. `
            + "This list is rebuilt with every nightly build; this one comes from commit "
            + `\`${head.hash}\` of ${head.date}.`,
        details: [],
        credits: []
    };
}

/**
 * Writes each Key highlights item, oldest first, as a `###` heading over its text, a blank
 * line, and its detail lines as written: paragraphs, lists and blank lines. The credits close
 * it as a line of their own.
 */
export function renderHighlights(items: NoteItem[]): string[] {
    const lines: string[] = [];
    for (const item of [ ...items ].sort((a, b) => a.date - b.date)) {
        const credit = item.credits.length > 0
            ? [ "", `Contributed by ${item.credits.map((login) => `@${login}`).join(" and ")}.` ]
            : [];
        const body = item.title ? [ item.text, ...item.details.length > 0 ? [ "" ] : [] ] : [];
        lines.push(...lines.length > 0 ? [ "" ] : [], `### ${item.title ?? item.text}`, "",
            ...body, ...item.details, ...credit);
    }
    return lines;
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
 * Lists a section's items, prefixing a lone item with its area. The items of an area that has
 * several go under one item named after it. When `collapsible`, every area goes into a
 * `<details>` block after the list instead, written in HTML as Trilium exports its collapsible
 * blocks with the number of items in their summary, and only the items without an area stay in
 * the list, after the notable ones, which the list keeps out of their area's block.
 */
export function renderSection(items: NoteItem[],
    { bulleted = false, collapsible = false } = {}): string[] {
    const sorted = [ ...items ].sort((a, b) => a.date - b.date);
    const groups: { area?: string; items: NoteItem[]; notable: boolean }[] = [];
    for (const item of sorted) {
        const notable = collapsible && item.notable === true;
        const group = item.area && !notable
            ? groups.find((it) => it.area === item.area && !it.notable) : undefined;
        if (group) {
            group.items.push(item);
        } else {
            groups.push({ area: item.area, items: [ item ], notable });
        }
    }

    const collapsed = collapsible ? groups.filter((group) => group.area && !group.notable) : [];
    const listed = groups.filter((group) => !collapsed.includes(group))
        .sort((a, b) => Number(b.notable) - Number(a.notable));

    const lines: string[] = [];
    const markerOf = (index: number) => (bulleted ? "*   " : `${index + 1}.  `);
    for (const [ index, group ] of listed.entries()) {
        const marker = markerOf(index);
        if (group.items.length === 1) {
            const [ item ] = group.items;
            const named = group.area
                && item.text.replace(/^\[/, "").toLowerCase().startsWith(group.area.toLowerCase());
            const text = group.area && !named ? `${group.area}: ${item.text}` : item.text;
            lines.push(...renderItem(marker, text, item, " ".repeat(4)));
            continue;
        }

        lines.push(`${marker}${group.area}`);
        for (const [ position, item ] of group.items.entries()) {
            lines.push(...renderItem(`    ${markerOf(position)}`, item.text, item, " ".repeat(8)));
        }
    }

    const tag = bulleted ? "ul" : "ol";
    for (const group of collapsed) {
        lines.push(
            ...lines.length > 0 ? [ "" ] : [],
            "<details>",
            `    <summary>${escapeHtml(group.area ?? "")} (${group.items.length})</summary>`,
            `    <${tag}>`,
            ...group.items.map((item) => {
                const [ text, ...details ] = renderItem("", item.text, item, "");
                return `        <li>${markdownToHtml(text, details)}</li>`;
            }),
            `    </${tag}>`,
            "</details>"
        );
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
 * Converts an entry's Markdown to the HTML of one list item: the text and its detail lines, whose
 * `*` or `1.` items become a nested list and whose other lines continue the text. Only the inline
 * syntax entries use is supported: links, `code`, `**strong**`, `*emphasis*`, backslash escapes
 * and two-space hard breaks.
 */
export function markdownToHtml(text: string, details: string[] = []): string {
    let html = inlineToHtml(text);
    let list: { tag: string; items: string[] } | undefined;
    const closeList = () => {
        if (list) {
            const items = list.items.map((item) => `<li>${item}</li>`).join("");
            html += `<${list.tag}>${items}</${list.tag}>`;
            list = undefined;
        }
    };

    let hardBreak = / {2}$/.test(text);
    for (const line of details) {
        const item = /^\s*(\*|\d+\.)\s+(.*)$/.exec(line);
        if (item) {
            const tag = item[1] === "*" ? "ul" : "ol";
            if (list?.tag !== tag) {
                closeList();
                list = { tag, items: [] };
            }
            list.items.push(inlineToHtml(item[2]));
        } else if (line.trim()) {
            closeList();
            html += `${hardBreak ? "<br>" : " "}${inlineToHtml(line.trim())}`;
        }
        hardBreak = / {2}$/.test(line);
    }
    closeList();
    return html;
}

function inlineToHtml(text: string) {
    const kept: string[] = [];
    const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;

    let html = text.trimEnd()
        .replace(/`([^`]+)`/g, (_match, code: string) => keep(`<code>${escapeHtml(code)}</code>`))
        .replace(/\\([\\`*_[\]()#+\-.!<>])/g, (_match, character: string) =>
            keep(escapeHtml(character)))
        .replace(/&(?:[a-z]+|#\d+);/gi, (entity) => keep(entity));
    html = escapeHtml(html)
        .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) =>
            `<a href="${url}">${label}</a>`)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
        .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
    return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => kept[Number(index)]);
}

function escapeHtml(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Reads the changelog entries of `.changelog/` and `.changelog/pre-release/`, oldest first. Files
 * whose name does not start with a timestamp (`README.md`) are not entries.
 */
export function readChangelogEntries() {
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
        if (![ "type", "title", "area", "closes", "credits", "notable" ].includes(key)) {
            errors.push(
                `unknown key \`${key}\`; expected type, title, area, closes, credits or notable`);
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

    const notableValue = fields.get("notable")?.[0] ?? "false";
    if (![ "true", "false" ].includes(notableValue)) {
        errors.push(`\`notable\` is true or false, not \`${notableValue}\``);
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
            notable: notableValue === "true", title: fields.get("title")?.[0],
            text: trimKeepingBreak(text.trimStart()),
            details: trimBlankLines(details.map(trimKeepingBreak)) },
        errors
    };
}

/**
 * Returns the problems of a well-formed entry: a fix or an improvement without an area, or an area
 * missing from `AREAS`, with the closest known spelling when there is one.
 */
export function lintChangelogEntry(entry: ChangelogEntry): string[] {
    if (entry.notable && !COLLAPSIBLE_SECTIONS.has(entry.section)) {
        return [ `\`notable\` has no effect in ${entry.section}, which lists every entry` ];
    }
    if (entry.section === "Key highlights" && !entry.title) {
        return [ "`title` is required for a highlight: the heading its paragraphs go under" ];
    }
    if (entry.title && entry.section !== "Key highlights") {
        return [ `\`title\` has no effect in ${entry.section}, which lists every entry` ];
    }

    const known = AREAS.join(", ");
    if (!entry.area) {
        return AREA_SECTIONS.has(entry.section)
            ? [ `\`area\` is required for a fix or an improvement; one of ${known}` ] : [];
    }
    if (AREAS.includes(entry.area)) {
        return [];
    }

    const wanted = entry.area.toLowerCase();
    const closest = AREAS.find((area) => area.toLowerCase() === wanted)
        ?? AREAS.find((area) => editDistance(area.toLowerCase(), wanted) <= 2);
    return [ closest
        ? `unknown area \`${entry.area}\`; did you mean \`${closest}\`?`
        : `unknown area \`${entry.area}\`; one of ${known}, or add it to \`AREAS\` in `
            + "scripts/release-notes.mts" ];
}

function editDistance(a: string, b: string) {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (const [ i, charA ] of [ ...a ].entries()) {
        const current = [ i + 1 ];
        for (const [ j, charB ] of [ ...b ].entries()) {
            current.push(Math.min(previous[j + 1] + 1, current[j] + 1,
                previous[j] + (charA === charB ? 0 : 1)));
        }
        previous = current;
    }
    return previous[b.length];
}

/**
 * Checks every file in `.changelog/` and `pre-release/` and prints its problems, as GitHub
 * annotations when run in GitHub Actions. With `jsonPath`, also writes them there as
 * `{ file, message }` records. Fails when there is one.
 */
function lintChangelogEntries(jsonPath?: string) {
    const problems: { file: string; message: string }[] = [];
    for (const dir of [ PRE_RELEASE_DIR, CHANGELOG_DIR ]) {
        if (!existsSync(dir)) {
            continue;
        }
        for (const name of readdirSync(dir).filter((it) => it.endsWith(".md") && it !== "README.md")
            .sort()) {
            const file = join(dir, name);
            const { entry, errors } = parseChangelogEntry(file, readFileSync(file, "utf-8"));
            const relative = file.slice(ROOT.length + 1);
            for (const message of [ ...errors, ...entry ? lintChangelogEntry(entry) : [] ]) {
                problems.push({ file: relative, message });
            }
        }
    }

    for (const { file, message } of problems) {
        console.error(process.env.GITHUB_ACTIONS
            ? `::error file=${file}::${message}` : `${file}: ${message}`);
    }
    if (jsonPath) {
        writeFileSync(jsonPath, JSON.stringify(problems, null, 2));
    }
    if (problems.length > 0) {
        throw new Error(`${problems.length} problems in .changelog/; see .changelog/README.md.`);
    }
    console.log("Every changelog entry is well defined.");
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
/** Joins the items with commas into lines of at most `width` characters. */
function wrap(items: string[], width: number) {
    const lines: string[] = [];
    for (const [ index, item ] of items.entries()) {
        const word = index < items.length - 1 ? `${item},` : item;
        const last = lines.at(-1);
        if (last !== undefined && last.length + word.length < width) {
            lines[lines.length - 1] = `${last} ${word}`;
        } else {
            lines.push(word);
        }
    }
    return lines;
}

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
        "# Required for highlight: the heading its paragraphs go under.",
        "# title:",
        "# Required for fix and improvement: the group the entry goes to, one of",
        ...wrap(AREAS, 96).map((line) => `# ${line}`),
        "area:",
        "# Optional: issue numbers. Their generated entries give way to this one.",
        "closes: []",
        "# Optional: GitHub usernames to thank. Defaults to whoever fixed the closed issues.",
        "credits: []",
        "# Optional: true lists the entry above the collapsible blocks. For data loss, a lost",
        "# login or sync, a crash, a regression, a broken platform or locale, a rename or a",
        "# changed default; never for a new feature, which competes for a highlight instead.",
        "notable: false",
        "---",
        "",
        "What changed, the way a user notices it.",
        ""
    ].join("\n"));
    console.log(file);
}

/**
 * Returns the changes since `base` that a user might notice but the note does not list, because
 * they close no issue and no changelog entry arrives with them. A pull request also counts as
 * listed when an entry names it in `closes` or it introduces one of the new languages.
 *
 * A merged pull request is judged as a whole, whatever its commits are called, by
 * `needsEntry()`. A commit on `main` outside any pull request counts when it is a fix, feature or
 * performance change outside the internal areas and, for a fix, changes code `base` already had.
 */
function findUnlistedChanges(base: string, commits: Commit[],
    pullRequests: Map<number, PullRequest>,
    listed: { numbers: Set<number>; hashes: Set<string> }) {
    const inRange = new Set(commits.map((commit) => commit.hash));
    const byHash = new Map(commits.map((commit) => [ commit.hash, commit ]));
    const unlisted = { pullRequests: [] as PullRequest[], commits: [] as Commit[] };

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

        const merge = byHash.get(hash);
        const pullRequestNumber = merge ? parsePullRequestNumber(merge.subject) : undefined;
        const pullRequest = pullRequestNumber ? pullRequests.get(pullRequestNumber) : undefined;
        const unit = otherParents.length > 0
            ? git("rev-list", "--no-merges", "--reverse", `${firstParent}..${hash}`).split("\n")
                .filter(Boolean)
            : [ hash ];
        if (pullRequest) {
            const covered = listed.numbers.has(pullRequest.number)
                || unit.some((commitHash) => listed.hashes.has(commitHash))
                || unlisted.pullRequests.includes(pullRequest);
            if (!covered && needsEntry(pullRequest)) {
                unlisted.pullRequests.push(pullRequest);
            }
            continue;
        }
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
            unlisted.commits.push(commit);
        }
    }
    return unlisted;
}

/**
 * Tells whether a merged pull request that adds no changelog entry should have one: it closes no
 * issue, a person opened it (not Renovate or Weblate), it is not for the separately shipped web
 * clipper, and its title is either free-form or a fix, feature or performance change outside the
 * internal areas.
 */
export function needsEntry(pullRequest: PullRequest) {
    const author = pullRequest.author ?? "";
    if (pullRequest.closes.length > 0 || parseClosingReferences(pullRequest.title).length > 0
        || author.endsWith("[bot]") || [ "renovate", "weblate", "dependabot" ].includes(author)
        || SEPARATELY_SHIPPED_AREAS.test(pullRequest.title.toLowerCase())) {
        return false;
    }

    const parsed = parseConventionalSubject(pullRequest.title);
    return !parsed
        || ([ "fix", "feat", "perf" ].includes(parsed.type) && !INTERNAL_AREAS.test(parsed.area));
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

    /** Maps each commit to the numbers of this repository's pull requests that contain it. */
    fetchAssociatedPullRequests(hashes: string[]) {
        const result = new Map<string, number[]>();
        const nodes = this.query(hashes, (hash) => `object(expression: "${hash}") {
            ... on Commit {
                oid
                associatedPullRequests(first: 10) {
                    nodes { number repository { nameWithOwner } }
                }
            }
        }`);
        const repository = `${this.owner}/${this.name}`;
        for (const node of nodes) {
            result.set(node.oid, node.associatedPullRequests.nodes
                .filter((pullRequest: any) => pullRequest.repository.nameWithOwner === repository)
                .map((pullRequest: any) => pullRequest.number));
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
        } else if (args[0] === "lint") {
            const jsonIndex = args.indexOf("--json");
            lintChangelogEntries(jsonIndex >= 0 ? args[jsonIndex + 1] : undefined);
        } else if (args[0] === "consume" && args[1] && /^v\d/.test(args[1])) {
            consumeChangelogEntries(args[1]);
        } else if (args[0] === "unreleased") {
            main({
                version: "",
                from: fromIndex >= 0 ? args[fromIndex + 1] : undefined,
                stdout: true,
                force: false,
                unlisted: false,
                unreleased: true,
                repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY
            });
        } else if (!version || !/^v\d/.test(version)) {
            throw new Error([
                "Usage: release-notes.mts <version, e.g. v0.107.0> [--from <tag>]",
                "           [--stdout] [--force] [--unlisted]",
                "       release-notes.mts unreleased [--from <tag>]",
                "       release-notes.mts consume <version>",
                "       release-notes.mts lint [--json <file>]",
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

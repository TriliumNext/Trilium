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
 * The previous release defaults to the newest `v*` tag reachable from `HEAD`, so a hotfix
 * tagged on the `stable` branch is skipped. GitHub data comes from the `gh` CLI. Usage:
 *
 *   pnpm chore:release-notes v0.107.0 [--from v0.106.0] [--stdout] [--force]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const NOTES_DIR = join(ROOT, "docs", "Release Notes", "Release Notes");
const TEMPLATE_PATH = join(NOTES_DIR, "Release Template.md");
const DEFAULT_REPOSITORY = "TriliumNext/Trilium";
const UNCREDITED = new Set([ "eliandoran", "claude", "renovate" ]);
const SEPARATELY_SHIPPED_LABELS = new Set([ "web-clipper" ]);
const SEPARATELY_SHIPPED_AREAS = /^(?:web-)?clipper\b/;
const GRAPHQL_BATCH_SIZE = 50;

export type Section = "Mobile improvements" | "Bugfixes" | "Improvements" | "Documentation"
    | "Internationalization" | "Technical updates";

export interface Commit {
    hash: string;
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
}

/** An issue the release closes, with the changes that close it, oldest first. */
export interface Closing {
    issue: number;
    /** Subjects of the commits or pull requests that close it, used to pick the section. */
    subjects: string[];
    contributors: string[];
}

interface Options {
    version: string;
    from?: string;
    stdout: boolean;
    force: boolean;
    repository: string;
}

export function main({ version, from, stdout, force, repository }: Options) {
    const outputPath = join(NOTES_DIR, `${version}.md`);
    if (!stdout && !force && existsSync(outputPath)) {
        throw new Error(`${outputPath} already exists; pass --force to overwrite it or --stdout to print instead.`);
    }

    const base = from ?? git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD").trim();
    const commits = parseCommits(git("log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", `${base}..HEAD`));
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

    const note = renderReleaseNote(readFileSync(TEMPLATE_PATH, "utf-8"), version, closings, issues);
    if (stdout) {
        process.stdout.write(note);
    } else {
        writeFileSync(outputPath, note);
        console.error(`Wrote ${outputPath} from ${commits.length} commits since ${base}.`);
    }

    for (const closing of closings) {
        const issue = issues.get(closing.issue);
        if (!issue) {
            console.error(`  skipped #${closing.issue}: not found on GitHub`);
        } else if (issue.state === "OPEN") {
            console.error(`  #${closing.issue} is still open: ${issue.title}`);
        }
    }
}

/** Reads `git log` output in the `%H%x1f%s%x1f%b%x1e` format. */
export function parseCommits(output: string): Commit[] {
    return output.split("\x1e")
        .map((record) => record.replace(/^\n/, ""))
        .filter((record) => record.length > 0)
        .map((record) => {
            const [ hash, subject, body = "" ] = record.split("\x1f");
            return { hash, subject, body: body.trim() };
        });
}

/**
 * Returns the issue numbers a message closes through GitHub's closing keywords. A bare
 * reference (`(#12477)`, `regression of #5264`) does not close anything.
 */
export function parseClosingReferences(message: string): number[] {
    const numbers: number[] = [];
    for (const match of message.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)/gi)) {
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

    function add(issue: number, subject: string, contributor: string | undefined) {
        let closing = closings.get(issue);
        if (!closing) {
            closing = { issue, subjects: [], contributors: [] };
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
            add(issue, pullRequest?.title ?? commit.subject, contributor);
        }
        for (const issue of pullRequest?.closes ?? []) {
            add(issue, pullRequest?.title ?? commit.subject, contributor);
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
        || subjects.every((subject) => SEPARATELY_SHIPPED_AREAS.test(parseConventionalSubject(subject)?.area ?? ""));
}

function parseConventionalSubject(subject: string) {
    const match = /^(\w+)(?:\(([^)]*)\))?!?:/.exec(subject);
    return match ? { type: match[1], area: match[2] ?? "" } : undefined;
}

/**
 * Fills `Release Template.md` with one numbered entry per closed issue. Sections that receive
 * no entry keep the template's placeholder. Issues GitHub does not know and issues of separately
 * shipped products are left out.
 */
export function renderReleaseNote(template: string, version: string, closings: Closing[],
    issues: Map<number, Issue>): string {
    const entries = new Map<string, string[]>();
    for (const closing of closings) {
        const issue = issues.get(closing.issue);
        if (!issue || isShippedSeparately(closing.subjects, issue.labels)) {
            continue;
        }

        const section = categorize(closing.subjects, issue.issueType);
        const credit = closing.contributors.length > 0
            ? ` by ${closing.contributors.map((login) => `@${login}`).join(" & ")}` : "";
        entries.set(section, [ ...entries.get(section) ?? [], `[${escapeMarkdown(issue.title)}](${issue.url})${credit}` ]);
    }

    const lines = template.replace(/^# .*$/m, `# ${version}`).split("\n");
    const output: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        output.push(lines[index]);
        const heading = /^## \S+\s+(.*)$/.exec(lines[index]);
        const sectionEntries = heading ? entries.get(heading[1].trim()) : undefined;
        if (!sectionEntries) {
            continue;
        }

        // Replace the section's placeholder list with the entries.
        while (index + 1 < lines.length && !lines[index + 1].startsWith("## ")) {
            index++;
        }
        output.push("", ...sectionEntries.map((entry, position) => `${position + 1}.  ${entry}`), "");
    }

    return output.join("\n").replace(/\n*$/, "\n");
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
        for (const node of nodes) {
            result.set(node.number, {
                number: node.number,
                title: node.title,
                author: node.author?.login,
                closes: node.closingIssuesReferences.nodes
                    .filter((issue: any) => issue.repository.nameWithOwner === `${this.owner}/${this.name}`)
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
            ... on Issue { number title url state issueType { name } labels(first: 25) { nodes { name } } }
            ... on PullRequest { number title url state labels(first: 25) { nodes { name } } }
        }`);
        for (const node of nodes) {
            result.set(node.number, {
                number: node.number,
                title: node.title,
                url: node.url,
                state: node.state,
                issueType: node.issueType?.name,
                labels: node.labels.nodes.map((label: any) => label.name)
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
            const query = `{ repository(owner: "${this.owner}", name: "${this.name}") { ${fields} } }`;
            // A number that resolves to nothing makes GitHub report an error next to the data,
            // which `gh` turns into a non-zero exit, so the output is read either way.
            let output: string;
            try {
                output = execFileSync("gh", [ "api", "graphql", "-f", `query=${query}` ],
                    { encoding: "utf-8", stdio: [ "ignore", "pipe", "ignore" ], maxBuffer: 64 * 1024 * 1024 });
            } catch (err: any) {
                output = err.stdout ?? "";
            }
            const repository = JSON.parse(output || "{}").data?.repository;
            if (!repository) {
                throw new Error(`GitHub query failed for ${batch.join(", ")}; is \`gh\` logged in?`);
            }
            nodes.push(...Object.values(repository).filter((node: any) => node && Object.keys(node).length > 0));
        }
        return nodes;
    }
}

function git(...args: string[]) {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === SCRIPT_PATH) {
    const args = process.argv.slice(2);
    const version = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--from");
    const fromIndex = args.indexOf("--from");
    if (!version || !/^v\d/.test(version)) {
        console.error("Usage: release-notes.mts <version, e.g. v0.107.0> [--from <tag>] [--stdout] [--force]");
        process.exit(1);
    }

    try {
        main({
            version,
            from: fromIndex >= 0 ? args[fromIndex + 1] : undefined,
            stdout: args.includes("--stdout"),
            force: args.includes("--force"),
            repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY
        });
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

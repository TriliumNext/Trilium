import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ContributorEntry {
    name: string;
    fullName?: string;
    url: string;
    role?: string;
}

interface ContributorFile {
    contributors: ContributorEntry[];
}

interface ContributorInfo {
    name: string;
    fullName?: string;
    email?: string;
    commitCount: number;
    url?: string;
}

interface ShowTableParams {
    title: string;
    comment?: string;
    contributors: ContributorInfo[];
    columns: (keyof ContributorInfo)[];
}

const TRANSLATION_PATHS = [
    "apps/client/src/translations/",
    "apps/server/src/assets/translations/"
];

/** Authors that are bots or automated tools, not real contributors. */
const EXCLUDED_AUTHORS = new Set([
    "Languages add-on",
    "Hosted Weblate",
    "renovate[bot]"
]);

const NOREPLY_PATTERN = /^(?:\d+\+)?(.+)@users\.noreply\.github\.com$/;

/**
 * Manual mapping for contributors whose git email doesn't reveal their
 * GitHub username (i.e. no noreply email in .mailmap).
 */
const EMAIL_TO_GITHUB: Record<string, string> = {
    "contact@eliandoran.me": "eliandoran",
    "zadam.apps@gmail.com": "zadam",
    "adorian@esevo.ro": "adoriandoran",
    "jonfuller2012@gmail.com": "perfectra1n",
};

const CONTRIBUTORS_PATH = join(__dirname, "..", "contributors.json");

/**
 * Resolves a GitHub username from an email address.
 *
 * 1. Checks the manual mapping.
 * 2. Extracts from GitHub noreply emails (e.g. "12345+user@…").
 * 3. Scans .mailmap for alternate emails that match the noreply pattern.
 */
function resolveGitHub(email: string, name: string): string | undefined {
    if (EMAIL_TO_GITHUB[email]) return EMAIL_TO_GITHUB[email];

    const noreply = email.match(NOREPLY_PATTERN);
    if (noreply) return noreply[1];

    // Grep .mailmap for alternate emails that match the noreply pattern
    try {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const mailmapContent = execSync(`grep -i "${escapedName}" .mailmap 2>/dev/null`).toString();
        for (const line of mailmapContent.split("\n")) {
            // Extract all emails from the line (inside angle brackets)
            for (const [, email] of line.matchAll(/<([^>]+)>/g)) {
                const match = email.match(NOREPLY_PATTERN);
                if (match) return match[1];
            }
        }
    } catch { /* no matches */ }

    return undefined;
}

function parseShortlog(rawOutput: string): Map<string, { email: string; commitCount: number }> {
    const result = new Map<string, { email: string; commitCount: number }>();
    for (const line of rawOutput.split("\n")) {
        const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+)>$/);
        if (match) {
            result.set(match[2], { email: match[3], commitCount: parseInt(match[1]) });
        }
    }
    return result;
}

async function main() {
    const { developers } = listLocalGitContributors();
    await listGitHubContributors();
    updateContributorsJson(developers);
}

function listLocalGitContributors() {
    const allOutput = execSync("git shortlog -sne --no-merges HEAD -- src/ apps/").toString();
    const translationOutput = execSync(`git shortlog -sne --no-merges HEAD -- ${TRANSLATION_PATHS.join(" ")}`).toString();

    const allContribs = parseShortlog(allOutput);
    const translationContribs = parseShortlog(translationOutput);

    const developers: ContributorInfo[] = [];
    const translators: ContributorInfo[] = [];
    const MIN_COMMITS = 100;
    for (const [name, { email, commitCount }] of allContribs) {
        if (EXCLUDED_AUTHORS.has(name)) continue;

        const translationCommitCount = translationContribs.get(name)?.commitCount ?? 0;
        const isTranslator = translationCommitCount > commitCount * 0.5;

        const githubUsername = resolveGitHub(email, name);
        const url = githubUsername ? `https://github.com/${githubUsername}` : undefined;
        const entry: ContributorInfo = { name, email, commitCount, url };

        if (isTranslator) {
            if (commitCount >= 20) translators.push(entry);
        } else if (commitCount >= MIN_COMMITS) {
            developers.push(entry);
        }
    }

    // showTable({
    //     title: "Local Git Contributors (Developers)",
    //     columns: ["name", "url", "commitCount"],
    //     contributors: developers
    // });

    // showTable({
    //     title: "Local Git Contributors (Translators)",
    //     comment: "Contributors where >50% of commits are to translation files.",
    //     columns: ["name", "url", "commitCount"],
    //     contributors: translators
    // });

    return { developers, translators };
}

async function listGitHubContributors() {
    let list: any[] | null = null;

    const response = await fetch("https://api.github.com/repos/TriliumNext/Trilium/contributors");
    if (response.ok) {
        list = await response.json();
    } else {
        console.error(`Unable to request the contributor list from GitHub. Reason: ${response.statusText}`);
    }

    if (!list) {
        return;
    }

    const MIN_CONTRIBUTIONS = 125;
    const contributors: ContributorInfo[] = list
        .filter((c) => c.contributions >= MIN_CONTRIBUTIONS)
        .map((c) => {
            return {
                name: c.login,
                url: c.html_url,
                commitCount: c.contributions
            } as ContributorInfo;
        });

    // showTable({
    //     title: "GitHub Contributor List",
    //     comment: "Note: the GitHub list also include contributors that did not directly contribute to Trilium, but to submodules used in the Trilium's repo.",
    //     contributors: contributors,
    //     columns: ["name", "url", "commitCount"]
    // });
}

/**
 * Updates contributors.json, preserving pinned entries (those with special
 * roles like lead-dev, original-dev) and regenerating the rest from git data.
 */
function updateContributorsJson(developers: ContributorInfo[]) {
    // Read existing file to preserve pinned entries
    const existing: ContributorFile = JSON.parse(readFileSync(CONTRIBUTORS_PATH, "utf-8"));
    const pinnedRoles = new Set<string>(["lead-dev", "original-dev"]);
    const pinned = existing.contributors.filter((c) => c.role && pinnedRoles.has(c.role));

    // Build a set of pinned GitHub usernames to avoid duplicates
    const pinnedNames = new Set(pinned.map((c) => c.name));

    const contributors: ContributorEntry[] = [...pinned];

    // Add developers (skip those already pinned)
    for (const dev of developers) {
        const githubName = dev.url?.replace("https://github.com/", "");
        if (!githubName || pinnedNames.has(githubName)) continue;

        contributors.push({
            name: githubName,
            fullName: dev.name !== githubName ? dev.name : undefined,
            url: dev.url!
        });
    }

    const output = {
        "⚠️": "Auto-generated file. Run `pnpm run update-contributors` to regenerate.",
        contributors
    };
    writeFileSync(CONTRIBUTORS_PATH, JSON.stringify(output, null, 4) + "\n");
    console.log(`\n✅ Updated ${CONTRIBUTORS_PATH} with ${contributors.length} contributors.`);
}

function showTable(params: ShowTableParams) {
    console.log(`\n──── ${params.title} ────`);
    if (params.comment) {
        console.log(`\n${params.comment}\n`);
    }
    console.table(params.contributors, params.columns);
}

main();

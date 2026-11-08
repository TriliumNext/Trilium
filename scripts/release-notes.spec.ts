import { describe, expect, it } from "vitest";

import {
    categorize, type ChangelogEntry, cleanTitle, collectClosings, collectItems, type Commit,
    escapeMarkdown, findNewLanguages, type Issue, isNightlyOnly, isShippedSeparately, languageName,
    markdownToHtml, needsEntry, type NoteItem, parseChangelogEntry, parseClosingReferences,
    parseCommits, parseDisplayLocales, parseNumstat, parsePullRequestNumber, type PullRequest,
    rankContributors, renderReleaseNote, renderSection
} from "./release-notes.mjs";

describe("parseClosingReferences", () => {
    it("reads closing keywords and ignores bare references", () => {
        expect(parseClosingReferences("fix(tabs): reset edit mode (closes #12477)"))
            .toEqual([ 12477 ]);
        expect(parseClosingReferences(
            "fix(text): selectable includes (regression of #5264, closes #12285)"))
            .toEqual([ 12285 ]);
        expect(parseClosingReferences("fix(client): avoid warnings (Closes #12439) (#12440)"))
            .toEqual([ 12439 ]);
        expect(parseClosingReferences("fix #12253\n\nFixes #11825.\nResolves: #1"))
            .toEqual([ 12253, 11825, 1 ]);
        expect(parseClosingReferences("fix(search): keep paths (#10021)")).toEqual([]);
        expect(parseClosingReferences("closes TriliumNext/Docs#3, prefixes #4")).toEqual([]);
    });
});

describe("parsePullRequestNumber", () => {
    it("reads merge and squash subjects", () => {
        expect(parsePullRequestNumber("Merge pull request #12535 from user/branch")).toBe(12535);
        expect(parsePullRequestNumber("fix(fonts): keep Monospace size (#12479)")).toBe(12479);
        expect(parsePullRequestNumber("fix(tabs): reset edit mode (closes #12477)"))
            .toBeUndefined();
    });
});

describe("parseCommits", () => {
    it("splits records with multi-line bodies", () => {
        const output = "a\x1f100\x1ffix: one\x1fFixes #1\n\nmore\n\x1e"
            + "\nb\x1f200\x1ffeat: two\x1f\x1e\n";
        expect(parseCommits(output)).toEqual([
            { hash: "a", date: 100, subject: "fix: one", body: "Fixes #1\n\nmore" },
            { hash: "b", date: 200, subject: "feat: two", body: "" }
        ]);
    });
});

describe("collectClosings", () => {
    it("merges commit and pull request references per issue and credits contributors", () => {
        const commits: Commit[] = [
            { hash: "1", date: 1, subject: "fix(sync): keep edits (closes #10)", body: "" },
            { hash: "2", date: 2, subject: "fix(sync): keep edits (closes #10) (#20)", body: "" },
            { hash: "3", date: 3, subject: "Merge pull request #30 from user/branch",
                body: "Fix tables" },
            { hash: "4", date: 4, subject: "feat(tree): menu (closes #40)", body: "" }
        ];
        const pullRequests = new Map<number, PullRequest>([
            [ 20, { number: 20, title: "fix(sync): keep edits", author: "contributor",
                closes: [ 10 ] } ],
            [ 30, { number: 30, title: "Fix tables", author: "renovate[bot]", closes: [ 31 ] } ]
        ]);
        const authors = new Map([ [ "1", "eliandoran" ], [ "4", "other" ] ]);

        expect(collectClosings(commits, pullRequests, authors)).toEqual([
            { issue: 10, date: 1,
                subjects: [ "fix(sync): keep edits (closes #10)", "fix(sync): keep edits" ],
                contributors: [ "contributor" ] },
            { issue: 31, date: 3, subjects: [ "Fix tables" ], contributors: [] },
            { issue: 40, date: 4, subjects: [ "feat(tree): menu (closes #40)" ],
                contributors: [ "other" ] }
        ]);
    });
});

describe("needsEntry", () => {
    it("asks for an entry from pull requests a person opened for a user-visible change", () => {
        const pr = (title: string, author = "adoriandoran", closes: number[] = []): PullRequest =>
            ({ number: 1, title, author, closes });
        expect(needsEntry(pr("Text editor: improvements"))).toBe(true);
        expect(needsEntry(pr("feat(search): saved queries", "eliandoran"))).toBe(true);
        expect(needsEntry(pr("fix(share): broken links"))).toBe(true);
        expect(needsEntry(pr("fix(share): broken links", "x", [ 12 ]))).toBe(false);
        expect(needsEntry(pr("fix(share): broken links (closes #12)"))).toBe(false);
        expect(needsEntry(pr("Update dependency vite to v8", "renovate"))).toBe(false);
        expect(needsEntry(pr("Translations update from Hosted Weblate", "weblate"))).toBe(false);
        expect(needsEntry(pr("chore(deps): bump", "dependabot[bot]"))).toBe(false);
        expect(needsEntry(pr("fix(deps): update ai sdk"))).toBe(false);
        expect(needsEntry(pr("chore(release): prepare"))).toBe(false);
        expect(needsEntry(pr("docs(user): typo"))).toBe(false);
        expect(needsEntry(pr("web-clipper: prevent cloning", "contributor"))).toBe(false);
        expect(needsEntry(pr("fix(clipper): keep images"))).toBe(false);
    });
});

describe("categorize", () => {
    it("uses the commit type and area, then the issue type", () => {
        expect(categorize([ "fix(search): x" ], "Feature")).toBe("Bugfixes");
        expect(categorize([ "feat(search): x" ], "Bug")).toBe("Improvements");
        expect(categorize([ "perf: x" ], undefined)).toBe("Improvements");
        expect(categorize([ "fix(mobile): x" ], undefined)).toBe("Mobile improvements");
        expect(categorize([ "feat(i18n): x" ], undefined)).toBe("Internationalization");
        expect(categorize([ "docs(user): x" ], undefined)).toBe("Documentation");
        expect(categorize([ "chore(deps): x" ], undefined)).toBe("Technical updates");
        expect(categorize([ "close #1", "Merge pull request #2", "fix: x" ], "Feature"))
            .toBe("Bugfixes");
        expect(categorize([ "close #1" ], "Feature")).toBe("Improvements");
        expect(categorize([ "close #1" ], undefined)).toBe("Bugfixes");
    });
});

describe("isShippedSeparately", () => {
    it("recognizes web clipper issues by label or by the area of every closing change", () => {
        expect(isShippedSeparately([ "Keep indentation (closes #1442)" ], [ "web-clipper" ]))
            .toBe(true);
        expect(isShippedSeparately([ "feat(clipper): a", "fix(web-clipper): b" ], [])).toBe(true);
        expect(isShippedSeparately([ "feat(clipper): a", "fix(server): b" ], [])).toBe(false);
        expect(isShippedSeparately([ "feat(text): a" ], [ "ckeditor" ])).toBe(false);
    });
});

describe("new languages", () => {
    const base = `
        { id: "cs", name: "Čeština", electronLocale: "cs" },
        { id: "en", name: "English", electronLocale: "en" },
        {
            id: "en_rtl",
            rtl: true,
            devOnly: true
        },
        { // Persian
            id: "fa",
            rtl: true,
            contentOnly: true
        },`;

    it("lists display languages, skipping content-only and dev-only ones", () => {
        expect(parseDisplayLocales(base)).toEqual([ "cs", "en" ]);
    });

    it("finds the commit that made each locale a display language", () => {
        const withVietnamese = `${base}\n{ id: "vi", name: "Tiếng Việt" },`;
        const withPersian = withVietnamese.replace("contentOnly: true", "electronLocale: \"fa\"");
        const withDanish = `${withPersian}\n{ id: "da", name: "Dansk" },\n{ id: "xx", name: "X" },`;
        const withoutX = withDanish.replace(`{ id: "xx", name: "X" },`, "");

        expect(findNewLanguages(base, [
            { hash: "a", source: withVietnamese },
            { hash: "b", source: withPersian },
            { hash: "c", source: withDanish },
            { hash: "d", source: withoutX }
        ])).toEqual([ { id: "vi", hash: "a" }, { id: "fa", hash: "b" }, { id: "da", hash: "c" } ]);
    });

    it("credits translators by the lines they added", () => {
        const additions = parseNumstat([
            "\x1ea\n\n10\t2\tvi/translation.json\n5\t0\tvi/server.json\n",
            "\x1eb\n\n30\t0\tvi/translation.json\n",
            "\x1ec\n\n-\t-\tvi/image.png\n",
            "\x1ed\n\n100\t0\tvi/translation.json\n"
        ].join(""));
        expect(additions).toEqual(new Map([ [ "a", 15 ], [ "b", 30 ], [ "c", 0 ], [ "d", 100 ] ]));
        expect(rankContributors(additions, new Map([
            [ "a", "translator" ], [ "b", "other" ], [ "c", "silent" ], [ "d", "weblate" ]
        ]))).toEqual([ "other", "translator" ]);
    });

    it("names languages in English", () => {
        expect(languageName("vi")).toBe("Vietnamese");
        expect(languageName("fa")).toBe("Persian (Farsi)");
        expect(languageName("cn")).toBe("Chinese (China)");
        expect(languageName("pt_br")).toBe("Brazilian Portuguese");
    });
});

describe("parseChangelogEntry", () => {
    const file = ".changelog/20261108143000_backlinks.md";

    it("reads the frontmatter and splits the text from its details", () => {
        expect(parseChangelogEntry(file, [
            "---",
            "# fix | improvement",
            "type: fix",
            "area: Search  # groups the entry",
            "closes:",
            "  - 12",
            "  - https://github.com/TriliumNext/Trilium/issues/34",
            "credits: [ \"@someone\", other ]",
            "---",
            "",
            "Several links in one paragraph showed up twice in the backlinks.  ",
            "    * A detail. \t",
            "   ",
            ""
        ].join("\n"))).toEqual({
            entry: {
                file,
                date: Date.UTC(2026, 10, 8, 14, 30, 0) / 1000,
                section: "Bugfixes",
                area: "Search",
                closes: [ 12, 34 ],
                credits: [ "someone", "other" ],
                text: "Several links in one paragraph showed up twice in the backlinks.  ",
                details: [ "    * A detail." ]
            },
            errors: []
        });
    });

    it("reports every problem instead of guessing", () => {
        const source = "---\ntype: bugfix\nscope: x\ncloses: [abc]\ncredits: [a_b]\n---\n";
        expect(parseChangelogEntry(file, source).errors).toEqual([
            "unknown key `scope`; expected type, area, closes or credits",
            "`type` must be one of tip, important, warning, highlight, breaking, mobile, fix, "
                + "improvement, documentation, i18n, technical, security, not `bugfix`",
            "`closes` takes issue numbers or URLs, not `abc`",
            "`credits` takes GitHub usernames, not `a_b`",
            "the entry has no text after the frontmatter"
        ]);
        expect(parseChangelogEntry(".changelog/notes.md", "---\ntype: fix\n---\nText").errors)
            .toHaveLength(1);
        expect(parseChangelogEntry(file, "type: fix\nText").errors).toHaveLength(1);
    });
});

describe("collectItems", () => {
    const issue = (number: number, title: string, labels: string[] = []): [ number, Issue ] =>
        [ number, { number, title, url: `https://x/${number}`, state: "CLOSED", labels } ];
    const issues = new Map<number, Issue>([
        issue(1, "(Bug report) Crash on *save*"),
        issue(2, "Add Persian"),
        issue(3, "Old wording"),
        issue(4, "Clipper", [ "web-clipper" ]),
        issue(5, "[Bug]: Nightly: crash"),
        issue(6, "Second")
    ]);
    const closings = [ 1, 2, 3, 4, 5, 6, 7 ].map((number) => ({ issue: number, date: number * 10,
        subjects: [ "fix: x" ], contributors: number === 3 ? [ "fixer" ] : [] }));
    const entry: ChangelogEntry = { file: "a.md", date: 15, section: "Bugfixes", closes: [ 3 ],
        credits: [], text: "New wording", details: [] };
    const url = (number: number) => `https://github.com/o/r/issues/${number}`;

    it("lets languages and entries replace the issues they close", () => {
        const items = collectItems({
            closings,
            issues,
            languages: [ { id: "fa", hash: "a", contributors: [ "reporter" ], issues: [ 2 ] } ],
            entries: [
                entry,
                { ...entry, file: "b.md", date: 25, closes: [ 6, 8 ], credits: [ "thanked" ],
                    text: "Two issues" },
                { ...entry, file: "c.md", date: 35, closes: [], area: "Search",
                    text: "[Linked](https://y)" },
                { ...entry, file: "d.md", date: 45, closes: [ 9, 20 ],
                    text: `[Partly](${url(9)}) linked` }
            ],
            pullRequests: new Map([ [ 20, { number: 20, title: "x", closes: [ 7 ] } ] ]),
            repository: "o/r"
        });

        expect(items.map(({ section, text, credits }) => [ section, text, credits.join() ]))
            .toEqual([
                [ "Internationalization", "Persian (Farsi)", "reporter" ],
                [ "Bugfixes", `[New wording](${url(3)})`, "fixer" ],
                [ "Bugfixes", `Two issues ([#6](${url(6)}), [#8](${url(8)}))`, "thanked" ],
                [ "Bugfixes", "[Linked](https://y)", "" ],
                [ "Bugfixes", `[Partly](${url(9)}) linked ([#20](https://github.com/o/r/pull/20))`,
                    "" ],
                [ "Bugfixes", "[Crash on \\*save\\*](https://x/1)", "" ]
            ]);
    });
});

describe("renderSection", () => {
    const item = (text: string, date: number, area?: string, details: string[] = []): NoteItem =>
        ({ section: "Bugfixes", area, date, text, details,
            credits: date === 1 ? [ "a", "b" ] : [] });

    it("orders items by date and nests the areas that have several", () => {
        expect(renderSection([
            item("Third", 3, "Search"),
            item("First", 1),
            item("Second", 2, "LLM", [ "* A detail.", "", "More." ]),
            item("Fourth", 4, "Search")
        ])).toEqual([
            "1.  First by @a & @b",
            "2.  LLM: Second",
            "    * A detail.",
            "",
            "    More.",
            "3.  Search",
            "    1.  Third",
            "    2.  Fourth"
        ]);
        expect(renderSection([ item("Third", 3, "Search"), item("Fourth", 4, "Search") ],
            { bulleted: true })).toEqual([ "*   Search", "    *   Third", "    *   Fourth" ]);
    });

    it("folds the areas that have several items into a collapsible block after the list", () => {
        expect(renderSection([
            item("Third", 3, "Search"),
            item("First", 1),
            item("Second", 2, "LLM"),
            item("Fourth `#x`", 4, "Search", [ "* A detail." ])
        ], { collapsible: true })).toEqual([
            "1.  First by @a & @b",
            "2.  LLM: Second",
            "",
            "<details>",
            "    <summary>Search</summary>",
            "    <ol>",
            "        <li>Third</li>",
            "        <li>Fourth <code>#x</code><ul><li>A detail.</li></ul></li>",
            "    </ol>",
            "</details>"
        ]);
    });
});

describe("markdownToHtml", () => {
    it("converts the inline syntax entries use", () => {
        expect(markdownToHtml("[Crash on \\*save\\*](https://x/1) & `a<b>` by @a"))
            .toBe("<a href=\"https://x/1\">Crash on *save*</a> &amp; "
                + "<code>a&lt;b&gt;</code> by @a");
        expect(markdownToHtml("**Bold** and *em* and _em_, not safe_fetch or 2*3*4"))
            .toBe("<strong>Bold</strong> and <em>em</em> and <em>em</em>, not safe_fetch or 2*3*4");
        expect(markdownToHtml("&lt;style> stays")).toBe("&lt;style&gt; stays");
    });

    it("continues the text with its details and nests their list items", () => {
        expect(markdownToHtml("**Title**  ", [ "Body text.", "1.  One", "2.  Two", "After" ]))
            .toBe("<strong>Title</strong><br>Body text.<ol><li>One</li><li>Two</li></ol> After");
    });
});

describe("renderReleaseNote", () => {
    it("fills matching sections, whatever their case, and keeps the others' placeholders", () => {
        const template = [
            "# Release Template",
            "> [!NOTE]",
            "",
            "## 💡 Key highlights",
            "",
            "1.  \\[…\\]",
            "",
            "## 🚨 Breaking changes",
            "",
            "1.  \\[…\\]",
            "",
            "## 🐞 Bugfixes",
            "",
            "1.  \\[…\\]",
            "",
            "## 🔒️ Security Improvements",
            "",
            "1.  \\[…\\]"
        ].join("\n");

        expect(renderReleaseNote(template, "v1.0.0", [
            { section: "Bugfixes", date: 2, text: "Later", details: [], credits: [] },
            { section: "Bugfixes", date: 1, text: "Earlier", details: [], credits: [] },
            { section: "Security improvements", date: 1, text: "Safer", details: [], credits: [] },
            { section: "Breaking changes", date: 1, text: "Gone", details: [], credits: [] },
            { section: "Important", date: 2, text: "Upgrade both", details: [ "", "Or else." ],
                credits: [] },
            { section: "Tip", date: 1, text: "On Flathub", details: [], credits: [] }
        ])).toBe([
            "# v1.0.0",
            "> [!NOTE]",
            "",
            "> [!TIP]",
            "> On Flathub",
            "",
            "> [!IMPORTANT]",
            "> Upgrade both",
            ">",
            "> Or else.",
            "",
            "## 💡 Key highlights",
            "",
            "1.  \\[…\\]",
            "",
            "## 🚨 Breaking changes",
            "",
            "*   Gone",
            "",
            "## 🐞 Bugfixes",
            "",
            "1.  Earlier",
            "2.  Later",
            "",
            "## 🔒️ Security Improvements",
            "",
            "1.  Safer",
            ""
        ].join("\n"));
    });
});

describe("cleanTitle", () => {
    it("removes issue template markers and keeps area prefixes", () => {
        expect(cleanTitle("(Bug report) Importing large ZIP-Files hangs"))
            .toBe("Importing large ZIP-Files hangs");
        expect(cleanTitle("[Bug]: \"...\" menu state remains stale"))
            .toBe("\"...\" menu state remains stale");
        expect(cleanTitle("[Feature Request] Support share_target")).toBe("Support share_target");
        expect(cleanTitle("(Feature request) save clip with prompt")).toBe("Save clip with prompt");
        expect(cleanTitle("Feature request: dark mode")).toBe("Dark mode");
        expect(cleanTitle("[FR] Tabs")).toBe("Tabs");
        expect(cleanTitle("Search: commas in quotes")).toBe("Search: commas in quotes");
        expect(cleanTitle("Bugs in the tree")).toBe("Bugs in the tree");
        expect(cleanTitle("any markdown text")).toBe("any markdown text");
    });
});

describe("isNightlyOnly", () => {
    it("recognizes titles that name a nightly build first", () => {
        expect(isNightlyOnly("Nightly: drag handle persists")).toBe(true);
        expect(isNightlyOnly("Nightly Android: custom theme not used")).toBe(true);
        expect(isNightlyOnly("[Nightly] Crash on start")).toBe(true);
        expect(isNightlyOnly("Nightlywood theme crashes")).toBe(false);
        expect(isNightlyOnly("Crash in the nightly build")).toBe(false);
    });
});

describe("escapeMarkdown", () => {
    it("escapes what would break a link label or turn into markup", () => {
        expect(escapeMarkdown("safe_fetch [bug] *x* <style> `code`"))
            .toBe("safe\\_fetch \\[bug\\] \\*x\\* &lt;style> `code`");
    });
});

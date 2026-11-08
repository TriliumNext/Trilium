import { describe, expect, it } from "vitest";

import {
    AREA_NAMES, areaOf, AREAS, categorize, type ChangelogEntry, cleanTitle, collectClosings,
    collectItems, type Commit, compatibilityItems, escapeMarkdown, findNewLanguages, type Issue,
    isNightlyOnly, isShippedSeparately, languageName, lintChangelogEntry, markdownToHtml,
    needsEntry, type NoteItem, parseChangelogEntry, parseClosingReferences, parseCommits,
    parseDisplayLocales, parseNumstat, parseProtocolVersions, parsePullRequestNumber,
    type PullRequest, rankContributors, renderReleaseNote, renderSection, splitExplanations,
    stripAreaPrefix, unreleasedNotice,
    renderHighlights,
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

describe("areaOf", () => {
    it("names the area of the first conventional subject, from the full area or its root", () => {
        expect(areaOf([ "Merge pull request #1", "fix(collections/table): x" ]))
            .toBe("Table collection");
        expect(areaOf([ "fix(llm/tools): x" ])).toBe("LLM");
        expect(areaOf([ "fix(client): x", "fix(search): y" ])).toBeUndefined();
        expect(areaOf([ "close #1" ])).toBeUndefined();
    });

    it("drops a title's prefix that the area already names", () => {
        expect(stripAreaPrefix("Spreadsheet: sorting criteria is unclickable", "Spreadsheet"))
            .toBe("Sorting criteria is unclickable");
        expect(stripAreaPrefix("Markdown Preview Mode: links", "Markdown"))
            .toBe("Markdown Preview Mode: links");
    });
});

describe("isShippedSeparately", () => {
    it("recognizes web clipper and website issues by label or by closing change areas", () => {
        expect(isShippedSeparately([ "Keep indentation (closes #1442)" ], [ "web-clipper" ]))
            .toBe(true);
        expect(isShippedSeparately([ "feat(clipper): a", "fix(web-clipper): b" ], [])).toBe(true);
        expect(isShippedSeparately([ "feat(clipper): a", "fix(server): b" ], [])).toBe(false);
        expect(isShippedSeparately([ "fix(website): deploy releases" ], [])).toBe(true);
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
            "notable: true",
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
                notable: true,
                text: "Several links in one paragraph showed up twice in the backlinks.  ",
                details: [ "    * A detail." ]
            },
            errors: []
        });
    });

    it("reports every problem instead of guessing", () => {
        const source =
            "---\ntype: bugfix\nscope: x\ncloses: [abc]\ncredits: [a_b]\nnotable: yes\n---\n";
        expect(parseChangelogEntry(file, source).errors).toEqual([
            "unknown key `scope`; expected type, title, area, closes, credits or notable",
            "`type` must be one of note, tip, important, warning, highlight, compatibility, "
                + "breaking, mobile, fix, improvement, documentation, i18n, technical, security, "
                + "not `bugfix`",
            "`closes` takes issue numbers or URLs, not `abc`",
            "`credits` takes GitHub usernames, not `a_b`",
            "`notable` is true or false, not `yes`",
            "the entry has no text after the frontmatter"
        ]);
        expect(parseChangelogEntry(file, "---\ntype: fix\n---\nText").entry?.notable).toBe(false);
        expect(parseChangelogEntry(".changelog/notes.md", "---\ntype: fix\n---\nText").errors)
            .toHaveLength(1);
        expect(parseChangelogEntry(file, "type: fix\nText").errors).toHaveLength(1);
    });
});

describe("lintChangelogEntry", () => {
    const entry: ChangelogEntry = { file: "a.md", date: 0, section: "Bugfixes", area: "Search",
        closes: [], credits: [], notable: false, text: "x", details: [] };

    it("requires a title on highlights and rejects it elsewhere", () => {
        const highlight = { ...entry, section: "Key highlights" as const, area: undefined };
        expect(lintChangelogEntry({ ...highlight, title: "Tables" })).toEqual([]);
        expect(lintChangelogEntry(highlight))
            .toEqual([
                "`title` is required for a highlight: the heading its paragraphs go under" ]);
        expect(lintChangelogEntry({ ...entry, title: "Tables" }))
            .toEqual([ "`title` has no effect in Bugfixes, which lists every entry" ]);
    });

    it("allows notable only where areas fold", () => {
        expect(lintChangelogEntry({ ...entry, notable: true })).toEqual([]);
        expect(lintChangelogEntry({ ...entry, section: "Security improvements", notable: true }))
            .toEqual([]);
        expect(lintChangelogEntry({ ...entry, section: "Key highlights", notable: true }))
            .toEqual([ "`notable` has no effect in Key highlights, which lists every entry" ]);
        expect(lintChangelogEntry({ ...entry, section: "Tip", area: undefined, notable: true }))
            .toEqual([ "`notable` has no effect in Tip, which lists every entry" ]);
    });

    it("requires a known area on fixes and improvements", () => {
        expect(lintChangelogEntry(entry)).toEqual([]);
        expect(lintChangelogEntry({ ...entry, section: "Mobile improvements", area: undefined }))
            .toEqual([]);
        expect(lintChangelogEntry({ ...entry, section: "Improvements", area: undefined })[0])
            .toMatch(/^`area` is required for a fix or an improvement; one of Attributes, /);
        expect(lintChangelogEntry({ ...entry, area: "search" }))
            .toEqual([ "unknown area `search`; did you mean `Search`?" ]);
        expect(lintChangelogEntry({ ...entry, area: "Serch" }))
            .toEqual([ "unknown area `Serch`; did you mean `Search`?" ]);
        expect(lintChangelogEntry({ ...entry, section: "Breaking changes", area: "Plugins" })[0])
            .toMatch(/^unknown area `Plugins`; one of Attributes, .*, or add it to `AREAS`/);
    });

    it("knows every area that commit areas map to", () => {
        expect(Object.values(AREA_NAMES).filter((area) => !AREAS.includes(area))).toEqual([]);
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
    const closings = [ 1, 2, 3, 4, 5, 6, 7, 9 ].map((number) => ({ issue: number,
        date: number * 10, subjects: [ number === 1 ? "fix(sync): x" : "fix: x" ],
        contributors: number === 3 || number === 9 ? [ "fixer" ] : [] }));
    const entry: ChangelogEntry = { file: "a.md", date: 15, section: "Bugfixes", closes: [ 3 ],
        credits: [], notable: false, text: "New wording", details: [] };
    const url = (number: number) => `https://github.com/o/r/issues/${number}`;

    it("keeps Key highlights as prose, without links or references appended", () => {
        const items = collectItems({ closings, issues, languages: [], repository: "o/r", entries: [
            { ...entry, section: "Key highlights", closes: [ 3 ], text: "One issue" },
            { ...entry, section: "Key highlights", closes: [ 6, 8 ], text: "Two issues" }
        ] });
        const highlights = items.filter((item) => item.section === "Key highlights");
        expect(highlights.map(({ text, credits, closes }) => [ text, credits.join(), closes ]))
            .toEqual([ [ "One issue", "fixer", [ 3 ] ], [ "Two issues", "", [ 6, 8 ] ] ]);
        expect(items.some((item) => item.text.includes("Old wording"))).toBe(false);
    });

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
                    text: `[Partly](${url(9)}) linked (by @fixer)` },
                { ...entry, file: "e.md", date: 55, closes: [ 21 ], text: "Own area only" }
            ],
            pullRequests: new Map([
                [ 20, { number: 20, title: "x", closes: [ 7 ] } ],
                [ 21, { number: 21, title: "feat(share): y", closes: [] } ]
            ]),
            repository: "o/r"
        });

        expect(items.map(({ section, area, text, credits }) =>
            [ section, area, text, credits.join() ])).toEqual([
            [ "Internationalization", undefined, "Persian (Farsi)", "reporter" ],
            [ "Bugfixes", undefined, `[New wording](${url(3)})`, "fixer" ],
            [ "Bugfixes", undefined, `Two issues ([#6](${url(6)}), [#8](${url(8)}))`, "thanked" ],
            [ "Bugfixes", "Search", "[Linked](https://y)", "" ],
            [ "Bugfixes", undefined,
                `[Partly](${url(9)}) linked (by @fixer) ([#20](https://github.com/o/r/pull/20))`,
                "" ],
            [ "Bugfixes", undefined, "[Own area only](https://github.com/o/r/pull/21)", "" ],
            [ "Bugfixes", "Sync", "[Crash on \\*save\\*](https://x/1)", "" ]
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

    it("lists notable items first, out of their area's block, and only when folding", () => {
        const notable = (text: string, date: number, area?: string) =>
            ({ ...item(text, date, area), notable: true });
        expect(renderSection([
            item("Third", 3, "Search"),
            item("First", 1),
            notable("Fourth", 4, "Search"),
            notable("Search: Fifth", 5, "Search"),
            item("Second", 2, "LLM")
        ], { collapsible: true })).toEqual([
            "1.  Search: Fourth",
            "2.  Search: Fifth",
            "3.  First by @a & @b",
            "",
            "<details>",
            "    <summary>LLM (1)</summary>",
            "    <ol>",
            "        <li>Second</li>",
            "    </ol>",
            "</details>",
            "",
            "<details>",
            "    <summary>Search (1)</summary>",
            "    <ol>",
            "        <li>Third</li>",
            "    </ol>",
            "</details>"
        ]);
        expect(renderSection([ notable("Third", 3, "Search"), item("Fourth", 4, "Search") ]))
            .toEqual([ "1.  Search", "    1.  Third", "    2.  Fourth" ]);
    });

    it("folds every area into a collapsible block after the list", () => {
        expect(renderSection([
            item("Third", 3, "Search"),
            item("First", 1),
            item("Second", 2, "LLM"),
            item("Fourth `#x`", 4, "Search", [ "* A detail." ])
        ], { collapsible: true })).toEqual([
            "1.  First by @a & @b",
            "",
            "<details>",
            "    <summary>LLM (1)</summary>",
            "    <ol>",
            "        <li>Second</li>",
            "    </ol>",
            "</details>",
            "",
            "<details>",
            "    <summary>Search (2)</summary>",
            "    <ol>",
            "        <li>Third</li>",
            "        <li>Fourth <code>#x</code><ul><li>A detail.</li></ul></li>",
            "    </ol>",
            "</details>"
        ]);
    });
});

describe("renderHighlights", () => {
    it("writes a heading over each item's paragraphs, oldest first, credits last", () => {
        const item = (date: number, title: string | undefined, text: string, details: string[],
            credits: string[] = []): NoteItem =>
            ({ section: "Key highlights", date, title, text, details, credits });
        expect(renderHighlights([
            item(2, "Tables", "Second paragraph.", [ "*   A point.", "*   Another." ],
                [ "a", "b" ]),
            item(1, "Editor", "First.", []),
            item(3, undefined, "Untitled", [])
        ])).toEqual([
            "### Editor", "", "First.", "",
            "### Tables", "", "Second paragraph.", "", "*   A point.", "*   Another.", "",
            "Contributed by @a and @b.", "",
            "### Untitled", ""
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

    it("can drop the preamble and the sections without items, keeping the admonitions", () => {
        const template = [
            "# Release Template",
            "> [!NOTE]",
            "> Star us.",
            "",
            "## 💡 Key highlights",
            "",
            "1.  \\[…\\]",
            "",
            "## 🐞 Bugfixes",
            "",
            "1.  \\[…\\]",
            "",
            "## ✨ Improvements",
            "",
            "1.  \\[…\\]"
        ].join("\n");

        expect(renderReleaseNote(template, "Changes since v1.0.0", [
            { section: "Bugfixes", date: 1, text: "Fixed", details: [], credits: [] },
            { section: "Note", date: 0, text: "Rebuilt nightly", details: [], credits: [] }
        ], { preamble: false, emptySections: false })).toBe([
            "# Changes since v1.0.0",
            "> [!NOTE]",
            "> Rebuilt nightly",
            "",
            "## 🐞 Bugfixes",
            "",
            "1.  Fixed",
            ""
        ].join("\n"));
    });
});

describe("parseProtocolVersions", () => {
    it("reads the sync protocol version and the newest migration's version", () => {
        expect(parseProtocolVersions({
            sync: "import x from \"./x.js\";\n\nconst SYNC_VERSION = 41;\n\nexport default {",
            db: [
                "export function getMaxMigrationVersion() {",
                "    return MIGRATIONS[0].version;",
                "}",
                "const MIGRATIONS = [",
                "    {",
                "        version: 242,",
                "        sql: \"\"",
                "    },",
                "    {",
                "        version: 241,"
            ].join("\n")
        })).toEqual({ sync: 41, db: 242 });
        expect(parseProtocolVersions({ sync: "const OTHER = 1;" }))
            .toEqual({ sync: undefined, db: undefined });
    });
});

describe("compatibilityItems", () => {
    it("lists each version that changed, and nothing when one side is unknown", () => {
        const sync = compatibilityItems({ sync: 39, db: 240 }, { sync: 41, db: 240 });
        expect(sync.map((item) => item.section)).toEqual([ "Compatibility" ]);
        expect(sync[0].text).toContain("sync protocol version went from 39 to 41");

        const both = compatibilityItems({ sync: 39, db: 240 }, { sync: 41, db: 242 });
        expect(both).toHaveLength(2);
        expect(both[1].text).toContain("database version went from 240 to 242");

        expect(compatibilityItems({ sync: 41, db: 242 }, { sync: 41, db: 242 })).toEqual([]);
        expect(compatibilityItems({}, { sync: 41, db: 242 })).toEqual([]);
    });

    it("nests the entries that explain a bump under its item, as sub-items", () => {
        const why: NoteItem = { section: "Compatibility", date: 5, text: "[Include notes](u)",
            details: [ "*   Captions too." ], credits: [ "adoriandoran" ], closes: [ 11798 ] };
        const [ item ] = compatibilityItems({ sync: 39, db: 240 }, { sync: 41, db: 240 },
            { sync: [ why ] });
        expect(item.details).toEqual([ "*   [Include notes](u) by @adoriandoran",
            "    *   Captions too." ]);
    });
});

describe("splitExplanations", () => {
    it("takes out the Compatibility items that close a change behind a bump", () => {
        const base = { date: 1, details: [], credits: [] };
        const sync: NoteItem = { ...base, section: "Compatibility", text: "s", closes: [ 11798 ] };
        const db: NoteItem = { ...base, section: "Compatibility", text: "d", closes: [ 5, 12000 ] };
        const other: NoteItem = { ...base, section: "Compatibility", text: "o", closes: [ 7 ] };
        const fix: NoteItem = { ...base, section: "Bugfixes", text: "f", closes: [ 11798 ] };
        expect(splitExplanations([ sync, db, other, fix ], { sync: [ 11798 ], db: [ 12000 ] }))
            .toEqual({ kept: [ other, fix ], sync: [ sync ], db: [ db ] });
    });
});

describe("unreleasedNotice", () => {
    it("names the previous release and the build the list comes from", () => {
        const notice = unreleasedNotice("v0.107.0", { hash: "abc1234", date: "2026-11-08" });
        expect(notice.section).toBe("Note");
        expect(notice.text).toContain("since v0.107.0");
        expect(notice.text).toContain("`abc1234` of 2026-11-08");
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

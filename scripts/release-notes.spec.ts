import { describe, expect, it } from "vitest";

import { categorize, collectClosings, type Commit, escapeMarkdown, type Issue, isShippedSeparately,
    parseClosingReferences, parseCommits, parsePullRequestNumber, type PullRequest,
    renderReleaseNote } from "./release-notes.mjs";

describe("parseClosingReferences", () => {
    it("reads closing keywords and ignores bare references", () => {
        expect(parseClosingReferences("fix(tabs): reset edit mode (closes #12477)")).toEqual([ 12477 ]);
        expect(parseClosingReferences("fix(text): selectable includes (regression of #5264, closes #12285)"))
            .toEqual([ 12285 ]);
        expect(parseClosingReferences("fix(client): avoid warnings (Closes #12439) (#12440)")).toEqual([ 12439 ]);
        expect(parseClosingReferences("fix #12253\n\nFixes #11825.\nResolves: #1")).toEqual([ 12253, 11825, 1 ]);
        expect(parseClosingReferences("fix(search): keep paths (#10021)")).toEqual([]);
        expect(parseClosingReferences("closes TriliumNext/Docs#3, prefixes #4")).toEqual([]);
    });
});

describe("parsePullRequestNumber", () => {
    it("reads merge and squash subjects", () => {
        expect(parsePullRequestNumber("Merge pull request #12535 from user/branch")).toBe(12535);
        expect(parsePullRequestNumber("fix(fonts): keep Monospace size (#12479)")).toBe(12479);
        expect(parsePullRequestNumber("fix(tabs): reset edit mode (closes #12477)")).toBeUndefined();
    });
});

describe("parseCommits", () => {
    it("splits records with multi-line bodies", () => {
        expect(parseCommits("a\x1ffix: one\x1fFixes #1\n\nmore\n\x1e\nb\x1ffeat: two\x1f\x1e\n")).toEqual([
            { hash: "a", subject: "fix: one", body: "Fixes #1\n\nmore" },
            { hash: "b", subject: "feat: two", body: "" }
        ]);
    });
});

describe("collectClosings", () => {
    it("merges commit and pull request references per issue and credits contributors", () => {
        const commits: Commit[] = [
            { hash: "1", subject: "fix(sync): keep edits (closes #10)", body: "" },
            { hash: "2", subject: "fix(sync): keep edits (closes #10) (#20)", body: "" },
            { hash: "3", subject: "Merge pull request #30 from user/branch", body: "Fix tables" },
            { hash: "4", subject: "feat(tree): menu (closes #40)", body: "" }
        ];
        const pullRequests = new Map<number, PullRequest>([
            [ 20, { number: 20, title: "fix(sync): keep edits", author: "contributor", closes: [ 10 ] } ],
            [ 30, { number: 30, title: "Fix tables", author: "renovate[bot]", closes: [ 31 ] } ]
        ]);
        const authors = new Map([ [ "1", "eliandoran" ], [ "4", "other" ] ]);

        expect(collectClosings(commits, pullRequests, authors)).toEqual([
            { issue: 10, subjects: [ "fix(sync): keep edits (closes #10)", "fix(sync): keep edits" ], contributors: [ "contributor" ] },
            { issue: 31, subjects: [ "Fix tables" ], contributors: [] },
            { issue: 40, subjects: [ "feat(tree): menu (closes #40)" ], contributors: [ "other" ] }
        ]);
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
        expect(categorize([ "close #1", "Merge pull request #2", "fix: x" ], "Feature")).toBe("Bugfixes");
        expect(categorize([ "close #1" ], "Feature")).toBe("Improvements");
        expect(categorize([ "close #1" ], undefined)).toBe("Bugfixes");
    });
});

describe("isShippedSeparately", () => {
    it("recognizes web clipper issues by label or by the area of every closing change", () => {
        expect(isShippedSeparately([ "Keep indentation (closes #1442)" ], [ "web-clipper" ])).toBe(true);
        expect(isShippedSeparately([ "feat(clipper): a", "fix(web-clipper): b" ], [])).toBe(true);
        expect(isShippedSeparately([ "feat(clipper): a", "fix(server): b" ], [])).toBe(false);
        expect(isShippedSeparately([ "feat(text): a" ], [ "ckeditor" ])).toBe(false);
    });
});

describe("renderReleaseNote", () => {
    it("fills the matching sections and keeps the placeholders of the others", () => {
        const template = [
            "# Release Template",
            "> [!NOTE]",
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
        const issues = new Map<number, Issue>([
            [ 1, { number: 1, title: "Crash on *save*", url: "https://x/1", state: "CLOSED", labels: [] } ],
            [ 2, { number: 2, title: "Wrong [size]", url: "https://x/2", state: "CLOSED", labels: [] } ],
            [ 4, { number: 4, title: "Clipper", url: "https://x/4", state: "CLOSED", labels: [ "web-clipper" ] } ]
        ]);

        expect(renderReleaseNote(template, "v1.0.0", [
            { issue: 1, subjects: [ "fix: a" ], contributors: [ "a", "b" ] },
            { issue: 2, subjects: [ "fix: b" ], contributors: [] },
            { issue: 3, subjects: [ "fix: c" ], contributors: [] },
            { issue: 4, subjects: [ "fix: d" ], contributors: [] }
        ], issues)).toBe([
            "# v1.0.0",
            "> [!NOTE]",
            "",
            "## 💡 Key highlights",
            "",
            "1.  \\[…\\]",
            "",
            "## 🐞 Bugfixes",
            "",
            "1.  [Crash on \\*save\\*](https://x/1) by @a & @b",
            "2.  [Wrong \\[size\\]](https://x/2)",
            "",
            "## ✨ Improvements",
            "",
            "1.  \\[…\\]",
            ""
        ].join("\n"));
    });
});

describe("escapeMarkdown", () => {
    it("escapes what would break a link label or turn into markup", () => {
        expect(escapeMarkdown("safe_fetch [bug] *x* <style> `code`")).toBe("safe\\_fetch \\[bug\\] \\*x\\* &lt;style> `code`");
    });
});

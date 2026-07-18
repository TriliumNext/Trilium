import { describe, expect, it } from "vitest";

import { buildTabTitle, TAB_TITLE_SEPARATOR } from "./tab_title.js";

describe("buildTabTitle", () => {
    it("joins split titles with the separator and preserves each segment's active flag", () => {
        const { segments, tooltip } = buildTabTitle(
            [
                { title: "Inbox", active: false },
                { title: "Tasks", active: true }
            ],
            "New tab"
        );

        expect(segments).toEqual([
            { text: "Inbox", active: false },
            { text: "Tasks", active: true }
        ]);
        expect(tooltip).toBe(`Inbox${TAB_TITLE_SEPARATOR}Tasks`);
    });

    it("falls back to the empty label for empty/untitled splits", () => {
        const { segments, tooltip } = buildTabTitle(
            [
                { title: "Inbox", active: false },
                { title: null, active: true },
                { title: "", active: false },
                { title: undefined, active: false }
            ],
            "New tab"
        );

        expect(segments.map((s) => s.text)).toEqual(["Inbox", "New tab", "New tab", "New tab"]);
        expect(tooltip).toBe("Inbox • New tab • New tab • New tab");
    });

    it("produces a single segment with no separator for a single split", () => {
        const { segments, tooltip } = buildTabTitle([{ title: "Solo", active: true }], "New tab");

        expect(segments).toHaveLength(1);
        expect(tooltip).toBe("Solo");
    });

    it("handles an empty split list", () => {
        const { segments, tooltip, tooltipHtml } = buildTabTitle([], "New tab");

        expect(segments).toEqual([]);
        expect(tooltip).toBe("");
        expect(tooltipHtml).toBe("");
    });
});

describe("buildTabTitle tooltipHtml", () => {
    it("wraps the active segment in <strong> and joins with the separator", () => {
        const { tooltipHtml } = buildTabTitle(
            [
                { title: "Inbox", active: false },
                { title: "Tasks", active: true }
            ],
            "New tab"
        );

        expect(tooltipHtml).toBe(`Inbox${TAB_TITLE_SEPARATOR}<strong>Tasks</strong>`);
    });

    it("escapes HTML in note titles to prevent injection (active and inactive)", () => {
        const { tooltipHtml } = buildTabTitle(
            [
                { title: `<img src=x onerror=alert(1)>`, active: false },
                { title: `<script>alert("xss")</script>`, active: true }
            ],
            "New tab"
        );

        expect(tooltipHtml).toBe(
            `&lt;img src=x onerror=alert(1)&gt;${TAB_TITLE_SEPARATOR}<strong>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</strong>`
        );
        expect(tooltipHtml).not.toContain("<img");
        expect(tooltipHtml).not.toContain("<script>");
    });

    it("escapes ampersands before other entities", () => {
        const { tooltipHtml } = buildTabTitle([{ title: "A & B <c>", active: false }], "New tab");

        expect(tooltipHtml).toBe("A &amp; B &lt;c&gt;");
    });

    it("does not bold the active segment when there is only one split", () => {
        const { tooltipHtml } = buildTabTitle([{ title: "Solo", active: true }], "New tab");

        expect(tooltipHtml).toBe("Solo");
    });

    it("prepends the pinned prefix to both tooltip strings, escaping it in the HTML one", () => {
        const { tooltip, tooltipHtml } = buildTabTitle(
            [
                { title: "Inbox", active: false },
                { title: "Tasks", active: true }
            ],
            "New tab",
            { pinnedPrefix: "Pinned: " }
        );

        expect(tooltip).toBe(`Pinned: Inbox${TAB_TITLE_SEPARATOR}Tasks`);
        expect(tooltipHtml).toBe(`Pinned: Inbox${TAB_TITLE_SEPARATOR}<strong>Tasks</strong>`);
    });

    it("escapes the pinned prefix too", () => {
        const { tooltipHtml } = buildTabTitle([{ title: "Inbox", active: false }], "New tab", { pinnedPrefix: "A & B: " });

        expect(tooltipHtml).toBe("A &amp; B: Inbox");
    });
});

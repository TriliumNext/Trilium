import { applyTabs } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FindWidget from "./find";
import FindInHtml, { HtmlFindTarget, HtmlNoteFindTarget } from "./find_in_html.js";
import MergedFind from "./merged_find";
import { registerEmbedFindTarget } from "./type_widgets/text/content_embed_tools";

const OPTIONS = { matchCase: false, wholeWord: false };
const CONTENT = "<p>needle before</p>"
    + "<figure class=\"include-note\"><div class=\"include-note-wrapper\">"
    + "<div class=\"include-note-title-row\">needle title</div>"
    + "<div class=\"include-note-content\">"
    + "<details><summary>s</summary><p>needle inside</p></details>"
    + "</div></div><figcaption>needle caption</figcaption></figure>"
    + "<details><summary>s</summary><p>needle hidden</p></details>";

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.replaceChildren();
});

/**
 * Builds a FindInHtml wired to a real (happy-dom) content element, so mark.js can mutate it.
 */
function setup(html: string) {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.innerHTML = html;
    document.body.appendChild(container);

    const parent = {
        noteContext: {
            getContentElement: async () => $(container)
        },
        invalidateResults: vi.fn()
    } as any;

    return { finder: new FindInHtml(parent), container };
}

describe("FindInHtml", () => {
    beforeEach(() => {
        // happy-dom doesn't implement scrollIntoView; jumpTo() calls it.
        (Element.prototype as any).scrollIntoView = vi.fn();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("marks the seed term with the primary find-result class and counts matches", async () => {
        const { finder, container } = setup("<p>alpha beta alpha gamma</p>");

        const result = await finder.performFind("alpha", false, false);

        expect(result.totalFound).toBe(2);
        expect(result.currentFound).toBe(1);
        expect(container.querySelectorAll(".ck-find-result").length).toBe(2);
        expect(container.querySelectorAll(".find-result-secondary").length).toBe(0);
    });

    it("highlightExtraTokens marks non-seed tokens with the muted secondary class only", async () => {
        const { finder, container } = setup("<p>alpha beta gamma</p>");

        await finder.performFind("alpha", false, false);
        await finder.highlightExtraTokens([ "beta", "gamma" ]);

        // Seed count is unaffected: Enter/F3 still cycles only the primary matches.
        expect(container.querySelectorAll(".ck-find-result").length).toBe(1);
        expect(container.querySelectorAll(".find-result-secondary").length).toBe(2);
    });

    it("findBoxClosed clears the primary and the secondary marks together", async () => {
        const { finder, container } = setup("<p>alpha beta gamma</p>");

        await finder.performFind("alpha", false, false);
        await finder.highlightExtraTokens([ "beta" ]);
        expect(container.querySelectorAll(".ck-find-result, .find-result-secondary").length).toBe(2);

        await finder.findBoxClosed(1, 0);

        expect(container.innerHTML).toBe("<p>alpha beta gamma</p>");
    });

    it("highlightExtraTokens is a no-op before a find has run (no mark instance yet)", async () => {
        const { finder, container } = setup("<p>alpha beta</p>");

        await finder.highlightExtraTokens([ "beta" ]);

        expect(container.querySelectorAll(".find-result-secondary").length).toBe(0);
    });

    it("highlightExtraTokens safely handles tokens containing regex metacharacters", async () => {
        const { finder, container } = setup("<p>a.c a+c value</p>");

        await finder.performFind("value", false, false);
        await finder.highlightExtraTokens([ "a.c", "a+c" ]);

        // Literal matches only, no regex injection (both literal tokens exist once each).
        const secondary = Array.from(container.querySelectorAll(".find-result-secondary")).map((el) => el.textContent);
        expect(secondary).toContain("a.c");
        expect(secondary).toContain("a+c");
    });

    it("shows the tab that holds the current match", async () => {
        const { finder, container } = setup(
            "<div class=\"trilium-tabs\">" +
                "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">A</p>" +
                    "<div class=\"trilium-tab-panel\"><p>first</p></div></section>" +
                "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">B</p>" +
                    "<div class=\"trilium-tab-panel\"><p>needle</p></div></section>" +
            "</div>"
        );
        applyTabs(container, { placeholder: "", scrollLabels: { start: "", end: "" } });
        const activeTitle = () => container.querySelector(".trilium-tab-title--active")?.textContent;
        expect(activeTitle()).toBe("A");

        const result = await finder.performFind("needle", false, false);

        expect(result.totalFound).toBe(1);
        expect(activeTitle()).toBe("B");
    });

    it("drives the find bar, and marks it stale as embeds change", async () => {
        const { content, embed } = mount();
        const parent = {
            noteContext: { getContentElement: async () => [ content ] },
            invalidateResults: vi.fn()
        };
        const handler = new FindInHtml(parent as unknown as FindWidget);

        expect(await handler.performFind("needle", false, false))
            .toEqual({ totalFound: 3, currentFound: 1 });
        await handler.findNext(1, 1, 2);
        const selected = content.querySelector(".ck-find-result_selected");
        expect(selected?.closest("details")?.open).toBe(true);
        await handler.highlightExtraTokens([ "before", "" ]);
        expect(content.querySelector(".find-result-secondary")?.textContent).toBe("before");

        cleanups.push(registerEmbedFindTarget(embed, new HtmlFindTarget(embed)));
        expect(parent.invalidateResults).toHaveBeenCalledOnce();
        await handler.findBoxClosed(3, 3);
        expect(content.querySelector(".ck-find-result, .find-result-secondary")).toBeNull();
        cleanups.push(registerEmbedFindTarget(content, new HtmlFindTarget(content)));
        expect(parent.invalidateResults).toHaveBeenCalledOnce();
    });
});

describe("HtmlNoteFindTarget", () => {
    it("searches the content of a note around its embeds, and reveals a match", async () => {
        const { content, embed } = mount();
        const target = new HtmlNoteFindTarget(content);

        expect(await target.find("needle", OPTIONS)).toBe(3);
        expect(embed.querySelectorAll(".include-note-wrapper .ck-find-result")).toHaveLength(0);
        expect(target.getEmbeds()).toEqual([ embed ]);
        expect(target.countMatchesBefore(embed)).toBe(1);
        expect(target.canReplace()).toBe(false);
        expect(await target.replaceAll()).toBe(3);

        target.highlight(2);
        const selected = content.querySelector(".ck-find-result_selected");
        expect(selected?.textContent).toBe("needle");
        expect(selected?.closest("details")?.open).toBe(true);
        expect(target.getFirstMatchBelow(-Infinity)).toBe(0);
        expect(target.getFirstMatchBelow(Infinity)).toBeNull();
        target.highlight(null);
        expect(content.querySelector(".ck-find-result_selected")).toBeNull();

        expect(target.close()).toBe(false);
        expect(content.querySelector(".ck-find-result")).toBeNull();
        expect(await target.find("", OPTIONS)).toBe(0);
    });

    it("leaves the matches of an embed to the target of its content", async () => {
        const { content, embed } = mount();
        const box = embed.querySelector<HTMLElement>(".include-note-content");
        if (!box) throw new Error("The embed has no content box.");
        cleanups.push(registerEmbedFindTarget(box, new HtmlFindTarget(box)));
        const find = new MergedFind(new HtmlNoteFindTarget(content));

        expect(await find.find("needle", OPTIONS)).toBe(4);
        expect(box.querySelectorAll(".ck-find-result")).toHaveLength(1);

        find.highlight(1);
        expect(box.querySelector("details")?.open).toBe(true);
        expect(content.querySelector<HTMLDetailsElement>(":scope > details")?.open).toBe(false);
    });

    it("opens a collapsed block around an embed, and no block around its own content", async () => {
        document.body.innerHTML = "<details><summary>s</summary><div class=\"content\">"
            + "<figure class=\"include-note\"><div class=\"inner\"><p>needle</p></div></figure>"
            + "</div></details>";
        const outer = document.querySelector("details");
        const content = document.querySelector<HTMLElement>(".content");
        const inner = document.querySelector<HTMLElement>(".inner");
        const embed = document.querySelector<HTMLElement>(".include-note");
        if (!outer || !content || !inner || !embed) throw new Error("Incomplete fixture.");

        const innerTarget = new HtmlFindTarget(inner);
        await innerTarget.find("needle", OPTIONS);
        innerTarget.highlight(0);
        expect(outer.open).toBe(false);

        new HtmlNoteFindTarget(content).revealEmbed(embed);
        expect(outer.open).toBe(false);
        new HtmlNoteFindTarget(document.body).revealEmbed(embed);
        expect(outer.open).toBe(true);
    });
});

function mount() {
    const content = document.createElement("div");
    content.innerHTML = CONTENT;
    document.body.append(content);
    const embed = content.querySelector<HTMLElement>(".include-note");
    if (!embed) throw new Error("The content has no embed.");
    return { content, embed };
}

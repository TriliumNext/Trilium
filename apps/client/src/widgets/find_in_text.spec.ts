import type { CKTextEditor } from "@triliumnext/ckeditor5";
import FindReveal from "@triliumnext/ckeditor5/src/plugins/find_reveal.js";
import {
    ClassicEditor, type Editor, Essentials, FindAndReplaceEditing, Paragraph, toWidgetEditable
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scrollRangeIntoView } from "../services/highlight_matches";
import type FindWidget from "./find";
import FindInText, { TextEditorFindTarget } from "./find_in_text";
import MergedFind, { type FindTarget } from "./merged_find";
import { registerEmbedFindTarget } from "./type_widgets/text/content_embed_tools";

vi.mock("../services/highlight_matches", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/highlight_matches")>()),
    scrollRangeIntoView: vi.fn()
}));

const OPTIONS = { matchCase: false, wholeWord: false };
const CONTENT = "<p>needle one</p>"
    + "<figure class=\"include-note\"><figcaption>needle caption</figcaption></figure>"
    + "<p>needle two</p>";

let editor: ClassicEditor;
let cleanups: (() => void)[];

beforeEach(async () => {
    const element = document.createElement("div");
    document.body.append(element);
    editor = await ClassicEditor.create(element, {
        licenseKey: "GPL",
        plugins: [ Essentials, Paragraph, FindAndReplaceEditing, FindReveal, EmbedSchema ]
    });
    editor.setData(CONTENT);
    cleanups = [];
});

afterEach(async () => {
    for (const cleanup of cleanups) cleanup();
    if (editor.state !== "destroyed") await editor.destroy();
    document.body.replaceChildren();
});

describe("TextEditorFindTarget", () => {
    it("places the matches of an embed between the text before it and its caption", async () => {
        const embedTarget = registerEmbedTarget(2);
        const find = new MergedFind(new TextEditorFindTarget(asTextEditor(editor)));

        expect(await find.find("needle", OPTIONS)).toBe(5);

        find.highlight(0);
        expect(highlightedText()).toBe("needle one");
        find.highlight(2);
        expect(embedTarget.highlight).toHaveBeenLastCalledWith(1, undefined);
        expect(highlightedText()).toBeNull();
        expect(editor.plugins.get(FindReveal).position?.path).toEqual([ 1, 0 ]);
        find.highlight(3);
        expect(highlightedText()).toBe("needle caption");
        find.highlight(4);
        expect(highlightedText()).toBe("needle two");
        expect(embedTarget.highlight).toHaveBeenLastCalledWith(null);
    });

    it("starts at a match at the selection, or at the first match below a line", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await target.find("needle", OPTIONS);
        expect(target.getSelectedMatch()).toBeNull();
        expect(target.getFirstMatchBelow(-Infinity)).toBe(0);
        expect(target.getFirstMatchBelow(Infinity)).toBeNull();

        const lastParagraph = editor.model.document.getRoot()?.getChild(2);
        if (!lastParagraph?.is("element")) throw new Error("Expected a third paragraph.");
        editor.model.change((writer) => writer.setSelection(lastParagraph, "in"));
        expect(target.getSelectedMatch()).toBe(2);
    });

    it("replaces one match or all of them, and closes on a match", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await target.find("needle", OPTIONS);

        expect(target.canReplace(0)).toBe(true);
        expect(target.canReplace(3)).toBe(false);
        expect(await target.replace(0, "pin")).toBe(2);
        expect(editor.getData()).toContain("<p>pin one</p>");
        expect(await target.replaceAll("pin")).toBe(0);
        expect(editor.getData()).not.toContain("needle");

        await target.find("pin", OPTIONS);
        // happy-dom has no layout to scroll.
        const scroll = vi.spyOn(editor.editing.view, "scrollToTheSelection")
            .mockImplementation(() => {});
        const select = target.close(2);
        expect(editor.plugins.get(FindAndReplaceEditing).state?.results.length).toBe(0);
        expect(scroll).not.toHaveBeenCalled();
        select?.();
        expect(scroll).toHaveBeenCalledOnce();
        const selection = editor.model.document.selection.getFirstRange();
        expect(selection?.start.path).toEqual([ 2, 0 ]);
        expect(selection?.end.path).toEqual([ 2, 3 ]);
        expect(target.close(null)).toBeNull();
    });

    it("names each match's first highlight span, and the spans shown now while stale", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await target.find("needle", OPTIONS);
        const root = editor.editing.view.getDomRoot();
        const spanTexts = (targets: unknown[]) =>
            targets.map((span) => (span as HTMLElement | null)?.textContent ?? null);

        expect(root?.querySelector("figcaption")?.classList.contains("ck-editor__nested-editable"))
            .toBe(true);
        expect(spanTexts(target.getMatchTargets({ isStale: false })))
            .toEqual([ "needle", "needle", "needle" ]);
        const [ first ] = target.getMatchTargets({ isStale: false });
        expect(first).toBe(root?.querySelector("span.ck-find-result"));

        // A nested editor shows the spans of its own target.
        const nested = root?.appendChild(document.createElement("div"));
        nested?.classList.add("ck-editor__editable");
        nested?.insertAdjacentHTML(
            "beforeend",
            "<span class=\"ck-find-result\" data-find-result=\"nested\">needle</span>"
        );

        // An edit gives the matches of its paragraph new results: the old ones have no span left.
        typeText("needle ");
        expect(target.getMatchTargets({ isStale: false }).slice(0, 2))
            .toEqual([ null, expect.any(HTMLElement) ]);
        expect(spanTexts(target.getMatchTargets({ isStale: true })))
            .toEqual([ "needle", "needle", "needle", "needle" ]);
        nested?.remove();
    });

    it("recounts live matches, which its indices follow, without destroyed markers", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        const find = new MergedFind(target);
        await find.find("needle", OPTIONS);

        // A new match in the first paragraph, and the match of the last paragraph deleted.
        typeText("needle ");
        editor.model.change((writer) => {
            const last = editor.model.document.getRoot()?.getChild(2);
            if (!last?.is("element")) throw new Error("Expected a third paragraph.");
            writer.remove(writer.createRangeIn(last));
        });

        expect(find.countMatches()).toBe(3);
        const texts: (string | null)[] = [];
        for (let index = 0; index < 3; index++) {
            find.highlight(index);
            texts.push(highlightedText());
        }
        expect(texts).toEqual([ "needle needle one", "needle needle one", "needle caption" ]);
        expect(() => target.getEmbeds().map((embed) => target.countMatchesBefore(embed)))
            .not.toThrow();
    });

    it("keeps its current match through edits, and drops it once an edit removes it", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await target.find("needle", OPTIONS);
        const state = editor.plugins.get(FindAndReplaceEditing).state;
        target.highlight(2);
        const current = state?.highlightedResult;
        expect(highlightedText()).toBe("needle two");

        typeText("needle ");
        expect(state?.results.length).toBe(4);
        expect(state?.highlightedResult).toBe(current);

        // Typing in its paragraph gives the match a new result, which the plugin makes current.
        editor.model.change((writer) => {
            const last = editor.model.document.getRoot()?.getChild(2);
            if (!last?.is("element")) throw new Error("Expected a third paragraph.");
            writer.insertText("x", last, 0);
        });
        expect(state?.highlightedResult).toBeNull();

        target.close(null);
        typeText("needle ");
        expect(state?.results.length).toBe(0);
    });

    it("stops the find on close even with its current match deleted; selects nothing", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await target.find("needle", OPTIONS);
        editor.model.change((writer) => {
            const first = editor.model.document.getRoot()?.getChild(0);
            if (!first?.is("element")) throw new Error("Expected a first paragraph.");
            writer.remove(writer.createRangeIn(first));
        });

        expect(target.close(0)).toBeNull();
        expect(editor.plugins.get(FindAndReplaceEditing).state?.results.length).toBe(0);
        expect(editor.editing.view.getDomRoot()?.querySelector(".ck-find-result")).toBeNull();
    });

    it("scrolls to the current match at once only for an instant highlight", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await target.find("needle", OPTIONS);

        target.highlight(1);
        expect(scrollRangeIntoView).not.toHaveBeenCalled();
        target.highlight(2, { isInstant: true });
        expect(highlightedText()).toBe("needle two");
        expect(scrollRangeIntoView).toHaveBeenCalledWith(expect.anything(), "instant");
    });

    it("finds nothing once its editor is destroyed", async () => {
        const target = new TextEditorFindTarget(asTextEditor(editor));
        await editor.destroy();

        expect(await target.find("needle", OPTIONS)).toBe(0);
        expect(target.getEmbeds()).toEqual([]);
        expect(() => target.highlight(0)).not.toThrow();
        expect(() => target.revealEmbed(null)).not.toThrow();
        expect(target.close(null)).toBeNull();
        expect(target.countMatches()).toBe(0);
        expect(target.getMatchTargets({ isStale: false })).toEqual([]);
    });
});

describe("FindInText", () => {
    it("drives the find bar, and marks it stale as embeds or the content change", async () => {
        const parent = {
            noteContext: { getTextEditor: async () => editor },
            invalidateResults: vi.fn()
        };
        const handler = new FindInText(parent as unknown as FindWidget);
        const embedTarget = registerEmbedTarget(1, false);
        const changeEmbed = () => {
            for (const watcher of embedTarget.watchers) watcher();
        };

        expect(await handler.performFind("needle", false, false))
            .toEqual({ totalFound: 4, currentFound: 1 });
        await handler.findNext(1, 0, 1);
        expect(handler.canReplace()).toBe(false);
        await handler.findNext(1, 1, 3);
        expect(handler.canReplace()).toBe(true);
        expect(parent.invalidateResults).not.toHaveBeenCalled();
        expect(await handler.replace("pin")).toEqual({
            isDropped: false, result: { totalFound: 3, currentFound: 1 }
        });
        expect(editor.getData()).toContain("<p>pin two</p>");
        expect(await handler.replaceAll("pin")).toEqual({
            isDropped: false, result: { totalFound: 1, currentFound: 1 }
        });

        parent.invalidateResults.mockClear();
        registerEmbedTarget(0);
        changeEmbed();
        typeText("needle");
        expect(parent.invalidateResults).toHaveBeenCalledTimes(3);
        await handler.findBoxClosed();
        registerEmbedTarget(0);
        changeEmbed();
        typeText("needle");
        expect(parent.invalidateResults).toHaveBeenCalledTimes(3);

        embedTarget.unregister();
        expect(embedTarget.watchers.size).toBe(0);
    });
});

/**
 * A `contentEmbed` with a caption, as the editor saves an embed. The caption is a nested editable,
 * as captions and table cells are in the app.
 */
function EmbedSchema(target: Editor) {
    target.model.schema.register("contentEmbed", { inheritAllFrom: "$blockObject" });
    target.model.schema.register("caption", {
        allowIn: "contentEmbed", allowContentOf: "$block", isLimit: true
    });
    target.conversion.elementToElement({
        model: "contentEmbed", view: { name: "figure", classes: "include-note" }
    });
    target.conversion.for("upcast").elementToElement({ model: "caption", view: "figcaption" });
    target.conversion.for("dataDowncast").elementToElement({
        model: "caption", view: "figcaption"
    });
    target.conversion.for("editingDowncast").elementToElement({
        model: "caption",
        view: (_element, { writer }) =>
            toWidgetEditable(writer.createEditableElement("figcaption"), writer)
    });
}

/** Lets a fake target with `count` matches search the embed of the editor. */
function registerEmbedTarget(count: number, isEditable = true) {
    const embed = editor.editing.view.getDomRoot()?.querySelector<HTMLElement>(".include-note");
    if (!embed) throw new Error("The editor shows no embed.");
    const watchers = new Set<() => void>();
    const target = {
        find: vi.fn(async () => count),
        highlight: vi.fn((_index: number | null) => {}),
        getFirstMatchBelow: () => null,
        getMatchTargets: () => Array.from({ length: count }, () => null),
        countMatches: () => count,
        canReplace: () => isEditable,
        replace: async () => count,
        replaceAll: async () => count,
        close: () => null,
        watchContent: (callback: () => void) => {
            watchers.add(callback);
            return () => watchers.delete(callback);
        }
    } satisfies FindTarget;
    const unregister = registerEmbedFindTarget(embed, target);
    cleanups.push(unregister);
    return Object.assign(target, { watchers, unregister });
}

/** Types `text` at the start of the first paragraph. */
function typeText(text: string) {
    editor.model.change((writer) => {
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph?.is("element")) throw new Error("Expected a first paragraph.");
        writer.insertText(text, paragraph, 0);
    });
}

/** The text of the block that holds the highlighted match, or `null` without one. */
function highlightedText() {
    const state = editor.plugins.get(FindAndReplaceEditing).state;
    const block = state?.highlightedResult?.marker?.getStart().parent;
    if (!block?.is("element")) return null;
    return [ ...block.getChildren() ]
        .map((child) => (child.is("$text") ? child.data : "")).join("");
}

function asTextEditor(textEditor: ClassicEditor) {
    return textEditor as unknown as CKTextEditor;
}

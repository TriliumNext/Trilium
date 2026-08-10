import {
    type ClassicEditor,
    ContextualBalloon,
    Essentials,
    _getModelData as getModelData,
    keyCodes,
    MentionEditing,
    type MentionFeedObjectItem,
    Paragraph,
    _setModelData as setModelData,
    View
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import type { TriliumMentionFeed } from "./types.js";
import TriliumMentionUI from "./trilium_mention_ui.js";

/** Longer than the plugin's 100 ms feed debounce. */
const AFTER_DEBOUNCE = 160;

describe("TriliumMentionUI", () => {
    let editor: ClassicEditor;
    let labelFeed: ReturnType<typeof vi.fn>;

    async function createEditor(overrides: Partial<TriliumMentionFeed> = {}, extraConfig: Record<string, unknown> = {}) {
        labelFeed = vi.fn(async (query: string) => (
            [ "alpha", "beta", "gamma" ]
                .filter((name) => name.startsWith(query))
                .map((name) => ({ id: `#${name}`, text: `#${name}` }))
        ));

        editor = await createTestEditor([ Essentials, Paragraph, MentionEditing, TriliumMentionUI ], {
            mention: {
                feeds: [ { marker: "#", feed: labelFeed as unknown as TriliumMentionFeed["feed"], minimumCharacters: 0, ...overrides } ]
            },
            ...extraConfig
        });
    }

    /** Whether the autocomplete balloon is currently on screen. */
    function isPanelVisible() {
        const balloon = editor.plugins.get(ContextualBalloon);

        return balloon.visibleView?.element?.classList.contains("ck-mentions") ?? false;
    }

    /** Types `text` at the caret, producing the `change:data` the text watcher reacts to. */
    function type(text: string) {
        editor.model.change((writer) => {
            editor.model.insertContent(writer.createText(text), editor.model.document.selection.getFirstPosition());
        });
    }

    /** Moves the caret to `offset` in the first paragraph, as a click would. */
    function moveCaretTo(offset: number) {
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);

            if (paragraph?.is("element")) {
                writer.setSelection(writer.createPositionAt(paragraph, offset));
            }
        });
    }

    function pressKey(keyCode: number) {
        editor.editing.view.document.fire("keydown", {
            keyCode,
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, AFTER_DEBOUNCE));
    }

    beforeEach(async () => {
        await createEditor();
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    });

    it("registers itself and requires the contextual balloon", () => {
        expect(TriliumMentionUI.pluginName).toBe("TriliumMentionUI");
        expect(TriliumMentionUI.requires).toContain(ContextualBalloon);
        expect(editor.plugins.get(TriliumMentionUI)).toBeInstanceOf(TriliumMentionUI);
    });

    it("opens the panel while typing and queries the feed with the text after the marker", async () => {
        type("#al");
        await settle();

        expect(labelFeed).toHaveBeenCalledWith("al");
        expect(isPanelVisible()).toBe(true);
    });

    it("hides the panel when the feed returns nothing", async () => {
        type("#zzz");
        await settle();

        expect(isPanelVisible()).toBe(false);
    });

    it("keeps the panel open, and anchored where it opened, while the query is refined", async () => {
        type("#a");
        await settle();
        expect(isPanelVisible()).toBe(true);

        const position = editor.plugins.get(ContextualBalloon).view.position;

        type("l");
        await settle();

        expect(labelFeed).toHaveBeenLastCalledWith("al");
        expect(isPanelVisible()).toBe(true);
        // Re-showing reuses the position that already matched, so the panel does not jump.
        expect(editor.plugins.get(ContextualBalloon).view.position).toBe(position);
    });

    it("survives another plugin's balloon burying the panel", async () => {
        const balloon = editor.plugins.get(ContextualBalloon);
        const errors: unknown[] = [];
        const onRejection = (event: PromiseRejectionEvent) => errors.push(event.reason);
        window.addEventListener("unhandledrejection", onRejection);

        type("#a");
        await settle();
        expect(isPanelVisible()).toBe(true);

        // `singleViewMode` hides every other stack, so the mention panel is still registered with
        // the balloon but is no longer the visible view.
        const other = new View(editor.locale);
        other.setTemplate({ tag: "div" });
        other.render();
        balloon.add({ view: other, position: { target: document.body }, singleViewMode: true });
        expect(isPanelVisible()).toBe(false);

        // Refining the query must not try to add the panel a second time: `ContextualBalloon.add()`
        // rejects an already-registered view outright, which is the `contextualballoon-add-view-exist`
        // crash upstream's visibility-based guard walks into.
        type("l");
        await settle();

        window.removeEventListener("unhandledrejection", onRejection);
        expect(errors).toEqual([]);
        expect(balloon.hasView(other)).toBe(true);
    });

    it("hides the panel on a click outside it", async () => {
        type("#al");
        await settle();
        expect(isPanelVisible()).toBe(true);

        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        expect(isPanelVisible()).toBe(false);
    });

    it("keeps the panel open when the click lands inside the balloon", async () => {
        type("#al");
        await settle();

        const balloonElement = editor.plugins.get(ContextualBalloon).view.element;
        balloonElement?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        expect(isPanelVisible()).toBe(true);
    });

    it("positions the panel from the right in a right-to-left UI", async () => {
        await createEditor({}, { language: { ui: "ar" } });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        expect(editor.locale.uiLanguageDirection).toBe("rtl");

        type("#al");
        await settle();

        expect(isPanelVisible()).toBe(true);
        expect(editor.plugins.get(ContextualBalloon).view.position).toMatch(/^caret_/);
    });

    describe("Escape dismisses without touching the document", () => {
        it("stays hidden across the next keystroke and inserts no sentinel character", async () => {
            type("#al");
            await settle();
            expect(isPanelVisible()).toBe(true);

            pressKey(keyCodes.esc);
            expect(isPanelVisible()).toBe(false);

            // The regression the removed pnpm patch caused: dismissing used to insert a U+2002
            // en-space, which the attribute lexer then folded into the attribute name.
            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).not.toContain(" ");
            expect(data).toContain("#al");

            // Upstream reopens here, because its text watcher re-evaluates and the pattern still matches.
            type("p");
            await settle();
            expect(isPanelVisible()).toBe(false);
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#alp");
        });

        it("reopens once the dismissed marker itself is retyped", async () => {
            type("#al");
            await settle();
            pressKey(keyCodes.esc);

            // Delete the whole marker, which sends the dismissal's live position to the graveyard.
            editor.model.change((writer) => {
                writer.remove(writer.createRangeIn(editor.model.document.getRoot()?.getChild(0) as never));
            });

            type("#be");
            await settle();

            expect(isPanelVisible()).toBe(true);
        });

        it("reopens once the block holding the dismissal is replaced wholesale", async () => {
            setModelData(editor.model, "<paragraph></paragraph><paragraph>[]</paragraph>");

            type("#al");
            await settle();
            pressKey(keyCodes.esc);

            // One edit drops the dismissed paragraph — sending the dismissal's live position to the
            // graveyard — and leaves a fresh marker matching in the block the caret ends up in. The
            // text watcher sees a match, not an unmatch, so only the graveyard check can recover.
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const first = root?.getChild(0);
                const second = root?.getChild(1);

                if (first?.is("element") && second) {
                    writer.insertText("#be", writer.createPositionAt(first, 0));
                    writer.remove(second);
                    writer.setSelection(writer.createPositionAt(first, "end"));
                }
            });
            await settle();

            expect(isPanelVisible()).toBe(true);
        });

        it("reopens for a different marker typed after the dismissed one", async () => {
            type("#al");
            await settle();
            pressKey(keyCodes.esc);

            type(" #be");
            await settle();

            expect(isPanelVisible()).toBe(true);
        });
    });

    describe("caret moves do not open the panel", () => {
        it("stays closed when the caret is placed inside existing matching text", async () => {
            setModelData(editor.model, "<paragraph>#alpha[]</paragraph>");

            moveCaretTo(3);
            await settle();

            expect(isPanelVisible()).toBe(false);
            expect(labelFeed).not.toHaveBeenCalled();
        });

        it("closes an open panel when the caret moves", async () => {
            type("#al");
            await settle();
            expect(isPanelVisible()).toBe(true);

            moveCaretTo(1);
            await settle();

            expect(isPanelVisible()).toBe(false);
        });
    });

    describe("commit keys", () => {
        it("commits the pre-selected item on Enter by default", async () => {
            type("#al");
            await settle();

            pressKey(keyCodes.enter);

            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#alpha");
        });

        it("leaves Enter alone when preselectFirstItem is off and nothing is selected", async () => {
            await createEditor({ preselectFirstItem: false });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#al");
            await settle();
            expect(isPanelVisible()).toBe(true);

            pressKey(keyCodes.enter);

            // Still just the typed text — no suggestion was committed behind the user's back.
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#al<");
        });

        it("commits after the user arrows onto an item even when nothing was pre-selected", async () => {
            await createEditor({ preselectFirstItem: false });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#");
            await settle();

            pressKey(keyCodes.arrowdown);
            pressKey(keyCodes.enter);

            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#alpha");
        });

        it("navigates the list with the arrow keys", async () => {
            type("#");
            await settle();

            pressKey(keyCodes.arrowdown);
            pressKey(keyCodes.arrowup);
            pressKey(keyCodes.enter);

            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#alpha");
        });

        it("ignores unrelated keys while the panel is open", async () => {
            type("#al");
            await settle();

            pressKey(keyCodes.a);

            expect(isPanelVisible()).toBe(true);
        });
    });

    describe("feed handling", () => {
        it("hides the panel when the feed rejects", async () => {
            await createEditor({ feed: vi.fn(async () => { throw new Error("boom"); }) as unknown as TriliumMentionFeed["feed"] });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#al");
            await settle();

            expect(isPanelVisible()).toBe(false);
        });

        it("filters a static array feed case-insensitively", async () => {
            await createEditor({ feed: [ "#Alpha", "#beta" ] });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#al");
            await settle();

            expect(isPanelVisible()).toBe(true);
            pressKey(keyCodes.enter);
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#Alpha");
        });

        it("honours dropdownLimit", async () => {
            await createEditor({ dropdownLimit: 1 });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#");
            await settle();

            const items = editor.plugins.get(ContextualBalloon).visibleView?.element?.querySelectorAll("li");
            expect(items?.length).toBe(1);
        });

        it("filters a static array feed of objects by id", async () => {
            await createEditor({ feed: [ { id: "#Alpha", text: "#Alpha" }, { id: "#beta", text: "#beta" } ] });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#al");
            await settle();

            expect(isPanelVisible()).toBe(true);
            pressKey(keyCodes.enter);
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#Alpha");
        });

        it("anchors the panel to the caret when the marked text was undone away mid-request", async () => {
            const resolvers: Array<(items: MentionFeedObjectItem[]) => void> = [];
            await createEditor({
                feed: (() => new Promise((resolve) => resolvers.push(resolve))) as unknown as TriliumMentionFeed["feed"]
            });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            // The undos are invisible to the text watcher, so the in-flight request still resolves
            // against a marker whose range has meanwhile been moved to the graveyard.
            editor.execute("enter");
            type("#al");
            await settle();
            editor.execute("undo");
            editor.execute("undo");

            resolvers[0]?.([ { id: "#alpha", text: "#alpha" } ]);
            await settle();

            expect(isPanelVisible()).toBe(true);
        });

        it("discards an out-of-order response", async () => {
            const resolvers: Array<(items: MentionFeedObjectItem[]) => void> = [];
            await createEditor({
                feed: (() => new Promise((resolve) => resolvers.push(resolve))) as unknown as TriliumMentionFeed["feed"]
            });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#a");
            await settle();
            type("l");
            await settle();

            // Answer the *first* request last; it must not repopulate the panel.
            resolvers[1]?.([ { id: "#alpha", text: "#alpha" } ]);
            resolvers[0]?.([ { id: "#stale", text: "#stale" } ]);
            await settle();

            pressKey(keyCodes.enter);
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("#alpha");
        });

        it("discards a stale response even when the newer request has the same query text", async () => {
            const resolvers: Array<(items: MentionFeedObjectItem[]) => void> = [];
            await createEditor({
                feed: (() => new Promise((resolve) => resolvers.push(resolve))) as unknown as TriliumMentionFeed["feed"]
            });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            // Same query typed twice, so correlating on the text alone cannot tell them apart.
            type("#al");
            await settle();
            editor.model.change((writer) => writer.remove(editor.model.createRangeIn(editor.model.document.getRoot()?.getChild(0) as never)));
            type("#al");
            await settle();

            resolvers[1]?.([ { id: "#fresh", text: "#fresh" } ]);
            resolvers[0]?.([ { id: "#stale", text: "#stale" } ]);
            await settle();

            pressKey(keyCodes.enter);
            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toContain("#fresh");
            expect(data).not.toContain("#stale");
        });

        it("does not let an earlier request's rejection close the panel a later one opened", async () => {
            let rejectFirst: (reason: Error) => void = () => {};
            let call = 0;
            await createEditor({
                feed: (() => {
                    if (call++ === 0) {
                        return new Promise((_resolve, reject) => { rejectFirst = reject; });
                    }
                    return Promise.resolve([ { id: "#alpha", text: "#alpha" } ]);
                }) as unknown as TriliumMentionFeed["feed"]
            });
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            type("#a");
            await settle();
            type("l");
            await settle();
            expect(isPanelVisible()).toBe(true);

            rejectFirst(new Error("boom"));
            await settle();

            expect(isPanelVisible()).toBe(true);
        });
    });

    it("does not re-trigger inside an existing mention", async () => {
        type("#al");
        await settle();
        pressKey(keyCodes.enter);
        await settle();

        // The caret now sits right after a committed mention.
        expect(isPanelVisible()).toBe(false);
    });

    it("does not open the panel for a caret parked inside an existing mention", async () => {
        setModelData(editor.model, "<paragraph>[]</paragraph><paragraph></paragraph>");

        type("#al");
        await settle();
        pressKey(keyCodes.enter);
        await settle();
        labelFeed.mockClear();

        // Inside the committed "#alpha", where the text before the caret still reads "#al".
        moveCaretTo(3);
        await settle();

        // An edit elsewhere re-evaluates that text, which must not be treated as a fresh query.
        editor.model.change((writer) => {
            const second = editor.model.document.getRoot()?.getChild(1);

            if (second?.is("element")) {
                writer.insertText("x", writer.createPositionAt(second, 0));
            }
        });
        await settle();

        expect(isPanelVisible()).toBe(false);
        expect(labelFeed).not.toHaveBeenCalled();
    });

    it("tolerates being initialised before MentionEditing registers the mention command", async () => {
        const feed = vi.fn(async () => [ { id: "#alpha", text: "#alpha" } ]);
        editor = await createTestEditor([ Essentials, Paragraph, TriliumMentionUI, MentionEditing ], {
            mention: { feeds: [ { marker: "#", feed: feed as unknown as TriliumMentionFeed["feed"], minimumCharacters: 0 } ] }
        });
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        type("#al");
        await settle();

        expect(isPanelVisible()).toBe(true);
    });

    it("hides the panel when the editor becomes read-only", async () => {
        type("#al");
        await settle();
        expect(isPanelVisible()).toBe(true);

        editor.enableReadOnlyMode("test");
        expect(isPanelVisible()).toBe(false);

        editor.disableReadOnlyMode("test");
    });

    it("renders a custom itemRenderer result", async () => {
        await createEditor({
            itemRenderer: (item) => {
                const element = document.createElement("button");
                element.classList.add("custom-mention-item");
                element.textContent = String(item.id);

                return element;
            }
        });
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        type("#al");
        await settle();

        expect(editor.plugins.get(ContextualBalloon).visibleView?.element?.querySelector(".custom-mention-item")).toBeTruthy();
    });

    it("renders a string itemRenderer result as a button label", async () => {
        await createEditor({ itemRenderer: (item) => `label:${item.id}` });
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        type("#al");
        await settle();

        expect(editor.plugins.get(ContextualBalloon).visibleView?.element?.textContent).toContain("label:#alpha");
    });
});

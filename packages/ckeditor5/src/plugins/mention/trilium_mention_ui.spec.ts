import {
    type ClassicEditor,
    Essentials,
    _getModelData as getModelData,
    keyCodes,
    MentionEditing,
    type MentionFeedObjectItem,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumMentionUI from "./trilium_mention_ui.js";
import type { MentionHostedFeed, MentionHostedList, MentionHostedListState } from "./types.js";

/** A host's list as the plugin sees it, recording what it is shown. */
interface StubList extends MentionHostedList {
    state: MentionHostedListState | null;
    show: Mock<(state: MentionHostedListState) => void>;
    hide: Mock<() => void>;
    handleKeyDown: Mock<(event: KeyboardEvent) => boolean>;
    destroy: Mock<() => void>;
}

/** A list whose element is there while it is shown, as a list showing entries has one. */
function createStubList(): StubList {
    const element = document.createElement("div");
    document.body.append(element);

    const list: StubList = {
        state: null,
        show: vi.fn<(state: MentionHostedListState) => void>((state) => { list.state = state; }),
        hide: vi.fn<() => void>(() => { list.state = null; }),
        handleKeyDown: vi.fn<(event: KeyboardEvent) => boolean>(() => true),
        destroy: vi.fn<() => void>(),
        get element() { return list.state ? element : null; }
    };
    return list;
}

describe("TriliumMentionUI", () => {
    let editor: ClassicEditor;
    let labels: StubList;
    let notes: StubList;

    async function createEditor(feeds: Partial<Record<"#" | "@", Partial<MentionHostedFeed>>> = {}, plugins = [ Essentials, Paragraph, MentionEditing, TriliumMentionUI ]) {
        labels = createStubList();
        notes = createStubList();

        editor = await createTestEditor(plugins, {
            mention: {
                feeds: [],
                hostedFeeds: [
                    { marker: "#", minimumCharacters: 0, list: () => labels, ...feeds["#"] },
                    { marker: "@", minimumCharacters: 0, allowSpaces: true, list: () => notes, ...feeds["@"] }
                ]
            }
        });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
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

    /** Presses a key in the editor, and returns whether the plugin kept it from the editor. */
    function press(keyCode: number) {
        const domEvent = new KeyboardEvent("keydown");
        const preventDefault = vi.fn();
        editor.editing.view.document.fire("keydown", {
            keyCode,
            domEvent,
            preventDefault,
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
        return { domEvent, consumed: preventDefault.mock.calls.length > 0 };
    }

    const text = () => getModelData(editor.model, { withoutSelection: true });

    /** Commits `#alpha` from the open label list, as a pick from it does. */
    function commitAlpha() {
        labels.state?.commit({ id: "#alpha", text: "#alpha" });
    }

    beforeEach(async () => {
        await createEditor();
    });

    it("shows a marker's list the query typed after it, the caret and the editable", () => {
        expect(TriliumMentionUI.pluginName).toBe("TriliumMentionUI");

        type("@my no");
        expect(notes.state?.query).toBe("my no");
        expect(notes.state?.caretRect().height).toBeGreaterThan(0);
        expect(notes.state?.editable).toBe(editor.editing.view.getDomRoot());
        type("te");
        expect(notes.state?.query).toBe("my note");
        expect(labels.show).not.toHaveBeenCalled();
    });

    it("closes one marker's list when another marker is typed", () => {
        type("@al");
        type(" #be");

        expect(notes.hide).toHaveBeenCalled();
        expect(notes.state).toBe(null);
        expect(labels.state?.query).toBe("be");
    });

    it("waits for a feed's minimum characters", async () => {
        await createEditor({ "#": { minimumCharacters: 2 } });

        type("#a");
        expect(labels.state).toBe(null);
        type("l");
        expect(labels.state?.query).toBe("al");
    });

    describe("Escape dismisses without touching the document", () => {
        it("stays hidden across the next keystroke and inserts no sentinel character", () => {
            type("#al");
            expect(press(keyCodes.esc).consumed).toBe(true);
            expect(labels.state).toBe(null);

            // The regression the removed pnpm patch caused: dismissing used to insert a U+2002
            // en-space, which the attribute lexer then folded into the attribute name.
            expect(text()).not.toContain(" ");
            expect(text()).toContain("#al");

            // Upstream reopens here, because its text watcher re-evaluates and the pattern still matches.
            type("p");
            expect(labels.state).toBe(null);
            expect(text()).toContain("#alp");
        });

        it("reopens once the dismissed marker itself is retyped", () => {
            type("#al");
            press(keyCodes.esc);

            // Delete the whole marker, which sends the dismissal's live position to the graveyard.
            editor.model.change((writer) => {
                writer.remove(writer.createRangeIn(editor.model.document.getRoot()?.getChild(0) as never));
            });

            type("#be");
            expect(labels.state?.query).toBe("be");
        });

        it("reopens once the block holding the dismissal is replaced wholesale", () => {
            setModelData(editor.model, "<paragraph></paragraph><paragraph>[]</paragraph>");

            type("#al");
            press(keyCodes.esc);

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

            expect(labels.state?.query).toBe("be");
        });

        it("reopens for a different marker typed after the dismissed one", () => {
            type("#al");
            press(keyCodes.esc);

            type(" #be");
            expect(labels.state?.query).toBe("be");
        });

        it("leaves Escape to the editor while the list shows nothing", () => {
            Object.defineProperty(labels, "element", { get: () => null });
            type("#al");

            expect(press(keyCodes.esc).consumed).toBe(false);
            expect(labels.handleKeyDown).not.toHaveBeenCalled();
        });
    });

    describe("caret moves do not open the list", () => {
        it("stays closed when the caret is placed inside existing matching text", () => {
            setModelData(editor.model, "<paragraph>#alpha</paragraph><paragraph>[]</paragraph>");
            labels.show.mockClear();

            moveCaretTo(3);
            expect(labels.show).not.toHaveBeenCalled();
            expect(labels.state).toBe(null);
        });

        it("closes an open list when the caret moves", () => {
            type("#al");
            moveCaretTo(1);

            expect(labels.hide).toHaveBeenCalled();
            expect(labels.state).toBe(null);
        });
    });

    it("forwards the keys while the list is open, keeping from the editor those it takes", () => {
        type("#al");
        const arrow = press(keyCodes.arrowdown);
        expect(labels.handleKeyDown).toHaveBeenCalledWith(arrow.domEvent);
        expect(arrow.consumed).toBe(true);

        // Enter with nothing highlighted, say, which the attribute editor saves on.
        labels.handleKeyDown.mockReturnValue(false);
        expect(press(keyCodes.enter).consumed).toBe(false);

        // Closed, the list is handed nothing.
        moveCaretTo(0);
        labels.handleKeyDown.mockClear();
        press(keyCodes.arrowdown);
        expect(labels.handleKeyDown).not.toHaveBeenCalled();
    });

    it("closes on a press outside the list's element, and not on one inside it", () => {
        type("#al");
        labels.element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(labels.state).not.toBe(null);
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(labels.state).toBe(null);
    });

    it("points the editable at the entry the open list highlights, and at none once it closes", () => {
        const root = editor.editing.view.getDomRoot();
        type("#al");
        const open = labels.state;

        open?.setActiveDescendant("row-1");
        expect(root?.getAttribute("aria-activedescendant")).toBe("row-1");
        open?.setActiveDescendant(null);
        expect(root?.hasAttribute("aria-activedescendant")).toBe(false);

        open?.setActiveDescendant("row-2");
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(root?.hasAttribute("aria-activedescendant")).toBe(false);
        // A list that has closed points at nothing.
        open?.setActiveDescendant("row-3");
        expect(root?.hasAttribute("aria-activedescendant")).toBe(false);
    });

    it("hides the list when the editor becomes read-only", () => {
        type("#al");
        editor.enableReadOnlyMode("test");
        expect(labels.state).toBe(null);
        editor.disableReadOnlyMode("test");
    });

    describe("committing", () => {
        it("replaces the trigger text with what the list commits, at once or once a promise settles", async () => {
            setModelData(editor.model, "<paragraph>x []</paragraph>");
            type("@al");
            notes.state?.commit({ id: "@alpha", text: "@alpha" });
            expect(text()).toContain("x <$text");
            expect(text()).toContain(">@alpha</$text>");
            expect(notes.state).toBe(null);

            setModelData(editor.model, "<paragraph>x []</paragraph>");
            type("@be");
            let resolveCommit: (item: MentionFeedObjectItem | undefined) => void = () => {};
            notes.state?.commit(new Promise((resolve) => { resolveCommit = resolve; }));
            // The text stays while the promise is pending, and the list is closed.
            expect(text()).toBe("<paragraph>x @be</paragraph>");
            expect(notes.state).toBe(null);
            resolveCommit({ id: "@beta", text: "@beta" });
            await Promise.resolve();
            expect(text()).toContain("@beta</$text>");
            expect(text()).not.toContain("@be<");

            setModelData(editor.model, "<paragraph>x []</paragraph>");
            type("@ga");
            notes.state?.commit(Promise.resolve(undefined));
            await Promise.resolve();
            expect(text()).toBe("<paragraph>x @ga</paragraph>");
        });

        it("leaves the text as it is for a pick arriving after the list closed, or a commit that fails", async () => {
            setModelData(editor.model, "<paragraph>x []</paragraph>");
            type("#al");
            const commit = labels.state?.commit;
            moveCaretTo(0);
            commit?.({ id: "#alpha", text: "#alpha" });
            expect(text()).toBe("<paragraph>x #al</paragraph>");

            setModelData(editor.model, "<paragraph>x []</paragraph>");
            type("#be");
            labels.state?.commit(Promise.reject(new Error("canceled")));
            await Promise.resolve();
            await Promise.resolve();
            expect(text()).toBe("<paragraph>x #be</paragraph>");
        });

        it("hands the item to the feed's commit with the trigger text gone, unless it went stale", async () => {
            const commit = vi.fn();
            const canCommit = vi.fn(() => true);
            await createEditor({ "#": { commit, canCommit } });

            setModelData(editor.model, "<paragraph>x []</paragraph>");
            type("#al");
            commitAlpha();
            expect(commit).toHaveBeenCalledExactlyOnceWith(editor, { id: "#alpha", text: "#alpha" });
            expect(text()).toBe("<paragraph>x </paragraph>");

            commit.mockClear();
            canCommit.mockReturnValue(false);
            type("#be");
            commitAlpha();
            expect(commit).not.toHaveBeenCalled();
            expect(text()).toBe("<paragraph>x #be</paragraph>");
        });

        it("does not reopen the list right after a committed mention, nor inside one", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph><paragraph></paragraph>");
            type("#al");
            commitAlpha();
            labels.show.mockClear();

            // Inside the committed "#alpha", where the text before the caret still reads "#al".
            moveCaretTo(3);
            // An edit elsewhere re-evaluates that text, which must not be treated as a fresh query.
            editor.model.change((writer) => {
                const second = editor.model.document.getRoot()?.getChild(1);

                if (second?.is("element")) {
                    writer.insertText("x", writer.createPositionAt(second, 0));
                }
            });

            expect(labels.show).not.toHaveBeenCalled();
        });
    });

    it("places the list at the caret once the marked text was undone away", () => {
        // The undos are invisible to the text watcher, so the list stays open on a marker whose range
        // has meanwhile been moved to the graveyard.
        editor.execute("enter");
        type("#al");
        const caretRect = labels.state?.caretRect;
        editor.execute("undo");
        editor.execute("undo");

        expect(editor.model.markers.get("mention")?.getRange().root.rootName).toBe("$graveyard");
        expect(caretRect?.().height).toBeGreaterThan(0);
    });

    it("tolerates being initialised before MentionEditing registers the mention command", async () => {
        await createEditor({}, [ Essentials, Paragraph, TriliumMentionUI, MentionEditing ]);

        type("#al");
        expect(labels.state?.query).toBe("al");
    });

    it("destroys the lists with the editor", async () => {
        await editor.destroy();
        expect(labels.destroy).toHaveBeenCalled();
        expect(notes.destroy).toHaveBeenCalled();
    });
});

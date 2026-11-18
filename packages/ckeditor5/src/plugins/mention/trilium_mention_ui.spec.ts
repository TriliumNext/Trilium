import {
    type ClassicEditor,
    type Editor,
    Essentials,
    _getModelData as getModelData,
    keyCodes,
    MentionEditing,
    type MentionFeedObjectItem,
    type ModelElement,
    ModelLivePosition,
    Paragraph,
    Plugin,
    _setModelData as setModelData,
    toWidget,
    Widget
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
        const plugin = editor.plugins.get(TriliumMentionUI);
        expect(plugin.isListShown).toBe(false);

        type("@my no");
        expect(plugin.isListShown).toBe(true);
        expect(notes.state?.query).toBe("my no");
        expect(notes.state?.caretRect().height).toBeGreaterThan(0);
        expect(notes.state?.editable).toBe(editor.editing.view.getDomRoot());
        type("te");
        expect(notes.state?.query).toBe("my note");
        expect(labels.show).not.toHaveBeenCalled();

        press(keyCodes.esc);
        expect(plugin.isListShown).toBe(false);
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

    it("closes once the focus leaves the editor, and not when it moves into the list", async () => {
        const inside = document.createElement("button");
        const outside = document.createElement("button");
        document.body.append(outside);

        editor.editing.view.focus();
        type("#al");
        labels.element?.append(inside);
        inside.focus();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(labels.state).not.toBe(null);

        editor.editing.view.focus();
        await vi.waitFor(() => expect(editor.ui.focusTracker.isFocused).toBe(true));
        // A tab of the tab row cancels its `pointerdown`, so the press fires no `mousedown`
        // and only moves the focus.
        outside.focus();
        await vi.waitFor(() => expect(labels.state).toBe(null));
        outside.remove();
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

    describe("following up on a mention", () => {
        const alpha = { id: "@alpha", text: "@alpha" };
        const beta = { id: "@beta", text: "@beta" };
        /** Inserts the mention of the last commit, in an editor whose feed inserts it later. */
        let insertLater: (() => void) | undefined;

        /** An editor whose `@` feed commits a mention as a chip, at once unless `isDeferred`. */
        async function createChipEditor({ isDeferred = false, canCommit }: ChipFeed = {}) {
            insertLater = undefined;
            await createEditor({
                "@": {
                    canCommit,
                    commit: (host, item) => {
                        const insert = createChipInsertion(host, item.id);
                        if (isDeferred) {
                            insertLater = insert;
                        } else {
                            insert();
                        }
                    }
                }
            }, [ Essentials, Paragraph, MentionEditing, TriliumMentionUI, Chips ]);
            setModelData(editor.model, "<paragraph>x []</paragraph>");
        }

        /** Commits `alpha` from the `@` list of a new editor, and follows up on its chip. */
        async function followUpOnAlpha() {
            await createChipEditor();
            type("@al");
            notes.state?.commitAndFollowUp(alpha);
        }

        function chips(): ModelElement[] {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) {
                return [];
            }
            return [ ...paragraph.getChildren() ].filter((node) => node.is("element", "chip"));
        }

        function chipElements() {
            const root = editor.editing.view.getDomRoot();
            return [ ...root?.querySelectorAll<HTMLElement>(".chip") ?? [] ];
        }

        const isMarked = (element: HTMLElement | undefined) =>
            element?.classList.contains("ck-mention-follow-up");
        const isFollowingUp = () => editor.model.markers.has("mentionFollowUp");

        it("keeps the list open on the mention it commits, for the text typed after", async () => {
            await createChipEditor();
            type("@al");
            notes.state?.commitAndFollowUp(alpha);

            expect(text()).toBe("<paragraph>x <chip name=\"@alpha\"></chip></paragraph>");
            expect(notes.hide).not.toHaveBeenCalled();
            expect(notes.state).toMatchObject({ query: "", followUpOf: alpha });
            expect(isFollowingUp()).toBe(true);
            // The editing view marks the mention, and the list is placed against it.
            const [ chip ] = chipElements();
            expect(isMarked(chip)).toBe(true);
            const chipRect = chip.getBoundingClientRect();
            const listRect = notes.state?.caretRect();
            expect(chipRect.width).toBeGreaterThan(0);
            expect([ listRect?.left, listRect?.top, listRect?.width ])
                .toEqual([ chipRect.left, chipRect.top, chipRect.width ]);

            type("in");
            expect(notes.state).toMatchObject({ query: "in", followUpOf: alpha });
            // A marker or a space in that text is part of the query.
            type(" #x");
            expect(notes.state?.query).toBe("in #x");
            expect(labels.show).not.toHaveBeenCalled();
            expect(notes.hide).not.toHaveBeenCalled();
            // The mark is no part of the data.
            expect(editor.getData()).toContain("<span class=\"chip\">");

            // A commit replaces the mention and the text typed after it.
            notes.state?.commit(beta);
            expect(text()).toBe("<paragraph>x <chip name=\"@beta\"></chip></paragraph>");
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
            expect(isMarked(chipElements()[0])).toBe(false);
        });

        it("waits for a mention that is inserted later, and takes no pick meanwhile", async () => {
            // An element after the caret, such as a line break, or a mention there already, is
            // not the mention awaited.
            for (const after of [ "<softBreak></softBreak>", "<chip name=\"@old\"></chip>" ]) {
                await createChipEditor({ isDeferred: true });
                setModelData(editor.model, `<paragraph>x []${after}y</paragraph>`);
                type("@al");
                const stage = notes.state;
                notes.state?.commitAndFollowUp(alpha);

                expect(text()).toBe(`<paragraph>x ${after}y</paragraph>`);
                expect(notes.state).toBe(stage);
                expect(notes.hide).not.toHaveBeenCalled();
                // The list stays where the marker was.
                expect(stage?.caretRect().height).toBeGreaterThan(0);
                notes.state?.commit(beta);
                notes.state?.commitAndFollowUp(beta);
                expect(text()).toBe(`<paragraph>x ${after}y</paragraph>`);

                insertLater?.();
                expect(text()).toBe(`<paragraph>x <chip name="@alpha"></chip>${after}y</paragraph>`);
                expect(notes.state).toMatchObject({ query: "", followUpOf: alpha });
                expect(chipElements().map(isMarked)).toEqual(
                    after.startsWith("<chip") ? [ true, false ] : [ true ]
                );
                expect(notes.hide).not.toHaveBeenCalled();
            }
        });

        it("closes on a dismissal before the mention is in, which still arrives", async () => {
            await createChipEditor({ isDeferred: true });
            type("@al");
            notes.state?.commitAndFollowUp(alpha);
            notes.state?.dismiss();
            expect(notes.state).toBe(null);

            insertLater?.();
            expect(text()).toBe("<paragraph>x <chip name=\"@alpha\"></chip></paragraph>");
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
        });

        it("ends on a space right after the mention, a caret move or its removal", async () => {
            await followUpOnAlpha();
            type(" ");
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
            expect(isMarked(chipElements()[0])).toBe(false);
            expect(text()).toBe("<paragraph>x <chip name=\"@alpha\"></chip> </paragraph>");
            // The text typed on is no query.
            type("in");
            expect(notes.state).toBe(null);

            // Inside the text typed after the mention, then before the mention.
            for (const offset of [ 4, 1 ]) {
                await followUpOnAlpha();
                type("in");
                moveCaretTo(offset);
                expect(notes.state).toBe(null);
                expect(isFollowingUp()).toBe(false);
            }

            await followUpOnAlpha();
            editor.model.change((writer) => writer.remove(chips()[0]));
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
        });

        it("ends on Backspace right after the mention, which stays", async () => {
            await followUpOnAlpha();
            notes.handleKeyDown.mockClear();
            expect(press(keyCodes.backspace).consumed).toBe(true);
            expect(notes.handleKeyDown).not.toHaveBeenCalled();
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
            expect(chips()).toHaveLength(1);

            // After text typed there, the key goes to the list as any other.
            await followUpOnAlpha();
            type("i");
            notes.handleKeyDown.mockReturnValue(false);
            const backspace = press(keyCodes.backspace);
            expect(backspace.consumed).toBe(false);
            expect(notes.handleKeyDown).toHaveBeenCalledExactlyOnceWith(backspace.domEvent);
            expect(notes.state).not.toBe(null);
        });

        it("closes on Escape or a dismissal, which holds back no marker typed later", async () => {
            await createChipEditor();
            // The text before the mention reads as a query of `@` at any caret in it.
            setModelData(editor.model, "<paragraph>@a []</paragraph>");
            type("@al");
            notes.state?.commitAndFollowUp(alpha);
            expect(press(keyCodes.esc).consumed).toBe(true);
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
            expect(chips()).toHaveLength(1);

            // A marker typed where the mention starts opens its list.
            moveCaretTo(3);
            type("@");
            expect(notes.state).toMatchObject({ query: "", followUpOf: null });

            await followUpOnAlpha();
            const followUp = notes.state;
            followUp?.dismiss();
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
            expect(chips()).toHaveLength(1);

            // A list that has closed dismisses no other list.
            type(" #al");
            followUp?.dismiss();
            expect(labels.state?.query).toBe("al");
        });

        it("opens the list of a marker typed while the mention is awaited", async () => {
            await createChipEditor({ isDeferred: true });
            type("@al");
            notes.state?.commitAndFollowUp(alpha);
            type("@be");
            expect(notes.state).toMatchObject({ query: "be", followUpOf: null });

            insertLater?.();
            expect(text()).toBe("<paragraph>x <chip name=\"@alpha\"></chip>@be</paragraph>");
            expect(notes.state).toMatchObject({ query: "be", followUpOf: null });
            expect(isFollowingUp()).toBe(false);
        });

        it("closes for an item that cannot be committed or a mention that is text", async () => {
            await createChipEditor({ canCommit: () => false });
            type("@al");
            notes.state?.commitAndFollowUp(alpha);
            expect(notes.state).toBe(null);
            expect(text()).toBe("<paragraph>x @al</paragraph>");

            // The `mention` command inserts the mention as text.
            await createEditor();
            type("@al");
            notes.state?.commitAndFollowUp(alpha);
            expect(text()).toContain(">@alpha</$text>");
            expect(notes.state).toBe(null);
        });

        it("follows up on the mention that replaces the one it followed up on", async () => {
            await followUpOnAlpha();
            type("in");
            notes.state?.commitAndFollowUp(beta);

            expect(text()).toBe("<paragraph>x <chip name=\"@beta\"></chip></paragraph>");
            expect(notes.state).toMatchObject({ query: "", followUpOf: beta });
            expect(chipElements().map(isMarked)).toEqual([ true ]);
        });

        it("places the list at the caret once the mention was undone away", async () => {
            await followUpOnAlpha();
            const caretRect = notes.state?.caretRect;
            editor.execute("undo");

            expect(chips()).toHaveLength(0);
            expect(caretRect?.().height).toBeGreaterThan(0);
        });

        it("ends once the editor is read-only, and with the editor", async () => {
            await followUpOnAlpha();
            editor.enableReadOnlyMode("test");
            expect(notes.state).toBe(null);
            expect(isFollowingUp()).toBe(false);
            editor.disableReadOnlyMode("test");

            await followUpOnAlpha();
            await editor.destroy();
            expect(notes.destroy).toHaveBeenCalledOnce();
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

/** How the `@` feed of a chip editor commits: at once, or later for `isDeferred`. */
type ChipFeed = Pick<MentionHostedFeed, "canCommit"> & { isDeferred?: boolean };

/** An inline object named `chip`, which a feed's `commit` inserts as its mention. */
class Chips extends Plugin {
    static get requires() {
        return [ Widget ] as const;
    }

    init() {
        const { conversion, model } = this.editor;

        model.schema.register("chip", {
            inheritAllFrom: "$inlineObject",
            allowAttributes: [ "name" ]
        });
        conversion.for("dataDowncast").elementToElement({
            model: "chip",
            view: { name: "span", classes: "chip" }
        });
        conversion.for("editingDowncast").elementToElement({
            model: "chip",
            view: (chip, { writer }) => {
                const name = writer.createUIElement("span", {}, function (domDocument) {
                    const element = this.toDomElement(domDocument);
                    element.textContent = String(chip.getAttribute("name"));
                    return element;
                });
                // Padded, so the chip is wider than the text in it.
                const attributes = { class: "chip", style: "padding: 0 7px" };
                const view = writer.createContainerElement("span", attributes, [ name ]);
                return toWidget(view, writer);
            }
        });
    }
}

/**
 * Returns a function that inserts a chip named `name` where the caret is now, and moves the
 * caret after it only if the caret is still there, as the `referenceLink` command does once the
 * title of its note is loaded.
 */
function createChipInsertion(editor: Editor, name: string) {
    const model = editor.model;
    const caret = model.document.selection.getFirstPosition();
    if (!caret) {
        throw new Error("The selection has no position.");
    }
    const position = ModelLivePosition.fromPosition(caret, "toPrevious");

    return () => {
        const isCaretThere = !!model.document.selection.getFirstPosition()?.isEqual(position);
        model.change((writer) => {
            const chip = writer.createElement("chip", { name });
            model.insertContent(chip, position);
            if (isCaretThere) {
                writer.setSelection(chip, "after");
            }
        });
        position.detach();
    };
}

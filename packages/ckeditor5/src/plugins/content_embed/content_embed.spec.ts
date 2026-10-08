import {
    _getModelData as getModelData,
    _getViewData as getViewData,
    _setModelData as setModelData,
    Bold,
    ButtonView,
    ClassicEditor,
    Essentials,
    ImageBlock,
    ImageCaption,
    LinkEditing,
    Paragraph,
    SwitchButtonView,
    Undo,
    Widget,
    type ModelElement
} from "ckeditor5";
import bxEditAlt from "boxicons/svg/regular/bx-edit-alt.svg?raw";
import bxWindowAlt from "boxicons/svg/regular/bx-window-alt.svg?raw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import LinkEmbed from "../link_embed/link_embed.js";
import ReferenceLink from "../referencelink.js";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME,
    BOX_SIZES,
    COMMAND_NAME,
    CONVERT_EMBED_TO_LINK_COMMAND,
    CONVERT_LINK_TO_EMBED_COMMAND,
    CONTENT_EMBED_MENU,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_EDITABLE_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";

describe("ContentEmbed", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;
    let loadEmbeddedNote: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        loadEmbeddedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ triggerCommand, loadEmbeddedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, ContentEmbed]);
    });

    // -----------------------------------------------------------------------
    // Plugin / schema registration
    // -----------------------------------------------------------------------

    it("loads the plugin, sub-plugins, schema, commands and the toolbar button", () => {
        expect(editor.plugins.get(ContentEmbed)).toBeInstanceOf(ContentEmbed);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.commands.get(BOX_SIZE_COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("contentEmbed")).toBe(true);

        const schema = editor.model.schema;
        expect(schema.isRegistered("contentEmbed")).toBe(true);
        expect(schema.isObject("contentEmbed")).toBe(true);
        expect(schema.isBlock("contentEmbed")).toBe(true);
        expect(schema.checkAttribute(["$root", "contentEmbed"], "noteId")).toBe(true);
        expect(schema.checkAttribute(["$root", "contentEmbed"], "boxSize")).toBe(true);
    });

    it("is one of the selected blocks when selected", () => {
        setModelData(editor.model, "[<contentEmbed noteId=\"n1\"></contentEmbed>]");
        const blocks = Array.from(editor.model.document.selection.getSelectedBlocks());
        expect(blocks.map((block) => block.name)).toStrictEqual([ "contentEmbed" ]);
    });

    // -----------------------------------------------------------------------
    // UI button
    // -----------------------------------------------------------------------

    it("wires the toolbar button to the insert command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("contentEmbed") as {
            isEnabled: boolean;
            isOn: boolean;
            label: string;
            fire(name: string): void;
        };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.label).toBe("Include note");
        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    // -----------------------------------------------------------------------
    // Conversion: upcast / data downcast / editing downcast
    // -----------------------------------------------------------------------

    it("loads a <figure> embed and a legacy <section>, and saves a <figure>", () => {
        for (const tag of [ "figure", "section" ]) {
            editor.setData(`<${tag} class="include-note" data-note-id="abc123"`
                + ` data-box-size="medium"></${tag}>`);

            const element = findContentEmbed(editor);
            expect(element?.getAttribute("noteId")).toBe("abc123");
            expect(element?.getAttribute("boxSize")).toBe("medium");
            expect(editor.getData()).toBe("<figure class=\"include-note\" data-note-id=\"abc123\" "
                + "data-box-size=\"medium\">&nbsp;</figure>");
        }
    });

    it("editing-downcasts to a widget and invokes loadEmbeddedNote when the UIElement renders", () => {
        editor.setData(
            '<figure class="include-note" data-note-id="noteY" data-box-size="small"></figure>'
        );

        const view = getViewData(editor.editing.view);
        expect(view).toContain("include-note");
        expect(view).toContain("ck-widget");
        // The block widget carries CKEditor's selection handle so it can be dragged atomically.
        expect(view).toContain("ck-widget_with-selection-handle");
        expect(view).toContain("box-size-small");

        // Querying the DOM root forces the UIElement render callback to run.
        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();

        expect(loadEmbeddedNote).toHaveBeenCalledTimes(1);
        expect(loadEmbeddedNote.mock.calls[0]?.[0]).toBe("noteY");
        // The box size is passed explicitly so the client render does not have to read it back
        // from the DOM (which may not be flushed yet at conversion time).
        expect(loadEmbeddedNote.mock.calls[0]?.[2]).toBe("small");
    });

    it("updates the box-size class on the editing view when the boxSize attribute changes", () => {
        insertContentEmbed(editor, "noteZ", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const figure = domRoot?.querySelector("figure.include-note");
        expect(figure?.classList.contains("box-size-small")).toBe(true);

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });

        expect(figure?.classList.contains("box-size-small")).toBe(false);
        expect(figure?.classList.contains("box-size-full")).toBe(true);
        expect(figure?.getAttribute("data-box-size")).toBe("full");
    });

    it("re-renders the embedded note content with the new size on a genuine box-size change", () => {
        insertContentEmbed(editor, "noteReload", "small");

        // One call for the initial render.
        expect(loadEmbeddedNote).toHaveBeenCalledTimes(1);
        expect(loadEmbeddedNote.mock.calls[0]?.[2]).toBe("small");

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "expandable" });

        // The downcast handler drives a second render with the new size, without any DOM observer.
        expect(loadEmbeddedNote).toHaveBeenCalledTimes(2);
        const reloadCall = loadEmbeddedNote.mock.calls[1];
        expect(reloadCall?.[0]).toBe("noteReload");
        expect(reloadCall?.[2]).toBe("expandable");
    });

    it("handles a boxSize change from an empty old value (no class to remove)", () => {
        // Insert an contentEmbed whose boxSize is empty so the attribute-change converter
        // hits the falsy `oldBoxSize` branch when the value is set for the first time.
        const element = insertContentEmbed(editor, "noteW", "");

        editor.model.change((writer) => {
            writer.setAttribute("boxSize", "medium", element);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const figure = domRoot?.querySelector("figure.include-note");
        expect(figure?.classList.contains("box-size-medium")).toBe(true);
        expect(figure?.getAttribute("data-box-size")).toBe("medium");
    });

    it("ignores a boxSize change cleared to an empty value (no new class to add)", () => {
        const element = insertContentEmbed(editor, "noteV", "small");

        editor.model.change((writer) => {
            writer.setAttribute("boxSize", "", element);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const figure = domRoot?.querySelector("figure.include-note");
        // Old class removed, no new class added because the new value is empty.
        expect(figure?.classList.contains("box-size-small")).toBe(false);
        expect(figure?.classList.contains("box-size-")).toBe(false);
    });

    // -----------------------------------------------------------------------
    // InsertContentEmbedCommand
    // -----------------------------------------------------------------------

    it("triggers addIncludeNoteToText on the Trilium component when the insert command executes", () => {
        editor.execute(COMMAND_NAME);
        expect(triggerCommand).toHaveBeenCalledWith("addIncludeNoteToText");
    });

    it("enables the insert command in a paragraph and disables it where blocks are disallowed", () => {
        const command = editor.commands.get(COMMAND_NAME);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        // Forbid contentEmbed anywhere via a child check, then refresh: no allowed parent
        // for the current selection means the command disables itself.
        editor.model.schema.addChildCheck((_context, def) => {
            if (def.name === "contentEmbed") {
                return false;
            }
        });
        command?.refresh();
        expect(command?.isEnabled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // ContentEmbedBoxSizeCommand
    // -----------------------------------------------------------------------

    it("box-size command is disabled with no embed selected and reports a null value", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();
    });

    it("box-size command enables and reflects the value when an contentEmbed is selected", () => {
        insertContentEmbed(editor, "noteSel", "medium");

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("medium");

        // Execute through every defined box size to cover the model write path.
        for (const value of BOX_SIZES) {
            editor.execute(BOX_SIZE_COMMAND_NAME, { value });
            expect(command.value).toBe(value);
            expect(findContentEmbed(editor)?.getAttribute("boxSize")).toBe(value);
        }
    });

    it("box-size command resolves the contentEmbed via an ancestor position (not a direct selection)", () => {
        // Make the contentEmbed allow text inside so the selection can be placed within it
        // (a collapsed position) rather than selecting the element itself.
        editor.model.schema.extend("$text", { allowIn: "contentEmbed" });

        const element = insertContentEmbed(editor, "noteAnc", "expandable");
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(element, 0));
        });

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("expandable");
    });

    it("box-size command execute is a no-op when nothing is selected", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The decorated Command.execute short-circuits while the command is disabled, so to
        // run our execute() body with no contentEmbed selected we force it enabled first. This
        // exercises the falsy `if (embedElement)` branch.
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            execute(options: { value: string }): void;
        };
        command.isEnabled = true;
        command.execute({ value: "full" });

        expect(editor.getData()).toBe(before);
    });

    it("toggles neither a caption nor a title when nothing is selected", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = getModelData(editor.model);

        // The decorated `Command#execute()` skips a disabled command, so each command is forced
        // enabled to run `execute()` with no embed selected.
        for (const name of [ TOGGLE_CAPTION_COMMAND_NAME, TOGGLE_TITLE_COMMAND_NAME ]) {
            const command = editor.commands.get(name) as { isEnabled: boolean; execute(): void };
            command.isEnabled = true;
            command.execute();
        }

        expect(getModelData(editor.model)).toBe(before);
    });

    // -----------------------------------------------------------------------
    // preventCKEditorHandling / selectContentEmbedWidget (DOM event handlers)
    // -----------------------------------------------------------------------

    it("selects the widget and suppresses editor handling on a mousedown inside the wrapper", () => {
        insertContentEmbed(editor, "noteEvt", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(evt, "stopPropagation");
        wrapper.dispatchEvent(evt);
        expect(stopSpy).toHaveBeenCalled();

        // The widget should now be selected (the mousedown handler selects it).
        const selected = editor.model.document.selection.getSelectedElement();
        expect(selected?.name).toBe("contentEmbed");
    });

    describe("renderer focus after a press in the widget", () => {
        /** Presses the embed of a focused editor, which turns `_renderer.isFocused` off. */
        function pressWidgetOfFocusedEditor() {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>"
                + "<contentEmbed noteId=\"noteFocus\" boxSize=\"small\"></contentEmbed>"
                + "<paragraph>bar</paragraph>");
            // A headless page cannot take the real focus, so set the flag the renderer reads.
            editor.editing.view.document.isFocused = true;
            pressWidget();
        }

        function pressWidget() {
            const wrapper = getDomRoot(editor).querySelector("div.include-note-wrapper");
            if (!wrapper) {
                throw new Error("The embed was not rendered.");
            }
            wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            expect(editor.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");
            expect(rendererIsFocused(editor)).toBe(false);
        }

        it("turns the renderer's focus back on for a press in the text, not in the widget", () => {
            pressWidgetOfFocusedEditor();
            const wrapper = getDomRoot(editor).querySelector("div.include-note-wrapper");
            wrapper?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
            expect(rendererIsFocused(editor)).toBe(false);

            const paragraph = getDomRoot(editor).children[2];
            paragraph.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            expect(rendererIsFocused(editor)).toBe(true);

            pressWidget();
        });

        it("turns the renderer's focus back on for the key that deletes the widget", () => {
            pressWidgetOfFocusedEditor();

            const domRoot = getDomRoot(editor);
            domRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
            expect(rendererIsFocused(editor)).toBe(true);
            editor.execute("delete");
            expect(getModelData(editor.model)).toBe(
                "<paragraph>foo</paragraph><paragraph>[]</paragraph><paragraph>bar</paragraph>");
            // The DOM selection follows the model selection into the new empty paragraph.
            const domSelection = window.getSelection();
            expect(domRoot.children[1].contains(domSelection?.anchorNode ?? null)).toBe(true);
        });

        it("keeps the renderer's focus off for a press on a link preview", async () => {
            installGlobMock({
                getComponentByEl: () => ({
                    triggerCommand,
                    loadEmbeddedNote,
                    renderLinkMention: vi.fn(),
                    detectEmbedType: vi.fn(() => "opengraph")
                })
            });
            const linkEditor = await createTestEditor([
                Essentials, Paragraph, Widget, ContentEmbed, LinkEmbed
            ]);
            setModelData(linkEditor.model, "<paragraph>foo[]"
                + "<linkMention url=\"https://e.com/\" embedType=\"opengraph\"></linkMention>"
                + "</paragraph>");
            linkEditor.editing.view.document.isFocused = true;

            const mention = getDomRoot(linkEditor).querySelector(".link-mention-inner");
            if (!mention) {
                throw new Error("The link mention was not rendered.");
            }
            mention.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

            const selected = linkEditor.model.document.selection.getSelectedElement();
            expect(selected?.name).toBe("linkMention");
            expect(rendererIsFocused(linkEditor)).toBe(false);
        });

        function getDomRoot(target: ClassicEditor) {
            const domRoot = target.editing.view.getDomRoot();
            if (!domRoot) {
                throw new Error("The editor has no DOM root.");
            }
            return domRoot;
        }

        function rendererIsFocused(target: ClassicEditor) {
            //@ts-expect-error: The renderer is a private field.
            return target.editing.view._renderer.isFocused as boolean;
        }
    });

    it("suppresses the native caret on a non-interactive mousedown but not on interactive targets", () => {
        insertContentEmbed(editor, "noteCaret", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Clicking a plain (non-interactive) area should preventDefault so the browser does not
        // drop a caret next to the contenteditable=false widget.
        const plainEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const plainPrevent = vi.spyOn(plainEvt, "preventDefault");
        wrapper.dispatchEvent(plainEvt);
        expect(plainPrevent).toHaveBeenCalled();

        // Clicking a link must keep native behaviour: the handler steps aside entirely, so neither
        // preventDefault nor stopPropagation is called.
        const innerLink = document.createElement("a");
        innerLink.href = "#root/abc";
        wrapper.appendChild(innerLink);

        const linkEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const linkPrevent = vi.spyOn(linkEvt, "preventDefault");
        const linkStop = vi.spyOn(linkEvt, "stopPropagation");
        innerLink.dispatchEvent(linkEvt);
        expect(linkPrevent).not.toHaveBeenCalled();
        expect(linkStop).not.toHaveBeenCalled();
    });

    it("selects the widget on a press on a title row button, and keeps the focus in the editor", () => {
        const embed = insertContentEmbed(editor, "noteButton", "small");
        editor.model.change((writer) => {
            const paragraph = embed.nextSibling;
            if (!paragraph) {
                throw new Error("Expected a paragraph after the embed.");
            }
            writer.setSelection(paragraph, 0);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!domRoot || !wrapper) {
            return;
        }
        wrapper.innerHTML = `<div class="include-note-title-row"><button><span></span></button></div>`
            + `<div class="include-note-content"><button></button></div>`;
        const [ titleRowButton, contentButton ] = wrapper.querySelectorAll("button");

        // A button of the rendered content keeps its native handling.
        const contentEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        contentButton.dispatchEvent(contentEvt);
        expect(contentEvt.defaultPrevented).toBe(false);
        expect(editor.model.document.selection.getSelectedElement()).toBeNull();

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const stop = vi.spyOn(evt, "stopPropagation");
        titleRowButton.querySelector("span")?.dispatchEvent(evt);

        expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
        expect(document.activeElement).toBe(domRoot);
        // No focus for the button itself; its click still runs.
        expect(evt.defaultPrevented).toBe(true);
        expect(stop).not.toHaveBeenCalled();
    });

    it("leaves a mousedown in the content alone, and selects the widget on the backdrop", () => {
        const embed = insertContentEmbed(editor, "noteBackdrop", "small");
        editor.model.change((writer) => {
            const paragraph = embed.nextSibling;
            if (!paragraph) {
                throw new Error("Expected a paragraph after the embed.");
            }
            writer.setSelection(paragraph, 0);
        });

        const wrapper = editor.editing.view.getDomRoot()?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }
        wrapper.innerHTML = `<div class="include-note-body">`
            + `<div class="include-note-content"><p>text</p></div>`
            + `<div class="include-note-backdrop"></div></div>`;
        const text = wrapper.querySelector(".include-note-content p");
        const backdrop = wrapper.querySelector(".include-note-backdrop");

        const textEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const textStop = vi.spyOn(textEvt, "stopPropagation");
        text?.dispatchEvent(textEvt);
        expect(textEvt.defaultPrevented).toBe(false);
        expect(textStop).not.toHaveBeenCalled();
        expect(editor.model.document.selection.getSelectedElement()).toBeNull();

        const backdropEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        backdrop?.dispatchEvent(backdropEvt);
        expect(backdropEvt.defaultPrevented).toBe(true);
        expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
    });

    it("selects the widget when its content takes the focus, which stays there", () => {
        const embed = insertContentEmbed(editor, "noteFocus", "small");
        editor.model.change((writer) => {
            const paragraph = embed.nextSibling;
            if (!paragraph) {
                throw new Error("Expected a paragraph after the embed.");
            }
            writer.setSelection(paragraph, 0);
        });

        const wrapper = editor.editing.view.getDomRoot()?.querySelector("div.include-note-wrapper");
        if (!wrapper) {
            throw new Error("Expected the wrapper of the embed.");
        }
        wrapper.innerHTML = `<div class="include-note-body">`
            + `<div class="include-note-content" tabindex="-1"><button>Draw</button></div></div>`;
        const content = wrapper.querySelector<HTMLElement>(".include-note-content");
        const button = wrapper.querySelector<HTMLElement>("button");
        const viewFocus = vi.spyOn(editor.editing.view, "focus");

        content?.focus();
        expect(document.activeElement).toBe(content);
        expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
        expect(viewFocus).not.toHaveBeenCalled();

        const change = vi.spyOn(editor.model, "enqueueChange");
        // The content hears its own focus, as the editor of an included note must.
        const heard = vi.fn();
        button?.addEventListener("focus", heard);
        button?.focus();
        expect(document.activeElement).toBe(button);
        expect(heard).toHaveBeenCalledOnce();
        expect(change).not.toHaveBeenCalled();
    });

    it("leaves a mousedown inside an embedded collection untouched so the live widget keeps working", () => {
        insertContentEmbed(editor, "noteColl", "full");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Simulate the embedded collection markup (e.g. a geo-map marker lives under .rendered-collection).
        const collection = document.createElement("div");
        collection.className = "rendered-collection";
        const marker = document.createElement("div");
        collection.appendChild(marker);
        wrapper.appendChild(collection);

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const prevent = vi.spyOn(evt, "preventDefault");
        const stop = vi.spyOn(evt, "stopPropagation");
        marker.dispatchEvent(evt);

        // The handler must step aside completely so Leaflet (and other live widgets) get the event.
        expect(prevent).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
    });

    it("treats a mousedown whose target is not an Element (e.g. a text node) as non-interactive", () => {
        insertContentEmbed(editor, "noteText", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // A capture-phase mousedown on a bare text node makes evt.target a Text, not an Element. The
        // interactive-target guard must short-circuit and report "not interactive", so the widget's
        // normal suppression (preventDefault + stopPropagation) still runs.
        const textNode = document.createTextNode("plain text");
        wrapper.appendChild(textNode);

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const prevent = vi.spyOn(evt, "preventDefault");
        const stop = vi.spyOn(evt, "stopPropagation");
        textNode.dispatchEvent(evt);

        expect(prevent).toHaveBeenCalled();
        expect(stop).toHaveBeenCalled();
    });

    it("stops propagation on focus and keydown inside the wrapper", () => {
        insertContentEmbed(editor, "noteKbd", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        const focusEvt = new FocusEvent("focus");
        const focusStop = vi.spyOn(focusEvt, "stopPropagation");
        wrapper.dispatchEvent(focusEvt);
        expect(focusStop).toHaveBeenCalled();

        const keyEvt = new KeyboardEvent("keydown", { bubbles: true });
        const keyStop = vi.spyOn(keyEvt, "stopPropagation");
        wrapper.dispatchEvent(keyEvt);
        expect(keyStop).toHaveBeenCalled();
    });

    it("lets the embedded content handle a key, then keeps it from the editor", () => {
        insertContentEmbed(editor, "noteKeys", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!domRoot || !wrapper) {
            return;
        }

        const content = document.createElement("div");
        wrapper.append(content);
        const contentHeard = vi.fn();
        const rootHeard = vi.fn();
        content.addEventListener("keydown", contentHeard);
        domRoot.addEventListener("keydown", rootHeard);

        content.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));

        expect(contentHeard).toHaveBeenCalledOnce();
        expect(rootHeard).not.toHaveBeenCalled();
        domRoot.removeEventListener("keydown", rootHeard);
    });

    it("does nothing on a mousedown when the wrapper has no enclosing embed", () => {
        insertContentEmbed(editor, "noteDetached", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Detach the wrapper (which carries the capture-phase mousedown handler) from its
        // embed so that domElement.closest(".include-note") returns null. The handler
        // still fires because it is bound to the wrapper element itself.
        const holder = document.createElement("div");
        document.body.appendChild(holder);
        holder.appendChild(wrapper);

        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        holder.remove();
        // The early return means no selection change beyond the original insert selection.
        expect(true).toBe(true);
    });

    it("does nothing on a mousedown when the embed is not mapped to a view element", () => {
        insertContentEmbed(editor, "noteUnmapped", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Move the wrapper into a hand-built figure.include-note that the editor's
        // DomConverter knows nothing about. closest() then finds this fake embed, but
        // mapDomToView() returns nothing for it, so selectContentEmbedWidget returns early.
        const fakeFigure = document.createElement("figure");
        fakeFigure.className = "include-note";
        document.body.appendChild(fakeFigure);
        fakeFigure.appendChild(wrapper);

        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        fakeFigure.remove();
        expect(true).toBe(true);
    });

    it("does nothing on a mousedown when the embed's view maps to no model element", () => {
        insertContentEmbed(editor, "noteNoModel", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        const figure = domRoot?.querySelector<HTMLElement>("figure.include-note");
        expect(wrapper).not.toBeNull();
        expect(figure).not.toBeNull();
        if (!wrapper || !figure) {
            return;
        }

        // The DOM->view mapping stays intact (mapDomToView succeeds), but we break the
        // view->model mapping so selectContentEmbedWidget returns at the !modelElement guard.
        const viewElement = editor.editing.view.domConverter.mapDomToView(figure);
        expect(viewElement).toBeDefined();
        if (viewElement && viewElement.is("element")) {
            editor.editing.mapper.unbindViewElement(viewElement);
        }

        expect(() => {
            wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();
    });

    it("selects the embed that a DOM element is part of, for a context menu opened on it", () => {
        editor.setData("<p>foo</p>"
            + "<figure class=\"include-note\" data-note-id=\"noteMenu\" data-box-size=\"small\">"
            + "</figure>");
        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        const paragraph = domRoot?.querySelector("p");
        if (!wrapper || !paragraph) {
            throw new Error("Expected a rendered embed and paragraph.");
        }
        const title = document.createElement("h4");
        wrapper.append(title);
        const plugin = editor.plugins.get("ContentEmbed");

        expect(plugin.selectEmbedAt(paragraph)).toBe(false);
        expect(editor.model.document.selection.getSelectedElement()).toBeNull();

        expect(plugin.selectEmbedAt(title)).toBe(true);
        expect(editor.model.document.selection.getSelectedElement()?.getAttribute("noteId"))
            .toBe("noteMenu");
    });

    it("falls back gracefully in the button factory when the insert command is absent", () => {
        // Exercise the falsy `if (command)` branch in ContentEmbedUI: when the command lookup
        // returns undefined, the button must still be created (just without the binding).
        const realGet = editor.commands.get.bind(editor.commands);
        const absent: string[] = [
            COMMAND_NAME, CONVERT_EMBED_TO_LINK_COMMAND, TOGGLE_CAPTION_COMMAND_NAME,
            TOGGLE_TITLE_COMMAND_NAME, TOGGLE_EDITABLE_COMMAND_NAME
        ];
        const getSpy = vi
            .spyOn(editor.commands, "get")
            .mockImplementation((name) => (absent.includes(name) ? undefined : realGet(name)));

        try {
            const view = editor.ui.componentFactory.create("contentEmbed") as unknown as { label: string };
            expect(view.label).toBe("Include note");
            const convert = editor.ui.componentFactory.create(CONVERT_EMBED_TO_LINK_COMMAND);
            expect((convert as unknown as { label: string }).label).toBe("Convert to link");
            const caption = editor.ui.componentFactory.create(TOGGLE_CAPTION_COMMAND_NAME);
            expect((caption as unknown as { label: string }).label).toBe("Toggle caption on");
            const title = editor.ui.componentFactory.create(TOGGLE_TITLE_COMMAND_NAME);
            expect((title as unknown as { label: string }).label).toBe("Show title");
            const editable = editor.ui.componentFactory.create(TOGGLE_EDITABLE_COMMAND_NAME);
            expect((editable as unknown as { label: string }).label).toBe("Editable");
            const menu = editor.ui.componentFactory.create(CONTENT_EMBED_MENU);
            expect((menu as unknown as { label: string }).label).toBe("More actions");
        } finally {
            getSpy.mockRestore();
        }
    });
});

describe("ContentEmbed with attachments", () => {
    const LINK_HREF = "#root/owner?viewMode=attachments&attachmentId=att1";
    const embedHtml = (attachmentId = "att1") =>
        `<figure class="include-note" data-attachment-id="${attachmentId}" data-box-size="small">`
        + "</figure>";
    let editor: ClassicEditor;
    let loadEmbeddedNote: ReturnType<typeof vi.fn>;
    let loadEmbeddedAttachment: ReturnType<typeof vi.fn>;
    let getAttachmentHref: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadEmbeddedNote = vi.fn();
        loadEmbeddedAttachment = vi.fn();
        getAttachmentHref = vi.fn(async () => LINK_HREF);
        installGlobMock({
            getComponentByEl: () => ({
                loadEmbeddedNote,
                loadEmbeddedAttachment,
                getAttachmentHref,
                loadReferenceLinkTitle: vi.fn(async () => undefined)
            }),
            getReferenceLinkTitleSync: () => "report.pdf"
        });

        editor = await createTestEditor([
            Essentials, Paragraph, Undo, Widget, LinkEditing, ReferenceLink, ContentEmbed
        ]);
    });

    /** Querying the DOM root forces the UIElement render callbacks to run. */
    function renderEmbeds() {
        return editor.editing.view.getDomRoot()?.querySelectorAll("div.include-note-wrapper");
    }

    function selectEmbed() {
        editor.model.change((writer) => {
            const element = findContentEmbed(editor);
            if (element) {
                writer.setSelection(element, "on");
            }
        });
    }

    it("stores, saves and renders an embed by its attachment", () => {
        editor.setData(embedHtml());

        const element = findContentEmbed(editor);
        expect(element?.getAttribute("attachmentId")).toBe("att1");
        expect(element?.hasAttribute("noteId")).toBe(false);
        expect(editor.getData()).toContain('data-attachment-id="att1"');
        expect(editor.getData()).not.toContain("data-note-id");

        expect(renderEmbeds()).toHaveLength(1);
        expect(loadEmbeddedNote).not.toHaveBeenCalled();
        expect(loadEmbeddedAttachment).toHaveBeenCalledTimes(1);
        expect(loadEmbeddedAttachment.mock.calls[0]?.[0]).toBe("att1");
        expect(loadEmbeddedAttachment.mock.calls[0]?.[2]).toBe("small");

        selectEmbed();
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(loadEmbeddedAttachment.mock.calls.at(-1)?.[2]).toBe("full");
    });

    it("shows an embed by its file name while it uploads, and saves it naming nothing", () => {
        setModelData(
            editor.model,
            "<contentEmbed boxSize=\"small\" uploadFileName=\"report.pdf\" uploadId=\"u1\">"
            + "</contentEmbed>"
        );

        const wrapper = renderEmbeds()?.[0];
        const title = wrapper?.querySelector(".include-note-title");
        expect(title?.textContent).toBe("report.pdf");
        expect(title?.querySelector(".bx.bx-loader-alt.bx-spin")).not.toBeNull();
        expect(loadEmbeddedAttachment).not.toHaveBeenCalled();
        expect(loadEmbeddedNote).not.toHaveBeenCalled();
        const data = editor.getData();
        expect(data).toContain("<figure class=\"include-note\" data-box-size=\"small\">");
        expect(data).not.toMatch(/data-(note|attachment)-id/);

        const element = findContentEmbed(editor);
        if (!element) {
            throw new Error("Expected the embed.");
        }

        // The two steps of `FileUploadEditing` once the upload ends.
        editor.model.change((writer) => writer.setAttribute("attachmentId", "att1", element));
        expect(wrapper?.querySelector(".include-note-title")?.textContent).toBe("report.pdf");
        expect(loadEmbeddedAttachment).not.toHaveBeenCalled();

        editor.model.change((writer) => writer.removeAttribute("uploadFileName", element));
        expect(renderEmbeds()?.[0]).toBe(wrapper);
        expect(wrapper?.querySelector(".include-note-title")).toBeNull();
        expect(wrapper?.parentElement?.getAttribute("data-attachment-id")).toBe("att1");
        expect(loadEmbeddedAttachment).toHaveBeenCalledTimes(1);
        expect(loadEmbeddedAttachment).toHaveBeenCalledWith("att1", expect.anything(), "small");
    });

    it("turns an attachment link into an embed in its place, as one undo step", () => {
        editor.setData(`<p>Before <a class="reference-link" href="${LINK_HREF}">x</a> after</p>`);
        const link = editor.editing.view.getDomRoot()?.querySelector("a.reference-link");

        editor.execute(CONVERT_LINK_TO_EMBED_COMMAND, { domElement: link, boxSize: "expandable" });

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph>Before </paragraph>" +
            "<contentEmbed attachmentId=\"att1\" boxSize=\"expandable\"></contentEmbed>" +
            "<paragraph> after</paragraph>"
        );

        editor.execute("undo");
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<paragraph>Before <reference href="${LINK_HREF}"></reference> after</paragraph>`
        );

        const relinked = editor.editing.view.getDomRoot()?.querySelector("a.reference-link");
        editor.execute(CONVERT_LINK_TO_EMBED_COMMAND, { domElement: relinked });
        expect(findContentEmbed(editor)?.getAttribute("boxSize")).toBe("medium");
    });

    it("turns a link to a note into an embed of the note, and leaves anything else alone", () => {
        const cardHref = "#root/boardAbc?card=cardAbc";
        editor.setData(
            `<p>Before <a class="reference-link" href="#root/parentAbc/noteAbc">x</a> after</p>`
            + `<p><a class="reference-link" href="${cardHref}">card</a></p>`
            + `<p><a class="reference-link" href="${LINK_HREF}">file</a></p>`
        );
        const before = getModelData(editor.model, { withoutSelection: true });
        const domRoot = editor.editing.view.getDomRoot();
        const [ link, cardLink, attachmentLink ] =
            domRoot?.querySelectorAll<HTMLElement>("a.reference-link") ?? [];
        const paragraph = domRoot?.querySelector("p");
        const detached = document.createElement("a");
        if (!link || !cardLink || !attachmentLink || !paragraph) {
            throw new Error("Expected the links and their paragraph.");
        }
        const plugin = editor.plugins.get(ContentEmbed);

        // A note link with a query names a part of the note, which an embed does not show.
        expect([ link, cardLink, attachmentLink, paragraph, detached ]
            .map((domElement) => plugin.canConvertLinkToEmbed(domElement)))
            .toEqual([ true, false, true, false, false ]);
        for (const domElement of [ cardLink, paragraph, detached ]) {
            editor.execute(CONVERT_LINK_TO_EMBED_COMMAND, { domElement });
        }
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(before);

        editor.execute(CONVERT_LINK_TO_EMBED_COMMAND, { domElement: link, boxSize: "full" });
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph>Before </paragraph>" +
            "<contentEmbed boxSize=\"full\" noteId=\"noteAbc\"></contentEmbed>" +
            "<paragraph> after</paragraph>" +
            `<paragraph><reference href="${cardHref}"></reference></paragraph>` +
            `<paragraph><reference href="${LINK_HREF}"></reference></paragraph>`
        );

        // A link in the content of an embed is not part of the note.
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        if (!wrapper) {
            throw new Error("Expected the wrapper of the embed.");
        }
        wrapper.innerHTML = `<a class="reference-link" href="#root/otherAbc">other</a>`;
        const embeddedLink = wrapper.querySelector("a");
        expect(embeddedLink && plugin.canConvertLinkToEmbed(embeddedLink)).toBe(false);
    });

    it("loads an embed that names nothing, as one saved mid-upload, as an empty box", () => {
        editor.setData("<figure class=\"include-note\" data-box-size=\"small\"></figure>");

        expect(renderEmbeds()).toHaveLength(1);
        expect(loadEmbeddedNote).not.toHaveBeenCalled();
        expect(loadEmbeddedAttachment).not.toHaveBeenCalled();
    });

    it("turns an embed of an attachment or a note into a link, and nothing else", async () => {
        const command = editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND);
        const button = editor.ui.componentFactory.create(CONVERT_EMBED_TO_LINK_COMMAND);
        if (!(button instanceof ButtonView)) {
            throw new Error("Expected a button.");
        }
        expect(button.label).toBe("Convert to link");

        editor.setData("<figure class=\"include-note\" data-box-size=\"small\"></figure>");
        selectEmbed();
        expect(command?.isEnabled).toBe(false);
        expect(button.isVisible).toBe(false);

        editor.setData(embedHtml());
        selectEmbed();
        expect(command?.isEnabled).toBe(true);
        expect(button.isVisible).toBe(true);

        button.fire("execute");

        expect(getAttachmentHref).toHaveBeenCalledWith("att1");
        await vi.waitFor(() => expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph><reference href="${LINK_HREF}"></reference></paragraph>`));

        editor.setData("<figure class=\"include-note\" data-note-id=\"noteX\""
            + " data-box-size=\"small\"></figure>");
        selectEmbed();
        expect(command?.isEnabled).toBe(true);
        button.fire("execute");

        await vi.waitFor(() => expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<paragraph><reference href=\"#root/noteX\"></reference></paragraph>"));
        expect(getAttachmentHref).toHaveBeenCalledOnce();
    });

    it("describes the embed an element is part of, without selecting it", () => {
        editor.setData(embedHtml()
            + "<figure class=\"include-note\" data-note-id=\"noteX\" data-box-size=\"medium\""
            + " data-hide-title=\"true\"><figcaption>Caption</figcaption></figure>"
            + "<figure class=\"include-note\" data-note-id=\"noteY\" data-box-size=\"tiny\""
            + " data-hide-title=\"true\"></figure>"
            + "<figure class=\"include-note\" data-note-id=\"noteZ\"></figure>"
            + "<p>after</p>");
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            const paragraph = root?.getChild(root.childCount - 1);
            if (paragraph) {
                writer.setSelection(paragraph, 0);
            }
        });
        const [ embed, note, tiny, unsized ] = renderEmbeds() ?? [];
        const plugin = editor.plugins.get("ContentEmbed");

        const states = [ embed, note, tiny, unsized ]
            .map((wrapper) => plugin.getEmbedStateAt(wrapper));
        const notEditable = { isEditable: false, isEditableToggleable: false };
        expect(states).toEqual([ {
            ...notEditable, boxSize: "small", isTitleShown: true, isTitleToggleable: true,
            hasCaption: false, isCaptionToggleable: true, isConvertibleToLink: true
        }, {
            ...notEditable, boxSize: "medium", isTitleShown: false, isTitleToggleable: true,
            hasCaption: true, isCaptionToggleable: true, isConvertibleToLink: true
        }, {
            ...notEditable, boxSize: "tiny", isTitleShown: true, isTitleToggleable: false,
            hasCaption: false, isCaptionToggleable: false, isConvertibleToLink: true
        }, {
            ...notEditable, boxSize: null, isTitleShown: true, isTitleToggleable: true,
            hasCaption: false, isCaptionToggleable: true, isConvertibleToLink: true
        } ]);
        const paragraph = editor.editing.view.getDomRoot()?.querySelector("p") ?? embed;
        expect(plugin.getEmbedStateAt(paragraph)).toBeNull();
        const position = editor.model.document.selection.getFirstPosition();
        expect(position?.parent.is("element", "paragraph")).toBe(true);

        expect(plugin.getBoxSizes()).toEqual([
            { value: "tiny", label: "Tiny" },
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "full", label: "Full" },
            { value: "expandable", label: "Expandable" }
        ]);
    });

    it("converts the embed that selectEmbedAt() selects from its title row", async () => {
        editor.setData("<p>before</p>" + embedHtml());
        const command = editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND);
        const wrapper = renderEmbeds()?.[0];
        if (!wrapper) {
            throw new Error("Expected a rendered embed.");
        }
        const titleRow = document.createElement("div");
        titleRow.className = "include-note-title-row";
        wrapper.append(titleRow);
        expect(command?.isEnabled).toBe(false);

        expect(editor.plugins.get("ContentEmbed").selectEmbedAt(titleRow)).toBe(true);
        expect(command?.isEnabled).toBe(true);

        await editor.execute(CONVERT_EMBED_TO_LINK_COMMAND);
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph>before</paragraph>"
            + `<paragraph><reference href="${LINK_HREF}"></reference></paragraph>`
        );
    });

    it("converts nothing when no embed is selected", async () => {
        editor.setData(embedHtml() + "<p>after</p>");
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The decorated `Command#execute()` skips a disabled command, so the command is forced
        // enabled to run `execute()` with no embed selected.
        const command = editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND) as {
            isEnabled: boolean;
            execute(): Promise<void>;
        };
        command.isEnabled = true;
        await command.execute();

        expect(getAttachmentHref).not.toHaveBeenCalled();
        expect(editor.getData()).toBe(before);
    });

    it("keeps an embed whose attachment has no link to go back to", async () => {
        getAttachmentHref.mockResolvedValue(null);
        editor.setData(embedHtml());
        selectEmbed();

        await editor.execute(CONVERT_EMBED_TO_LINK_COMMAND);

        expect(findContentEmbed(editor)?.getAttribute("attachmentId")).toBe("att1");
    });

    it("stores, saves and renders an embed of blocks, and points it at other blocks", async () => {
        const html = "<figure class=\"include-note\" data-note-id=\"noteAbc\" data-block=\"a1:b2\""
            + " data-box-size=\"small\">&nbsp;</figure>";
        editor.setData(html);
        renderEmbeds();

        expect(findContentEmbed(editor)?.getAttribute("block")).toBe("a1:b2");
        expect(editor.getData()).toBe(html);
        expect(loadEmbeddedNote).toHaveBeenLastCalledWith(
            "noteAbc", expect.anything(), "small", "a1:b2", expect.any(Function)
        );

        // The editor in the embed points it at other blocks, and keeps showing them.
        const setBlock = loadEmbeddedNote.mock.lastCall?.[4] as (block: string) => void;
        setBlock("c3");
        renderEmbeds();

        expect(loadEmbeddedNote).toHaveBeenCalledOnce();
        expect(editor.getData()).toBe(html.replace("a1:b2", "c3"));
        expect(editor.editing.view.getDomRoot()?.querySelector(".include-note")
            ?.getAttribute("data-block")).toBe("c3");
        expect(editor.commands.get("undo")?.isEnabled).toBe(false);

        editor.model.change((writer) => writer.setSelection(findContentEmbed(editor), "on"));
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });
        expect(loadEmbeddedNote).toHaveBeenLastCalledWith(
            "noteAbc", expect.anything(), "medium", "c3", expect.any(Function)
        );

        editor.setData("<p>Removed</p>");
        setBlock("d4");
        expect(editor.getData()).toBe("<p>Removed</p>");

        await editor.destroy();
        expect(() => setBlock("e5")).not.toThrow();
    });

    it("turns a link to blocks into an embed of them, and the embed back into a link", async () => {
        const blockHref = "#root/parentAbc/noteAbc?block=a1:b%202";
        editor.setData(
            `<p><a class="reference-link" href="${blockHref}">blocks</a></p>`
            + "<p><a class=\"reference-link\" href=\"#root/noteAbc?block=a1&card=c1\">mixed</a></p>"
            + "<p><a class=\"reference-link\" href=\"#root/noteAbc?block=a:b:c\">malformed</a></p>"
            + "<p><a class=\"reference-link\" href=\"#root/noteAbc?block=\">empty</a></p>"
            + "<p><a class=\"reference-link\" href=\"#\">no note</a></p>"
        );
        const links = editor.editing.view.getDomRoot()
            ?.querySelectorAll<HTMLElement>("a.reference-link") ?? [];
        const plugin = editor.plugins.get(ContentEmbed);

        expect([ ...links ].map((link) => plugin.canConvertLinkToEmbed(link)))
            .toEqual([ true, false, false, false, false ]);

        editor.execute(CONVERT_LINK_TO_EMBED_COMMAND, { domElement: links[0] });
        expect(findContentEmbed(editor)?.getAttribute("block")).toBe("a1:b 2");

        selectEmbed();
        editor.execute(CONVERT_EMBED_TO_LINK_COMMAND);
        await vi.waitFor(() => expect(editor.getData()).toContain(
            "<a class=\"reference-link\" href=\"#root/noteAbc?block=a1:b%202\">"
        ));
    });

    it("redraws the embeds of a changed attachment and removes those of a deleted one", () => {
        editor.setData(embedHtml("att1") + embedHtml("att2"));
        renderEmbeds();
        loadEmbeddedAttachment.mockClear();

        editor.plugins.get("ReferenceLinkEditing").updateAttachmentLinks([
            { attachmentId: "att1", isDeleted: false },
            { attachmentId: "att2", isDeleted: true }
        ]);
        renderEmbeds();

        const redrawn = loadEmbeddedAttachment.mock.calls.map(([ attachmentId ]) => attachmentId);
        expect(redrawn).toContain("att1");
        expect(redrawn).not.toContain("att2");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<contentEmbed attachmentId=\"att1\" boxSize=\"small\"></contentEmbed>");
    });
});

describe("ContentEmbed captions", () => {
    const CAPTIONED = "<figure class=\"include-note\" data-note-id=\"n1\" data-box-size=\"medium\">"
        + "<figcaption>A <strong>bold</strong> caption</figcaption></figure>";
    let editor: ClassicEditor;
    let loadEmbeddedNote: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadEmbeddedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote })
        });

        editor = await createTestEditor([
            Essentials, Paragraph, Bold, Undo, Widget, ContentEmbed
        ]);
    });

    function getCommand() {
        const command = editor.commands.get(TOGGLE_CAPTION_COMMAND_NAME);
        if (!command) {
            throw new Error("Expected the caption command.");
        }
        return command;
    }

    function selectEmbed() {
        editor.model.change((writer) => {
            const embed = findContentEmbed(editor);
            if (embed) {
                writer.setSelection(embed, "on");
            }
        });
    }

    /** The caption the editing view renders, after checking that it follows the content. */
    function getRenderedCaption() {
        const figcaption = editor.editing.view.getDomRoot()
            ?.querySelector("figure.include-note > figcaption");
        expect(figcaption?.previousElementSibling?.classList.contains("include-note-wrapper"))
            .toBe(true);
        return figcaption;
    }

    function isSelectionInCaption() {
        const position = editor.model.document.selection.getFirstPosition();
        return !!position?.parent.is("element", "caption");
    }

    it("loads and saves a formatted caption, and renders it editable after the content", () => {
        editor.setData(CAPTIONED);

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<contentEmbed boxSize=\"medium\" noteId=\"n1\">"
            + "<caption>A <$text bold=\"true\">bold</$text> caption</caption></contentEmbed>"
        );
        expect(editor.getData()).toBe(CAPTIONED);
        expect(getRenderedCaption()?.getAttribute("contenteditable")).toBe("true");
    });

    it("toggles a caption on after the content and off again, keeping its text", () => {
        insertContentEmbed(editor, "n1", "medium");
        const command = getCommand();
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe(false);

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true });
        expect(command.value).toBe(true);
        expect(isSelectionInCaption()).toBe(true);
        expect(getRenderedCaption()).not.toBeNull();

        editor.model.change((writer) => {
            const position = editor.model.document.selection.getFirstPosition();
            if (position) {
                writer.insertText("Caption", position);
            }
        });
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        expect(command.value).toBe(false);
        expect(editor.getData()).not.toContain("figcaption");
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        expect(editor.getData()).toContain("<figcaption>Caption</figcaption>");
        expect(isSelectionInCaption()).toBe(false);
    });

    it("keeps the rendered content while the caption is toggled and edited", () => {
        insertContentEmbed(editor, "n1", "medium");
        const wrapper = editor.editing.view.getDomRoot()?.querySelector(".include-note-wrapper");
        expect(wrapper).not.toBeNull();
        expect(loadEmbeddedNote).toHaveBeenCalledTimes(1);

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true });
        editor.model.change((writer) => {
            const position = editor.model.document.selection.getFirstPosition();
            if (position) {
                writer.insertText("Caption", position);
            }
        });
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);

        expect(getRenderedCaption()?.textContent).toBe("Caption");
        expect(editor.editing.view.getDomRoot()?.querySelector(".include-note-wrapper"))
            .toBe(wrapper);
        expect(loadEmbeddedNote).toHaveBeenCalledTimes(1);
    });

    it("is disabled with no embed selected and on a Tiny embed", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(getCommand().isEnabled).toBe(false);

        insertContentEmbed(editor, "n1", "tiny");
        expect(getCommand().isEnabled).toBe(false);
        expect(getCommand().value).toBe(false);
    });

    it("labels its toolbar button by whether the caption shows", () => {
        const button = editor.ui.componentFactory.create(TOGGLE_CAPTION_COMMAND_NAME);
        if (!(button instanceof ButtonView)) {
            throw new Error("Expected a button.");
        }
        insertContentEmbed(editor, "n1", "medium");
        expect(button.label).toBe("Toggle caption on");
        expect(button.isOn).toBe(false);

        button.fire("execute");

        expect(button.label).toBe("Toggle caption off");
        expect(button.isOn).toBe(true);
        expect(isSelectionInCaption()).toBe(true);
    });

    it("removes the caption of a Tiny embed and restores it on a larger size, undoably", () => {
        editor.setData(CAPTIONED);
        selectEmbed();

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "tiny" });
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<contentEmbed boxSize=\"tiny\" noteId=\"n1\"></contentEmbed>");

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "small" });
        expect(editor.getData()).toBe(CAPTIONED.replace("medium", "small"));
        expect(getRenderedCaption()).not.toBeNull();

        editor.execute("undo");
        editor.execute("undo");
        expect(editor.getData()).toBe(CAPTIONED);
    });

    it("leaves a caption hidden with the toggle hidden when the embed leaves Tiny", () => {
        editor.setData(CAPTIONED);
        selectEmbed();

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "tiny" });
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });

        expect(editor.getData()).not.toContain("figcaption");
    });

    it("drops the caption of a Tiny embed it loads", () => {
        editor.setData(CAPTIONED.replace("medium", "tiny"));

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<contentEmbed boxSize=\"tiny\" noteId=\"n1\"></contentEmbed>");
    });

    it("shares the caption element with image captions, whichever registers it first", async () => {
        const data = "<figure class=\"image\"><img src=\"a.png\"><figcaption>Picture</figcaption>"
            + "</figure>" + CAPTIONED;

        for (const plugins of [
            [ ImageBlock, ImageCaption, ContentEmbed ],
            [ ContentEmbed, ImageBlock, ImageCaption ]
        ]) {
            const imageEditor = await createTestEditor([
                Essentials, Paragraph, Bold, Widget, ...plugins
            ]);
            imageEditor.setData(data);

            expect(getModelData(imageEditor.model, { withoutSelection: true })).toBe(
                "<imageBlock src=\"a.png\"><caption>Picture</caption></imageBlock>"
                + "<contentEmbed boxSize=\"medium\" noteId=\"n1\">"
                + "<caption>A <$text bold=\"true\">bold</$text> caption</caption></contentEmbed>"
            );
            expect(imageEditor.getData()).toBe(data);
            const root = imageEditor.editing.view.getDomRoot();
            expect(root?.querySelector("figure.image > figcaption")?.textContent)
                .toBe("Picture");
            expect(root?.querySelector("figure.include-note > figcaption")?.textContent)
                .toBe("A bold caption");
        }
    });
});

describe("ContentEmbed title", () => {
    const UNTITLED = "<figure class=\"include-note\" data-note-id=\"n1\" data-box-size=\"medium\""
        + " data-hide-title=\"true\">&nbsp;</figure>";
    let editor: ClassicEditor;
    let loadEmbeddedNote: ReturnType<typeof vi.fn>;
    let openContentEmbedMenu: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadEmbeddedNote = vi.fn();
        openContentEmbedMenu = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote, openContentEmbedMenu })
        });

        editor = await createTestEditor([ Essentials, Paragraph, Undo, Widget, ContentEmbed ]);
    });

    function getCommand() {
        const command = editor.commands.get(TOGGLE_TITLE_COMMAND_NAME);
        if (!command) {
            throw new Error("Expected the title command.");
        }
        return command;
    }

    function getRenderedEmbed() {
        const embed = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        if (!embed) {
            throw new Error("Expected a rendered embed.");
        }
        return embed;
    }

    it("loads and saves a hidden title, and marks the embed it renders", () => {
        editor.setData(UNTITLED);

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<contentEmbed boxSize=\"medium\" hideTitle=\"true\" noteId=\"n1\"></contentEmbed>"
        );
        expect(editor.getData()).toBe(UNTITLED);
        expect(getRenderedEmbed().getAttribute("data-hide-title")).toBe("true");

        editor.setData(UNTITLED.replace(" data-hide-title=\"true\"", ""));
        expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("hideTitle");
        expect(editor.getData()).not.toContain("data-hide-title");
    });

    it("hides the title and shows it again, keeping the rendered content", () => {
        insertContentEmbed(editor, "n1", "medium");
        const wrapper = getRenderedEmbed().querySelector(".include-note-wrapper");
        const command = getCommand();
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe(true);

        editor.execute(TOGGLE_TITLE_COMMAND_NAME);
        expect(command.value).toBe(false);
        expect(getRenderedEmbed().getAttribute("data-hide-title")).toBe("true");
        expect(editor.getData()).toContain("data-hide-title=\"true\"");
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");

        editor.execute(TOGGLE_TITLE_COMMAND_NAME);
        expect(command.value).toBe(true);
        expect(getRenderedEmbed().hasAttribute("data-hide-title")).toBe(false);
        expect(editor.getData()).not.toContain("data-hide-title");

        expect(getRenderedEmbed().querySelector(".include-note-wrapper")).toBe(wrapper);
        expect(loadEmbeddedNote).toHaveBeenCalledTimes(1);
    });

    it("is disabled with no embed selected, and on a Tiny or Expandable embed", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(getCommand().isEnabled).toBe(false);

        for (const [ boxSize, isEnabled ] of [
            [ "tiny", false ], [ "expandable", false ], [ "small", true ], [ "full", true ]
        ] as const) {
            insertContentEmbed(editor, "n1", boxSize);
            expect(getCommand().isEnabled, boxSize).toBe(isEnabled);
        }
    });

    it("offers a Show title button, and a menu button while the title is hidden", () => {
        const toggle = editor.ui.componentFactory.create(TOGGLE_TITLE_COMMAND_NAME);
        const menu = editor.ui.componentFactory.create(CONTENT_EMBED_MENU);
        if (!(toggle instanceof ButtonView) || toggle instanceof SwitchButtonView
                || !(menu instanceof ButtonView)) {
            throw new Error("Expected two buttons.");
        }
        menu.render();
        insertContentEmbed(editor, "n1", "medium");
        expect([ toggle.icon, toggle.withText, toggle.tooltip, toggle.isToggleable ])
            .toEqual([ bxWindowAlt, false, true, true ]);
        expect([ toggle.label, toggle.isOn, toggle.isVisible ]).toEqual([ "Show title", true, true ]);
        expect([ menu.label, menu.isVisible ]).toEqual([ "More actions", false ]);

        toggle.fire("execute");
        expect(toggle.isOn).toBe(false);
        expect(menu.isVisible).toBe(true);

        menu.fire("execute");
        expect(openContentEmbedMenu).toHaveBeenCalledWith(getRenderedEmbed(), menu.element);

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "tiny" });
        expect([ toggle.isVisible, menu.isVisible ]).toEqual([ false, false ]);
    });

    it("opens no menu from a button not rendered yet, or with no embed selected", () => {
        const menu = editor.ui.componentFactory.create(CONTENT_EMBED_MENU);
        insertContentEmbed(editor, "n1", "medium");
        menu.fire("execute");

        menu.render();
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        menu.fire("execute");
        expect(openContentEmbedMenu).not.toHaveBeenCalled();

        insertContentEmbed(editor, "n1", "medium");
        menu.fire("execute");
        expect(openContentEmbedMenu).toHaveBeenCalledTimes(1);
    });
});

describe("ContentEmbed editable flag", () => {
    const EDITABLE = "<figure class=\"include-note\" data-note-id=\"n1\" data-box-size=\"medium\""
        + " data-hide-title=\"true\" data-editable=\"true\">&nbsp;</figure>";
    let editor: ClassicEditor;
    let loadEmbeddedNote: ReturnType<typeof vi.fn>;
    let getContentEmbedTools: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadEmbeddedNote = vi.fn();
        getContentEmbedTools = vi.fn(() => ({ hasEditableFlag: true }));
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote, getContentEmbedTools })
        });

        editor = await createTestEditor([ Essentials, Paragraph, Undo, Widget, ContentEmbed ]);
    });

    function getCommand() {
        const command = editor.commands.get(TOGGLE_EDITABLE_COMMAND_NAME);
        if (!command) {
            throw new Error("Expected the editable command.");
        }
        return command;
    }

    function getRenderedEmbed() {
        const embed = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        if (!embed) {
            throw new Error("Expected a rendered embed.");
        }
        return embed;
    }

    it("loads and saves the flag, and marks the embed it renders", () => {
        editor.setData(EDITABLE);

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<contentEmbed boxSize=\"medium\" editable=\"true\" hideTitle=\"true\" noteId=\"n1\">"
            + "</contentEmbed>"
        );
        expect(editor.getData()).toBe(EDITABLE);
        expect(getRenderedEmbed().getAttribute("data-editable")).toBe("true");

        for (const data of [
            EDITABLE.replace(" data-editable=\"true\"", ""),
            EDITABLE.replace("data-editable=\"true\"", "data-editable=\"false\"")
        ]) {
            editor.setData(data);
            expect(getModelData(editor.model, { withoutSelection: true }))
                .not.toContain("editable");
            expect(editor.getData()).not.toContain("data-editable");
            expect(getRenderedEmbed().hasAttribute("data-editable")).toBe(false);
        }
    });

    it("turns editing on and off as one undo step, keeping the rendered content", () => {
        insertContentEmbed(editor, "n1", "medium");
        const wrapper = getRenderedEmbed().querySelector(".include-note-wrapper");
        const command = getCommand();
        expect([ command.isEnabled, command.value ]).toEqual([ true, false ]);

        editor.execute(TOGGLE_EDITABLE_COMMAND_NAME);
        expect(command.value).toBe(true);
        expect(getRenderedEmbed().getAttribute("data-editable")).toBe("true");
        expect(editor.getData()).toContain("data-editable=\"true\"");
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");

        editor.execute(TOGGLE_EDITABLE_COMMAND_NAME);
        expect(command.value).toBe(false);
        expect(getRenderedEmbed().hasAttribute("data-editable")).toBe(false);
        expect(editor.getData()).not.toContain("data-editable");

        editor.execute("undo");
        expect(command.value).toBe(true);
        expect(getRenderedEmbed().querySelector(".include-note-wrapper")).toBe(wrapper);
        expect(loadEmbeddedNote).toHaveBeenCalledTimes(1);
    });

    it("is offered only for content that opts in, once its content declares it", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(getCommand().isEnabled).toBe(false);

        // The content of an embed renders after the embed, and declares its tools then.
        getContentEmbedTools.mockReturnValue(null);
        insertContentEmbed(editor, "n1", "medium");
        expect(getCommand().isEnabled).toBe(false);
        getContentEmbedTools.mockReturnValue({ hasEditableFlag: true });
        editor.ui.update();
        expect(getCommand().isEnabled).toBe(true);
        expect(getContentEmbedTools).toHaveBeenLastCalledWith(getRenderedEmbed());

        getContentEmbedTools.mockReturnValue({ hasEditableFlag: false });
        editor.ui.update();
        expect(getCommand().isEnabled).toBe(false);

        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote }) });
        editor.ui.update();
        expect(getCommand().isEnabled).toBe(false);
    });

    it("offers an Editable button that shows only while the command is enabled", () => {
        const button = editor.ui.componentFactory.create(TOGGLE_EDITABLE_COMMAND_NAME);
        if (!(button instanceof ButtonView) || button instanceof SwitchButtonView) {
            throw new Error("Expected a button.");
        }
        const focus = vi.spyOn(editor.editing.view, "focus");
        insertContentEmbed(editor, "n1", "medium");
        expect([ button.icon, button.withText, button.tooltip, button.isToggleable ])
            .toEqual([ bxEditAlt, false, true, true ]);
        expect([ button.label, button.isOn, button.isEnabled, button.isVisible ])
            .toEqual([ "Editable", false, true, true ]);

        button.fire("execute");
        expect([ button.isOn, getCommand().value ]).toEqual([ true, true ]);
        expect(focus).toHaveBeenCalled();

        getContentEmbedTools.mockReturnValue(null);
        editor.ui.update();
        expect([ button.isEnabled, button.isVisible ]).toEqual([ false, false ]);
    });

    it("describes the flag of the embed an element is part of", () => {
        editor.setData(EDITABLE + "<figure class=\"include-note\" data-note-id=\"n2\"></figure>");
        const [ editable, readOnly ] =
            editor.editing.view.getDomRoot()?.querySelectorAll("div.include-note-wrapper") ?? [];
        const plugin = editor.plugins.get(ContentEmbed);
        if (!editable || !readOnly) {
            throw new Error("Expected two rendered embeds.");
        }

        expect(plugin.getEmbedStateAt(editable))
            .toMatchObject({ isEditable: true, isEditableToggleable: true });
        expect(plugin.getEmbedStateAt(readOnly))
            .toMatchObject({ isEditable: false, isEditableToggleable: true });

        getContentEmbedTools.mockReturnValue(null);
        expect(plugin.getEmbedStateAt(editable))
            .toMatchObject({ isEditable: true, isEditableToggleable: false });
    });

    it("changes nothing when no embed is selected", () => {
        editor.setData(EDITABLE + "<p>after</p>");
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The decorated `Command#execute()` skips a disabled command, so the command is forced
        // enabled to run `execute()` with no embed selected.
        const command = getCommand();
        command.isEnabled = true;
        command.execute();

        expect(editor.getData()).toBe(before);
    });
});

describe("ContentEmbed resizing", () => {
    const RESIZED = "<figure class=\"include-note\""
        + " style=\"--include-note-height:12.5em;--include-note-width:30em;\""
        + " data-note-id=\"n1\" data-box-size=\"medium\">&nbsp;</figure>";
    let editor: ClassicEditor;

    beforeEach(async () => {
        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        editor = await createTestEditor([ Essentials, Paragraph, Undo, Widget, ContentEmbed ]);
    });

    function getRenderedEmbed() {
        const embed = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        if (!embed) {
            throw new Error("Expected a rendered embed.");
        }
        return embed;
    }

    it("loads and saves the size of a resized embed", () => {
        editor.setData(RESIZED);

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<contentEmbed boxSize=\"medium\" customHeight=\"12.5em\" customWidth=\"30em\""
            + " noteId=\"n1\"></contentEmbed>"
        );
        expect(editor.getData()).toBe(RESIZED);
    });

    it("offers resizing to a Small, Medium or Expandable embed, but not to a Tiny or Full one", () => {
        insertContentEmbed(editor, "n1", "medium");
        const embed = getRenderedEmbed();
        const handles = embed.querySelector(":scope > .ck-widget__resize-handles");
        expect([ ...handles?.children ?? [] ].map((handle) => handle.className)).toEqual([
            "ck-widget__resize-handle ck-widget__resize-handle_width",
            "ck-widget__resize-handle ck-widget__resize-handle_height",
            "ck-widget__resize-handle ck-widget__resize-handle_corner"
        ]);

        for (const [ boxSize, isResizable ] of [
            [ "tiny", false ], [ "small", true ], [ "full", false ], [ "expandable", true ],
            [ "medium", true ]
        ] as const) {
            editor.execute(BOX_SIZE_COMMAND_NAME, { value: boxSize });
            expect(embed.classList.contains("ck-widget_resizable"), boxSize).toBe(isResizable);
        }
    });

    it("resets the height on a new box size, and the width too on Tiny or Full", () => {
        editor.setData(RESIZED);
        const embed = findContentEmbed(editor);
        if (!embed) {
            throw new Error("Expected an embed.");
        }
        editor.model.change((writer) => writer.setSelection(embed, "on"));

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "small" });
        expect(editor.getData()).toContain("style=\"--include-note-width:30em;\"");

        for (const value of [ "tiny", "full" ] as const) {
            editor.execute("undo");
            editor.execute(BOX_SIZE_COMMAND_NAME, { value });
            expect(editor.getData(), value).not.toContain("style=");
        }
    });
});

function findContentEmbed(editor: ClassicEditor): ModelElement | undefined {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    for (const item of editor.model.createRangeIn(root).getItems()) {
        if (item.is("element", "contentEmbed")) {
            return item;
        }
    }
    return undefined;
}

function insertContentEmbed(editor: ClassicEditor, noteId: string, boxSize: string): ModelElement {
    let created: ModelElement | null = null;
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("The editor has no root.");
        }
        const element = writer.createElement("contentEmbed", { noteId, boxSize });
        writer.insert(element, root, 0);
        writer.setSelection(element, "on");
        created = element;
    });
    if (!created) {
        throw new Error("Failed to create contentEmbed element.");
    }
    return created;
}

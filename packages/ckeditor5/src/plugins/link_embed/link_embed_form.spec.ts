import { BlockQuote, ClassicEditor, ContextualBalloon, Essentials, Link, Paragraph, Undo, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import LinkEmbed, { LINK_EMBED_COMMAND } from "./link_embed.js";
import LinkEmbedFormView from "./link_embed_form.js";

const META = {
    url: "https://example.com/",
    embedType: "opengraph",
    title: "Example title",
    description: "Some description",
    favicon: "https://example.com/favicon.ico",
    siteName: "Example",
    image: "https://example.com/image.png"
};

describe("LinkEmbedFormView", () => {
    let editor: ClassicEditor;
    let fetchLinkMetadata: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        fetchLinkMetadata = vi.fn(async (url: string) => ({ ...META, url }));

        installGlobMock({
            getComponentByEl: () => ({
                triggerCommand: vi.fn(),
                renderLinkEmbed: vi.fn(),
                renderLinkMention: vi.fn(),
                fetchLinkMetadata,
                // YouTube-like URLs are embeddable; everything else is not.
                detectEmbedType: (url: string) => (url.includes("youtube") ? "youtube" : "opengraph")
            })
        });

        editor = await createTestEditor([Essentials, Paragraph, BlockQuote, Link, Undo, LinkEmbed]);
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    });

    /** Opens the balloon by clicking the toolbar button, and returns the form inside it. */
    function openForm(): LinkEmbedFormView {
        const button = editor.ui.componentFactory.create("linkEmbed") as unknown as { fire(name: string): void };
        button.fire("execute");

        const form = editor.plugins.get(ContextualBalloon).visibleView;
        if (!(form instanceof LinkEmbedFormView)) {
            throw new Error("The balloon does not hold the link-preview form.");
        }
        return form;
    }

    function isInBalloon(form: LinkEmbedFormView) {
        return editor.plugins.get(ContextualBalloon).hasView(form);
    }

    /** Types into the URL field the way a user does, so the input event fires. */
    function typeUrl(form: LinkEmbedFormView, url: string) {
        const input = form.urlInputView.fieldView.element;
        if (!input) {
            throw new Error("The URL field is not rendered.");
        }
        input.value = url;
        input.dispatchEvent(new Event("input"));
    }

    // -----------------------------------------------------------------------
    // Structure
    // -----------------------------------------------------------------------

    it("wears CKEditor's own link-form classes, so it matches the native link balloon", () => {
        const form = openForm();
        const classes = form.element?.classList;

        expect(classes?.contains("ck-link-form")).toBe(true);
        expect(classes?.contains("ck-responsive-form")).toBe(true);
        expect(form.element?.tagName).toBe("FORM");
    });

    it("holds a heading, a URL field, a display-mode selector and an Insert button — and nothing else", () => {
        const form = openForm();

        expect(form.element?.querySelector(".ck-link-embed-form__heading")?.textContent).toBe("Link preview");
        expect(form.urlInputView.label).toBe("URL");
        expect(form.urlInputView.fieldView.placeholder).toBe("http://");
        expect(form.modeDropdownView.buttonView.label).toBe("Card");

        // A text button, like the Insert button of the editor's own link form.
        expect(form.insertButtonView.label).toBe("Insert");
        expect(form.insertButtonView.withText).toBe(true);
        expect(form.insertButtonView.element?.classList.contains("ck-button-action")).toBe(true);
        expect(form.insertButtonView.element?.classList.contains("ck-button_with-text")).toBe(true);

        // The dropdown and the button share a row below the field.
        const actions = form.element?.querySelector(".ck-link-embed-form__actions");
        expect(actions?.contains(form.modeDropdownView.element ?? null)).toBe(true);
        expect(actions?.contains(form.insertButtonView.element ?? null)).toBe(true);
    });

    it("puts the caret straight in the URL field, so the user can just type", () => {
        const form = openForm();

        expect(document.activeElement).toBe(form.urlInputView.fieldView.element);
    });

    it("resolves its labels through the host's translation bridge when there is one", async () => {
        editor = await createTestEditor(
            [Essentials, Paragraph, Link, Undo, LinkEmbed],
            { translate: (key: string) => `translated:${key}` } as unknown as Parameters<typeof createTestEditor>[1]
        );
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const form = openForm();
        expect(form.urlInputView.label).toBe("translated:link_embed.url");
        expect(form.insertButtonView.label).toBe("translated:link_embed.insert");
    });

    // -----------------------------------------------------------------------
    // The mode selector
    // -----------------------------------------------------------------------

    it("defaults to Card, and to Embed once the URL turns out to have a player", () => {
        const form = openForm();
        expect(form.mode).toBe("card");
        expect(form.embedAvailable).toBe(false);

        typeUrl(form, "https://youtube.com/watch?v=abc12345678");
        expect(form.embedAvailable).toBe(true);
        expect(form.mode).toBe("embed");

        // Back to an ordinary page: the player is neither offered nor kept.
        typeUrl(form, "https://example.com/article");
        expect(form.embedAvailable).toBe(false);
        expect(form.mode).toBe("card");
    });

    it("stops following the URL once the user picks a mode, but never leaves them on an impossible one", () => {
        const form = openForm();

        form.modeDropdownView.fire("execute", { source: { _displayMode: "inline" } });
        form.mode = "inline";

        // The user has spoken: an embeddable URL no longer overrules them.
        typeUrl(form, "https://youtube.com/watch?v=abc12345678");
        expect(form.mode).toBe("inline");

        // But a mode that the URL cannot support falls back rather than being submitted.
        form.mode = "embed";
        typeUrl(form, "https://example.com/article");
        expect(form.mode).toBe("card");
    });

    // -----------------------------------------------------------------------
    // Submitting
    // -----------------------------------------------------------------------

    it("keeps Insert disabled until a URL is typed", () => {
        const form = openForm();
        expect(form.insertButtonView.isEnabled).toBe(false);

        typeUrl(form, "https://example.com/article");
        expect(form.insertButtonView.isEnabled).toBe(true);
    });

    it("inserts the preview, closes the balloon and leaves the form ready for next time", async () => {
        const form = openForm();
        typeUrl(form, "https://example.com/article");

        form.fire("submit");
        await vi.waitFor(() => expect(isInBalloon(form)).toBe(false));

        expect(fetchLinkMetadata).toHaveBeenCalledWith("https://example.com/article");
        expect(editor.getData()).toContain('data-url="https://example.com/article"');

        // Reopening starts blank rather than showing the last URL.
        const reopened = openForm();
        expect(reopened.url).toBe("");
        expect(reopened.mode).toBe("card");
    });

    it("defaults the scheme, so a bare domain is not inserted as a dead link", async () => {
        const form = openForm();
        typeUrl(form, "example.com/article");

        form.fire("submit");
        await vi.waitFor(() => expect(isInBalloon(form)).toBe(false));

        expect(fetchLinkMetadata).toHaveBeenCalledWith("https://example.com/article");
    });

    it("does nothing when submitted with an empty URL", () => {
        const form = openForm();

        form.fire("submit");

        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(isInBalloon(form)).toBe(true);
    });

    it("refuses a URL that cannot be a preview, leaving the form open", async () => {
        const form = openForm();
        typeUrl(form, "javascript:alert(1)");

        form.fire("submit");

        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(isInBalloon(form)).toBe(true);
    });

    it("disables the form while the metadata is being fetched, so it cannot be submitted twice", async () => {
        let resolveFetch: ((metadata: unknown) => void) | undefined;
        fetchLinkMetadata.mockImplementation(() => new Promise((resolve) => {
            resolveFetch = resolve;
        }));

        const form = openForm();
        typeUrl(form, "https://example.com/article");

        form.fire("submit");
        expect(form.isFetching).toBe(true);
        expect(form.insertButtonView.isEnabled).toBe(false);
        expect(form.modeDropdownView.isEnabled).toBe(false);

        // A second Enter while the first fetch is in flight must not fetch again.
        form.fire("submit");
        expect(fetchLinkMetadata).toHaveBeenCalledTimes(1);

        resolveFetch?.({ ...META, url: "https://example.com/article" });
        await vi.waitFor(() => expect(isInBalloon(form)).toBe(false));
        expect(form.isFetching).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Dismissing
    // -----------------------------------------------------------------------

    it("closes on Esc without inserting anything", () => {
        const form = openForm();
        typeUrl(form, "https://example.com/article");

        const before = editor.getData();
        form.keystrokes.press({ keyCode: 27, preventDefault: () => {}, stopPropagation: () => {} } as unknown as KeyboardEvent);

        expect(isInBalloon(form)).toBe(false);
        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(editor.getData()).toBe(before);
    });

    it("follows the URL again after a dismissal, forgetting the earlier mode pick", () => {
        const form = openForm();
        typeUrl(form, "https://example.com/article");
        form.modeDropdownView.fire("execute", { source: { _displayMode: "inline" } });
        form.mode = "inline";

        // Dismiss without inserting: the pick was for that URL only.
        form.keystrokes.press({ keyCode: 27, preventDefault: () => {}, stopPropagation: () => {} } as unknown as KeyboardEvent);
        expect(isInBalloon(form)).toBe(false);

        // Reopened with an embeddable URL, the mode follows the URL again instead of the old pick.
        openForm();
        typeUrl(form, "https://youtube.com/watch?v=abc12345678");
        expect(form.mode).toBe("embed");
    });

    it("closes when the user clicks away from it", () => {
        const form = openForm();
        expect(isInBalloon(form)).toBe(true);

        // clickOutsideHandler watches for a mousedown outside the balloon.
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        expect(isInBalloon(form)).toBe(false);
        expect(fetchLinkMetadata).not.toHaveBeenCalled();
    });

    it("does not stack a second form when the button is clicked twice", () => {
        const form = openForm();
        openForm();

        expect(editor.plugins.get(ContextualBalloon).visibleView).toBe(form);
    });

    it("only offers the insert command where a preview may go", () => {
        const command = editor.commands.get(LINK_EMBED_COMMAND);
        expect(command?.isEnabled).toBe(true);

        editor.enableReadOnlyMode("test");
        expect(command?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
    });
});

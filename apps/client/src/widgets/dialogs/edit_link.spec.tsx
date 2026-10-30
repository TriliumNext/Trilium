import type { RefObject } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type { Suggestion } from "../../services/note_autocomplete";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import Modal from "../react/Modal";
import { ParentComponent } from "../react/react_utils";
import EditLinkDialog, {
    EditLinkBalloon, type EditLinkOpts, getShownDisplay, normalizeWebLink
} from "./edit_link";

const autocomplete = vi.hoisted(() => ({
    onChange: undefined as ((suggestion: Suggestion | null) => void) | undefined
}));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ onChange, inputRef }: {
        onChange: (suggestion: Suggestion | null) => void;
        inputRef?: RefObject<HTMLInputElement>;
    }) => {
        autocomplete.onChange = onChange;
        return <input ref={inputRef} className="note-autocomplete" />;
    }
}));

describe("normalizeWebLink", () => {
    it("adds https:// to an address without a scheme, and keeps any other scheme", () => {
        expect(normalizeWebLink(" example.com/a ")).toBe("https://example.com/a");
        expect(normalizeWebLink("localhost:8080")).toBe("https://localhost:8080");
        expect(normalizeWebLink("http://example.com")).toBe("http://example.com");
        expect(normalizeWebLink("mailto:someone@example.com")).toBe("mailto:someone@example.com");
        expect(normalizeWebLink("tel:123456789")).toBe("tel:123456789");
        expect(normalizeWebLink("SMS:+123456789")).toBe("SMS:+123456789");
        expect(normalizeWebLink("geo:47.6,-122.3")).toBe("geo:47.6,-122.3");
        expect(normalizeWebLink("example.com:443/a")).toBe("https://example.com:443/a");
        expect(normalizeWebLink("  ")).toBeNull();
    });
});

describe("getShownDisplay", () => {
    it("shows the display picked, a card for a player the address lacks, a plain link off the web", () => {
        const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        expect(getShownDisplay("inline", "https://example.com")).toBe("inline");
        expect(getShownDisplay("embed", video)).toBe("embed");
        expect(getShownDisplay("card", video)).toBe("card");
        expect(getShownDisplay("embed", "https://example.com")).toBe("card");
        expect(getShownDisplay("embed", undefined)).toBe("card");
        expect(getShownDisplay("card", "mailto:someone@example.com")).toBe("plain");
    });
});

describe("EditLinkDialog", () => {
    let host: Component;
    let container: HTMLElement;
    const addLink = vi.fn<EditLinkOpts["addLink"]>(async () => {});
    const addLinkPreview = vi.fn<NonNullable<EditLinkOpts["addLinkPreview"]>>(async () => {});

    beforeEach(() => {
        vi.clearAllMocks();
        autocomplete.onChange = undefined;
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <EditLinkDialog />
            </ParentComponent.Provider>
        );
    });

    async function open(opts: Partial<EditLinkOpts> = {}) {
        await act(async () => {
            void host.handleEventInChildren("showEditLinkDialog", {
                text: "", hasSelection: false, addLink, ...opts
            });
        });
    }

    function choice() {
        return [ ...container.querySelectorAll<HTMLButtonElement>(".tn-segmented-choice button") ];
    }

    function current() {
        return choice().find((button) => button.classList.contains("active"))?.textContent?.trim();
    }

    function headings() {
        return [ ...container.querySelectorAll(".tn-card-heading") ].map((heading) => heading.textContent);
    }

    function mirrorToggle() {
        return container.querySelector<HTMLInputElement>(".edit-link-mirror input.switch-toggle");
    }

    /** Whether the row of the field is indented under the row it depends on. */
    function nested(name: "url" | "text") {
        return container.querySelector(`.edit-link-${name}`)?.classList.contains("tn-card-section-nested");
    }

    /** The rows that put their control under the label rather than beside it. */
    function stacked() {
        return [ ...container.querySelectorAll(".tn-card-option-stacked") ];
    }

    function field(name: "url" | "text") {
        return container.querySelector<HTMLInputElement>(`.edit-link-${name} input`);
    }

    function displaySelect() {
        return container.querySelector<HTMLSelectElement>(".edit-link-display select");
    }

    function anchorRows() {
        return [ ...container.querySelectorAll<HTMLElement>(".edit-link-anchors .tn-card-choice") ];
    }

    function checkedAnchor() {
        return anchorRows().find((row) => row.getAttribute("aria-checked") === "true")?.textContent;
    }

    function displays() {
        return [ ...displaySelect()?.options ?? [] ].map((option) => option.textContent);
    }

    async function pickDisplay(value: string) {
        const select = displaySelect();
        if (!select) throw new Error("The dialog offers no display.");
        await act(async () => {
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    async function submit() {
        const form = container.querySelector("form");
        const modal = container.querySelector(".modal");
        if (!form || !modal) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            modal.dispatchEvent(new Event("hidden.bs.modal"));
        });
    }

    it("inserts a typed web link, titled by its URL unless given a text", async () => {
        await open();
        expect(headings()).toStrictEqual([]);
        const segmented = container.querySelector(".tn-segmented-choice");
        expect(segmented).not.toBeNull();
        expect(segmented?.closest(".tn-card")).toBeNull();
        expect(segmented?.nextElementSibling?.classList.contains("tn-card")).toBe(true);
        expect(choice().map((button) => button.textContent?.trim()))
            .toStrictEqual([ "add_link.web_link", "add_link.note" ]);
        expect(choice()[1]?.querySelector(".tn-svg-icon svg")).not.toBeNull();
        expect(choice()[1]?.querySelector(".bx")).toBeNull();
        expect(current()).toBe("add_link.note");
        expect(container.querySelector(".note-autocomplete")).not.toBeNull();

        await act(async () => choice()[0]?.click());
        expect(current()).toBe("add_link.web_link");
        expect(container.querySelector(".note-autocomplete")).toBeNull();
        expect(field("url")?.inputMode).toBe("url");

        await type(field("url"), "example.com");
        await submit();
        expect(addLink)
            .toHaveBeenLastCalledWith("https://example.com", "https://example.com", true);

        await open();
        await act(async () => choice()[0]?.click());
        await type(field("url"), "https://trilium.cc");
        expect(nested("text")).toBe(false);
        expect(container.querySelector(".edit-link-url + .edit-link-text")).not.toBeNull();
        expect(stacked()).toStrictEqual([]);
        await type(field("text"), "Trilium");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://trilium.cc", "Trilium", true);
    });

    it("links a note by its title, or by a text of its own once the title stops mirroring it", async () => {
        const note = buildNote({ title: "Target" });
        await open();
        await act(async () => autocomplete.onChange?.({ notePath: `root/${note.noteId}` }));
        expect(mirrorToggle()?.checked).toBe(true);
        expect(field("text")).toBeNull();
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`root/${note.noteId}`, null);

        await open();
        await act(async () => autocomplete.onChange?.({ notePath: `root/${note.noteId}` }));
        const toggle = mirrorToggle();
        if (!toggle) throw new Error("No toggle to mirror the note's title.");
        await act(async () => {
            toggle.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await vi.waitFor(() => expect(field("text")?.value).toBe("Target"));
        expect(nested("text")).toBe(true);
        expect(stacked()).toStrictEqual([]);
        await type(field("text"), "See there");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`root/${note.noteId}`, "See there");
    });

    it("opens on the web link side for an edited external link or a selected URL", async () => {
        await open({ currentLink: { externalLink: "https://example.com/page" } });
        expect(current()).toBe("add_link.web_link");
        expect(field("url")?.value).toBe("https://example.com/page");

        await open({ text: "https://example.org", hasSelection: true });
        expect(current()).toBe("add_link.web_link");
        expect(field("url")?.value).toBe("https://example.org");
        // The selected text is the link's text.
        expect(field("text")).toBeNull();

        await open({ text: "some words", hasSelection: true });
        expect(current()).toBe("add_link.note");
    });

    it("opens a new link on the side asked for, and an edited one on its own side", async () => {
        await open({ target: "url" });
        expect(current()).toBe("add_link.web_link");
        expect(field("url")?.value).toBe("");
        expect(field("text")).not.toBeNull();

        await open({ target: "url", text: "some words", hasSelection: true });
        expect(current()).toBe("add_link.web_link");
        expect(field("text")).toBeNull();
        await type(field("url"), "example.com");
        await submit();
        expect(addLink)
            .toHaveBeenLastCalledWith("https://example.com", "https://example.com", true);

        const note = buildNote({ title: "Target" });
        await open({ target: "url", currentLink: { notePath: `root/${note.noteId}` } });
        expect(current()).toBe("add_link.note");
    });

    it("edits a link with its own text, keeping that text and its anchor", async () => {
        const note = buildNote({ title: "Target", "#internalBookmark": "part" });
        await open({
            currentLink: { notePath: `root/${note.noteId}` },
            currentTitle: "See there",
            currentBookmark: "part"
        });
        expect(mirrorToggle()?.checked).toBe(false);
        await vi.waitFor(() => expect(container.querySelector("select")?.value).toBe("part"));
        expect(field("text")?.value).toBe("See there");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`root/${note.noteId}?bookmark=part`, "See there");

        await open({
            currentLink: { externalLink: "https://example.com" }, currentTitle: "Example"
        });
        expect(field("text")?.value).toBe("Example");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://example.com", "Example", true);
    });

    it("moves a URL typed or pasted on the note side over to the web link side", async () => {
        await open();
        await act(async () => autocomplete.onChange?.({ externalLink: "https://typed.example" }));
        expect(current()).toBe("add_link.web_link");
        expect(field("url")?.value).toBe("https://typed.example");

        await open();
        const paste = new Event("paste", { bubbles: true, cancelable: true });
        const clipboardData = { getData: () => " https://pasted.example " };
        Object.defineProperty(paste, "clipboardData", { value: clipboardData });
        await act(async () => {
            container.querySelector(".note-autocomplete")?.dispatchEvent(paste);
        });
        expect(paste.defaultPrevented).toBe(true);
        expect(current()).toBe("add_link.web_link");
        expect(field("url")?.value).toBe("https://pasted.example");
    });

    it("focuses the field of the side shown, except on mobile, where it waits for a tap", async () => {
        async function openAndShow() {
            await open();
            await act(async () => {
                container.querySelector(".modal")?.dispatchEvent(new Event("shown.bs.modal"));
            });
            return container.querySelector(".note-autocomplete");
        }

        const picker = await openAndShow();
        expect(picker).not.toBeNull();
        expect(document.activeElement).toBe(picker);
        (document.activeElement as HTMLElement | null)?.blur();

        window.glob.device = "mobile";
        try {
            host = new Component();
            container = renderInto(
                <ParentComponent.Provider value={host}>
                    <EditLinkDialog />
                </ParentComponent.Provider>
            );
            const mobilePicker = await openAndShow();
            expect(mobilePicker).not.toBeNull();
            expect(document.activeElement).not.toBe(mobilePicker);

            await act(async () => {
                choice().find((button) => button.textContent?.includes("add_link.web_link"))?.click();
            });
            expect(field("url")).not.toBeNull();
            expect(document.activeElement).not.toBe(field("url"));
        } finally {
            window.glob.device = "desktop";
        }
    });

    it("offers how a web link is displayed to a caller that shows previews, and applies a preview", async () => {
        await open({ target: "url" });
        expect(displaySelect()).toBeNull();

        await open({ target: "url", addLinkPreview });
        expect(headings()).toStrictEqual([]);
        expect(displays()).toStrictEqual(
            [ "add_link.display_plain", "add_link.display_inline", "add_link.display_card" ]
        );
        const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        await type(field("url"), video);
        expect(displays()).toContain("add_link.display_embed");
        await pickDisplay("card");
        await type(field("text"), "Never gonna");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "card", "Never gonna");
        expect(addLink).not.toHaveBeenCalled();

        // A player shows no title.
        await open({ target: "url", display: "embed", addLinkPreview });
        await type(field("url"), video);
        expect(field("text")).toBeNull();
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "embed", null);

        // A plain link, and any address that is not a web page, stays a link.
        await open({ target: "url", addLinkPreview });
        await type(field("url"), "example.com");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://example.com", "https://example.com", true);
        await open({ target: "url", display: "card", addLinkPreview });
        await type(field("url"), "mailto:someone@example.com");
        expect(displaySelect()?.disabled).toBe(true);
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(
            "mailto:someone@example.com", "mailto:someone@example.com", true
        );
        expect(addLinkPreview).toHaveBeenCalledTimes(2);

        // A link on a selection keeps the selected text, so it is never a preview.
        await open({
            target: "url", text: "some words", hasSelection: true, display: "card", addLinkPreview
        });
        expect(displaySelect()).toBeNull();
        await type(field("url"), "https://example.com");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://example.com", "https://example.com", true);
        await open({ text: video, hasSelection: true, addLinkPreview });
        expect(field("url")?.value).toBe(video);
        expect(displaySelect()).toBeNull();
        expect(addLinkPreview).toHaveBeenCalledTimes(2);
    });

    it("turns an edited link into a preview with the page's own title unless it has a text", async () => {
        const url = "https://example.com/page";
        await open({ currentLink: { externalLink: url }, currentTitle: url, addLinkPreview });
        await pickDisplay("inline");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "inline", null);

        await open({ currentLink: { externalLink: url }, currentTitle: "Page", addLinkPreview });
        await pickDisplay("card");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "card", "Page");
        expect(addLink).not.toHaveBeenCalled();
    });

    it("edits a link preview, giving another address the title of its own page", async () => {
        const url = "https://example.com/page";
        await open({
            currentLink: { externalLink: url }, currentTitle: "Page", display: "card", addLinkPreview
        });
        expect(field("url")?.value).toBe(url);
        expect(field("text")?.value).toBe("Page");
        expect(displays()).toStrictEqual(
            [ "add_link.display_plain", "add_link.display_inline", "add_link.display_card" ]
        );
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "card", "Page");

        await open({
            currentLink: { externalLink: url }, currentTitle: "Page", display: "card", addLinkPreview
        });
        await type(field("url"), "https://example.com/other");
        expect(field("text")?.value).toBe("");
        await type(field("text"), "Mine");
        await type(field("url"), "https://example.com/third");
        expect(field("text")?.value).toBe("Mine");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith("https://example.com/third", "card", "Mine");

        // A plain link keeps its text for another address.
        await open({ currentLink: { externalLink: url }, currentTitle: "Page", addLinkPreview });
        await type(field("url"), "https://example.com/other");
        expect(field("text")?.value).toBe("Page");
    });

    it("offers no web link when fixing a link to a missing note", async () => {
        await open({ text: "Gone", fixLink: true });
        expect(choice()).toStrictEqual([]);
        expect(container.querySelector(".note-autocomplete")).not.toBeNull();
    });

    it("links an anchor of the document, read as its name unless given a text", async () => {
        await open({ anchors: [ "intro", "outro" ] });
        expect(choice().map((button) => button.textContent?.trim()))
            .toStrictEqual([ "add_link.web_link", "add_link.note", "add_link.anchors" ]);
        expect(choice()[2]?.querySelector(".bx-bookmark")).not.toBeNull();
        expect(current()).toBe("add_link.note");

        await act(async () => choice()[2]?.click());
        expect(current()).toBe("add_link.anchors");
        expect(container.querySelector(".note-autocomplete")).toBeNull();
        expect(headings()).toStrictEqual([ "add_link.target_anchor" ]);
        const titleCard = field("text")?.closest(".tn-card");
        expect(titleCard?.nextElementSibling?.classList.contains("edit-link-anchors")).toBe(true);
        expect(anchorRows().map((row) => row.textContent)).toStrictEqual([ "intro", "outro" ]);
        expect(anchorRows().every((row) => row.querySelector(".tn-card-choice-icon.bx-bookmark")))
            .toBe(true);
        expect(checkedAnchor()).toBeUndefined();

        await act(async () => anchorRows()[1]?.click());
        expect(checkedAnchor()).toBe("outro");
        expect(field("text")?.placeholder).toBe("outro");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("#outro", "outro", true);

        await open({ anchors: [ "intro", "outro" ] });
        await act(async () => choice()[2]?.click());
        await act(async () => anchorRows()[0]?.click());
        // Another page drops the checked anchor.
        await act(async () => choice()[1]?.click());
        await act(async () => choice()[2]?.click());
        expect(checkedAnchor()).toBeUndefined();
        await act(async () => anchorRows()[0]?.click());
        await type(field("text"), "Read the intro");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("#intro", "Read the intro", true);
    });

    it("opens an edited anchor link on its anchor; a selection hides the title", async () => {
        await open({
            anchors: [ "intro", "outro" ], currentAnchor: "outro", currentTitle: "See the end"
        });
        expect(container.querySelector(".modal-title")?.textContent).toBe("add_link.edit_link");
        expect(current()).toBe("add_link.anchors");
        expect(checkedAnchor()).toBe("outro");
        expect(field("text")?.value).toBe("See the end");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("#outro", "See the end", true);

        await open({ text: "chosen words", hasSelection: true, anchors: [ "intro" ] });
        await act(async () => choice()[2]?.click());
        expect(field("text")).toBeNull();
        expect(container.querySelectorAll(".tn-card")).toHaveLength(1);
        await act(async () => anchorRows()[0]?.click());
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("#intro", "intro", true);

        await open({ anchors: [] });
        await act(async () => choice()[2]?.click());
        expect(anchorRows()).toStrictEqual([]);
        expect(container.querySelector(".edit-link-anchors .no-items")?.textContent)
            .toBe("add_link.no_anchors");
    });
});

describe("EditLinkBalloon", () => {
    const addLink = vi.fn<EditLinkOpts["addLink"]>(async () => {});
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function show(opts: Partial<EditLinkOpts> = {}) {
        const rendered: { container?: HTMLElement } = {};
        await act(async () => {
            rendered.container = renderInto(
                <EditLinkBalloon
                    opts={{ text: "", hasSelection: false, addLink, ...opts }}
                    onClose={onClose}
                />
            );
        });
        const form = rendered.container?.querySelector("form");
        if (!form) throw new Error("The balloon has no form.");
        return form;
    }

    async function submit(form: HTMLFormElement) {
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    }

    it("focuses the field of the side it opens on, and closes once a link is applied", async () => {
        const noteForm = await show();
        expect(document.activeElement).toBe(noteForm.querySelector(".note-autocomplete"));

        const form = await show({ target: "url" });
        const url = form.querySelector<HTMLInputElement>(".edit-link-url input");
        expect(url).not.toBeNull();
        expect(document.activeElement).toBe(url);

        await submit(form);
        expect(onClose).not.toHaveBeenCalled();

        await type(url, "example.com");
        await submit(form);
        expect(onClose).toHaveBeenCalledOnce();
        expect(addLink)
            .toHaveBeenCalledExactlyOnceWith("https://example.com", "https://example.com", true);
    });

    it("takes the focus from a modal around the editor", async () => {
        renderInto(
            <Modal className="host-modal" size="md" show onHidden={() => {}}><input /></Modal>
        );
        await vi.waitFor(() => expect(document.querySelector(".host-modal.show")).not.toBeNull());

        const form = await show({ target: "url" });
        expect(document.activeElement).toBe(form.querySelector(".edit-link-url input"));
    });

    it("opens on an edited link with its address selected, and applies it left alone", async () => {
        const form = await show({
            currentLink: { externalLink: "https://example.com/page" }, currentTitle: "Page"
        });
        const url = form.querySelector<HTMLInputElement>(".edit-link-url input");
        expect(url?.value).toBe("https://example.com/page");
        expect([ url?.selectionStart, url?.selectionEnd ]).toStrictEqual([ 0, url?.value.length ]);

        await submit(form);
        expect(onClose).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenCalledExactlyOnceWith("https://example.com/page", "Page", true);
    });

    it("focuses the title of the Anchors page and applies once an anchor is checked", async () => {
        const edited = await show({
            anchors: [ "intro" ], currentAnchor: "intro", currentTitle: "Intro"
        });
        const title = edited.querySelector<HTMLInputElement>(".edit-link-text input");
        expect(document.activeElement).toBe(title);
        expect([ title?.selectionStart, title?.selectionEnd ]).toStrictEqual([ 0, 5 ]);
        await submit(edited);
        expect(addLink).toHaveBeenLastCalledWith("#intro", "Intro", true);
        expect(onClose).toHaveBeenCalledOnce();

        const form = await show({ anchors: [ "intro" ] });
        const buttons = form.querySelectorAll<HTMLButtonElement>(".tn-segmented-choice button");
        await act(async () => buttons[2]?.click());
        expect(document.activeElement).toBe(form.querySelector(".edit-link-text input"));
        await submit(form);
        expect(onClose).toHaveBeenCalledOnce();

        const row = form.querySelector<HTMLElement>(".edit-link-anchors .tn-card-choice");
        await act(async () => row?.click());
        await submit(form);
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(addLink).toHaveBeenLastCalledWith("#intro", "intro", true);
    });
});

async function type(input: HTMLInputElement | null, value: string) {
    if (!input) throw new Error("The field is not shown.");
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

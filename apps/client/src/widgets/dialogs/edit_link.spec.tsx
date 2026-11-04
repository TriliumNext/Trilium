import type { RefObject } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import Component from "../../components/component";
import type { PageDetails } from "../../services/link_embed";
import type { Suggestion } from "../../services/note_autocomplete";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import Modal from "../react/Modal";
import { ParentComponent } from "../react/react_utils";
import EditLinkDialog, {
    EditLinkBalloon, type EditLinkOpts, getShownDisplay, getWebLinkError, type LinkHeading,
    normalizeWebLink
} from "./edit_link";

const autocomplete = vi.hoisted(() => ({
    onChange: undefined as ((suggestion: Suggestion | null) => void) | undefined
}));
const { readClipboardText } = vi.hoisted(() => ({ readClipboardText: vi.fn(async () => "") }));
const { fetchPageDetails } = vi.hoisted(() => ({
    fetchPageDetails: vi.fn<(url: string) => Promise<PageDetails | null>>(async () => null)
}));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../services/clipboard_ext", () => ({
    canReadClipboardText: async () => true,
    readClipboardText
}));
vi.mock("../../services/link_embed", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/link_embed")>(),
    fetchPageDetails
}));
vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ onChange, inputRef }: {
        onChange: (suggestion: Suggestion | null) => void;
        inputRef?: RefObject<HTMLInputElement>;
    }) => {
        autocomplete.onChange = onChange;
        return <input ref={inputRef} className="note-autocomplete" />;
    }
}));

beforeEach(() => {
    fetchPageDetails.mockReset();
    options.set("textNoteLinkTitleRetrievalEnabled", "false");
    options.set("textNoteLinkDetailsRetrievalEnabled", "false");
});

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

describe("getWebLinkError", () => {
    it("refuses a javascript: link and an address that new URL() cannot parse", () => {
        expect(getWebLinkError("https://example.com/a b")).toBeUndefined();
        expect(getWebLinkError("mailto:someone@example.com")).toBeUndefined();
        expect(getWebLinkError("javascript:alert(1)")).toBe("add_link.javascript_not_allowed");
        expect(getWebLinkError("JavaScript:void(0)")).toBe("add_link.javascript_not_allowed");
        // `new URL()` drops the tab, as the browser does when it follows the link.
        expect(getWebLinkError("java\tscript:alert(1)")).toBe("add_link.javascript_not_allowed");
        expect(getWebLinkError("https://exa mple.com")).toBe("add_link.invalid_url");
        expect(getWebLinkError("https://example.com:99999")).toBe("add_link.invalid_url");
    });
});

describe("getShownDisplay", () => {
    it("shows the display picked, a card for a player the address lacks, a text link off the web", () => {
        const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        expect(getShownDisplay("iconAndTextLink", "https://example.com")).toBe("iconAndTextLink");
        expect(getShownDisplay("embedLink", video)).toBe("embedLink");
        expect(getShownDisplay("cardLink", video)).toBe("cardLink");
        expect(getShownDisplay("embedLink", "https://example.com")).toBe("cardLink");
        expect(getShownDisplay("embedLink", undefined)).toBe("cardLink");
        expect(getShownDisplay("cardLink", "mailto:someone@example.com")).toBe("textLink");
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

    function description() {
        return container.querySelector<HTMLTextAreaElement>(".edit-link-description textarea");
    }

    function anchorRows() {
        return [ ...container.querySelectorAll<HTMLElement>(".edit-link-anchors .tn-card-choice") ];
    }

    function checkedAnchor() {
        return anchorRows().find((row) => row.getAttribute("aria-checked") === "true")?.textContent;
    }

    function headingRows() {
        return [ ...container.querySelectorAll<HTMLElement>(".edit-link-headings .tn-card-choice") ];
    }

    function checkedHeading() {
        return headingRows().find((row) => row.getAttribute("aria-checked") === "true")?.textContent;
    }

    async function toggleHeading(index: number) {
        const expander = headingRows()[index]?.querySelector<HTMLElement>(".tn-card-choice-expander");
        if (!expander) throw new Error(`The heading ${index} has no expander.`);
        await act(async () => expander.click());
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
        expect(field("text")?.placeholder).toBe("add_link.title_from_url");

        await type(field("url"), "example.com");
        await submit();
        expect(addLink)
            .toHaveBeenLastCalledWith("https://example.com", "https://example.com", true);

        await open();
        await act(async () => choice()[0]?.click());
        await type(field("url"), "https://trilium.cc");
        expect(field("text")?.placeholder).toBe("https://trilium.cc");
        expect(nested("text")).toBe(false);
        expect(container.querySelector(".edit-link-url + .edit-link-text")).not.toBeNull();
        expect(stacked()).toStrictEqual([]);
        await type(field("text"), "Trilium");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://trilium.cc", "Trilium", true);
    });

    it("links a note mirroring its title, or by a text of its own", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        await open();
        await act(async () => autocomplete.onChange?.({ notePath: path }));
        expect(container.querySelector(".edit-link-mirror")).toBeNull();
        expect(field("text")?.value).toBe("");
        expect(field("text")?.placeholder).toBe("add_link.title_from_note");
        expect(container.querySelector(".edit-link-note + .edit-link-text")).not.toBeNull();
        expect(nested("text")).toBe(false);
        expect(stacked()).toStrictEqual([]);
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, null);

        await open();
        await act(async () => autocomplete.onChange?.({ notePath: path }));
        await type(field("text"), "  ");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, null);

        await open();
        await act(async () => autocomplete.onChange?.({ notePath: path }));
        await type(field("text"), " See there ");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, "See there");
    });

    it("links a selection by its text, or by the note's title if it has none", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        await open({ text: "some words", hasSelection: true });
        await act(async () => autocomplete.onChange?.({ notePath: path }));
        expect(field("text")).toBeNull();
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, "some words");

        await open({ text: "", hasSelection: true });
        await act(async () => autocomplete.onChange?.({ notePath: path }));
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, "Target");
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

        await open({ target: "anchor", anchors: [ "intro" ] });
        expect(current()).toBe("add_link.anchors");
        expect(anchorRows().map((row) => row.textContent)).toStrictEqual([ "intro" ]);
        await act(async () => anchorRows()[0]?.click());
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("#intro", "intro", true);

        const note = buildNote({ title: "Target" });
        for (const target of [ "url", "anchor" ] as const) {
            await open({
                target, anchors: [ "intro" ], currentLink: { notePath: `root/${note.noteId}` }
            });
            expect(current()).toBe("add_link.note");
        }
    });

    it("edits a link with its own text, keeping that text and its anchor", async () => {
        const note = buildNote({ title: "Target", "#internalBookmark": "part" });
        const edited = {
            currentLink: { notePath: `root/${note.noteId}` }, currentTitle: "See there"
        };
        await open({ ...edited, currentBookmark: "part" });
        await vi.waitFor(() => expect(container.querySelector("select")?.value).toBe("part"));
        expect(field("text")?.value).toBe("See there");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`root/${note.noteId}?bookmark=part`, "See there");

        // An emptied title turns it into a link that mirrors the note's title.
        await open(edited);
        await type(field("text"), "");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`root/${note.noteId}`, null);

        // Another note drops the text, and the link mirrors that note's title.
        const other = buildNote({ title: "Other" });
        await open(edited);
        await act(async () => autocomplete.onChange?.({ notePath: `root/${other.noteId}` }));
        expect(field("text")?.value).toBe("");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`root/${other.noteId}`, null);

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

    it("enables its button only once the side shown has a note, an address or an anchor", async () => {
        const button = () => container.querySelector<HTMLButtonElement>(".modal-footer button");
        await open({ anchors: [ "intro" ] });
        expect(button()?.disabled).toBe(true);
        const note = buildNote({ title: "Note" });
        await act(async () => autocomplete.onChange?.({ notePath: `root/${note.noteId}` }));
        expect(button()?.disabled).toBe(false);
        await act(async () => autocomplete.onChange?.(null));
        expect(button()?.disabled).toBe(true);

        await act(async () => choice()[0]?.click());
        expect(button()?.disabled).toBe(true);
        await type(field("url"), "example.com");
        expect(button()?.disabled).toBe(false);
        await type(field("url"), " ");
        expect(button()?.disabled).toBe(true);

        await act(async () => choice()[2]?.click());
        expect(button()?.disabled).toBe(true);
        await act(async () => anchorRows()[0]?.click());
        expect(button()?.disabled).toBe(false);
    });

    it("stays open on a refused address and updates the error as it is edited", async () => {
        const error = () => container
            .querySelector(".edit-link-url > .input-group + .form-field-error")?.textContent;
        await open({ target: "url" });
        await type(field("url"), "javascript:alert(1)");
        expect(error()).toBeUndefined();
        await act(async () => {
            container.querySelector("form")
                ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        expect(field("url")).not.toBeNull();
        expect(error()).toBe("add_link.javascript_not_allowed");

        await type(field("url"), "exa mple.com");
        expect(error()).toBe("add_link.invalid_url");
        await type(field("url"), "example.com");
        expect(error()).toBeUndefined();
        await submit();
        expect(addLink)
            .toHaveBeenCalledExactlyOnceWith("https://example.com", "https://example.com", true);
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
            [ "add_link.display_text", "add_link.display_icon_and_text", "add_link.display_card" ]
        );
        const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        await type(field("url"), video);
        expect(displays()).toContain("add_link.display_embed");
        await pickDisplay("cardLink");
        await type(field("text"), "Never gonna");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "cardLink", "Never gonna", null);
        expect(addLink).not.toHaveBeenCalled();

        // A player shows no title.
        await open({ target: "url", display: "embedLink", addLinkPreview });
        await type(field("url"), video);
        expect(field("text")).toBeNull();
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "embedLink", null, null);

        // A text link, and any address that is not a web page, stays a link.
        await open({ target: "url", addLinkPreview });
        await type(field("url"), "example.com");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://example.com", "https://example.com", true);
        await open({ target: "url", display: "cardLink", addLinkPreview });
        await type(field("url"), "mailto:someone@example.com");
        expect(displaySelect()?.disabled).toBe(true);
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(
            "mailto:someone@example.com", "mailto:someone@example.com", true
        );
        expect(addLinkPreview).toHaveBeenCalledTimes(2);

        // A link on a selection keeps the selected text, so it is never a preview.
        await open({
            target: "url", text: "some words", hasSelection: true, display: "cardLink",
            addLinkPreview
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
        await pickDisplay("iconAndTextLink");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "iconAndTextLink", null, null);

        await open({ currentLink: { externalLink: url }, currentTitle: "Page", addLinkPreview });
        await pickDisplay("cardLink");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "cardLink", "Page", null);
        expect(addLink).not.toHaveBeenCalled();
    });

    it("edits a link preview, giving another address the title of its own page", async () => {
        const url = "https://example.com/page";
        await open({
            currentLink: { externalLink: url }, currentTitle: "Page", display: "cardLink",
            addLinkPreview
        });
        expect(field("url")?.value).toBe(url);
        expect(field("text")?.value).toBe("Page");
        expect(displays()).toStrictEqual(
            [ "add_link.display_text", "add_link.display_icon_and_text", "add_link.display_card" ]
        );
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "cardLink", "Page", null);

        await open({
            currentLink: { externalLink: url }, currentTitle: "Page", display: "cardLink",
            addLinkPreview
        });
        await type(field("url"), "https://example.com/other");
        expect(field("text")?.value).toBe("");
        await type(field("text"), "Mine");
        await type(field("url"), "https://example.com/third");
        expect(field("text")?.value).toBe("Mine");
        await submit();
        expect(addLinkPreview)
            .toHaveBeenLastCalledWith("https://example.com/third", "cardLink", "Mine", null);

        // A text link keeps its text for another address.
        await open({ currentLink: { externalLink: url }, currentTitle: "Page", addLinkPreview });
        await type(field("url"), "https://example.com/other");
        expect(field("text")?.value).toBe("Page");
    });

    it("edits a card's description, which another address takes from its page", async () => {
        const url = "https://example.com/page";
        const preview = {
            currentLink: { externalLink: url }, currentTitle: "Page", currentDescription: "About",
            addLinkPreview
        };
        await open({ ...preview, display: "iconAndTextLink" });
        expect(description()).toBeNull();
        await pickDisplay("cardLink");
        expect(description()?.value).toBe("About");
        expect(description()?.getAttribute("rows")).toBe("2");
        const order = ".edit-link-text + .edit-link-description + .edit-link-display";
        expect(container.querySelector(order)).not.toBeNull();
        await type(description(), " Mine ");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "cardLink", "Page", "Mine");

        // An emptied description leaves the stored one, and only a card shows one.
        await open({ ...preview, display: "cardLink" });
        await type(description(), " ");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "cardLink", "Page", null);
        await open({ ...preview, display: "cardLink" });
        await pickDisplay("iconAndTextLink");
        expect(description()).toBeNull();
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(url, "iconAndTextLink", "Page", null);

        await open({ ...preview, display: "cardLink" });
        await type(field("url"), "https://example.com/other");
        expect(description()?.value).toBe("");
        // Typed after the change, even the old description stays.
        await type(description(), "About");
        await type(field("url"), "https://example.com/third");
        expect(description()?.value).toBe("About");
    });

    /** The spinner at the end of the title or the description field, if it shows one. */
    function spinner(name: "text" | "description") {
        return container.querySelector(`.edit-link-${name} .input-group > .tn-input-group-spinner`);
    }

    // Each test submits last: Bootstrap's own `hidden` event follows a submit a few timers later,
    // and closes a dialog opened again by then.
    it("fills a blank title from the page when the address is left, unless typed", async () => {
        options.set("textNoteLinkTitleRetrievalEnabled", "true");
        const slow = deferred<PageDetails | null>();
        fetchPageDetails.mockReturnValueOnce(slow.promise);
        await open({ target: "url" });
        await type(field("url"), "example.com");
        expect(fetchPageDetails).not.toHaveBeenCalled();
        await leave(field("url"));
        expect(fetchPageDetails).toHaveBeenCalledExactlyOnceWith("https://example.com");
        expect(spinner("text")?.getAttribute("title")).toBe("add_link.retrieving_from_page");
        // Typing hides the spinner, and the title typed stays.
        await type(field("text"), "Mine");
        expect(spinner("text")).toBeNull();
        slow.resolve({ title: "Example" });
        await settle();
        expect(field("text")?.value).toBe("Mine");

        // A page that cannot be read leaves the field blank.
        await open({ target: "url" });
        await type(field("url"), "unreadable.example");
        await leave(field("url"));
        expect(spinner("text")).toBeNull();
        expect(field("text")?.value).toBe("");

        // Nothing is read for an address that is not a web page, or with the option off.
        await type(field("url"), "mailto:someone@example.com");
        await leave(field("url"));
        options.set("textNoteLinkTitleRetrievalEnabled", "false");
        await type(field("url"), "example.net");
        await leave(field("url"));
        expect(fetchPageDetails).toHaveBeenCalledTimes(2);

        options.set("textNoteLinkTitleRetrievalEnabled", "true");
        const page = deferred<PageDetails | null>();
        fetchPageDetails.mockReturnValueOnce(page.promise);
        await open({ target: "url" });
        await type(field("url"), "example.com");
        await leave(field("url"));
        expect(spinner("text")).not.toBeNull();
        page.resolve({ title: "Example", description: "About" });
        await settle();
        expect(spinner("text")).toBeNull();
        expect(field("text")?.value).toBe("Example");

        // Another address takes the title of its own page.
        fetchPageDetails.mockResolvedValueOnce({ title: "Other" });
        await type(field("url"), "example.org");
        expect(field("text")?.value).toBe("");
        await leave(field("url"));
        expect(field("text")?.value).toBe("Other");
        await nextFrame();
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://example.org", "Other", true);
    });

    it("fills a preview's blank title and description, reading each page once", async () => {
        // A preview follows its own option, which a text link does not.
        options.set("textNoteLinkDetailsRetrievalEnabled", "true");
        const page = deferred<PageDetails | null>();
        fetchPageDetails.mockReturnValueOnce(page.promise);
        await open({ target: "url", addLinkPreview });
        await type(field("url"), "example.com");
        await leave(field("url"));
        expect(fetchPageDetails).not.toHaveBeenCalled();
        await pickDisplay("cardLink");
        await settle();
        expect(fetchPageDetails).toHaveBeenCalledOnce();
        expect([ spinner("text"), spinner("description") ]).not.toContain(null);
        page.resolve({ title: "Example", description: "About" });
        await settle();
        expect([ spinner("text"), spinner("description") ]).toStrictEqual([ null, null ]);
        expect([ field("text")?.value, description()?.value ])
            .toStrictEqual([ "Example", "About" ]);

        options.set("textNoteLinkDetailsRetrievalEnabled", "false");
        await open({ target: "url", display: "iconAndTextLink", addLinkPreview });
        await type(field("url"), "example.com");
        await leave(field("url"));
        await pickDisplay("cardLink");
        await settle();
        expect(fetchPageDetails).toHaveBeenCalledOnce();

        options.set("textNoteLinkTitleRetrievalEnabled", "true");
        options.set("textNoteLinkDetailsRetrievalEnabled", "true");
        fetchPageDetails.mockResolvedValue({ title: "Example", description: "About" });
        await open({ target: "url", addLinkPreview });
        await type(field("url"), "example.com");
        await leave(field("url"));
        expect(field("text")?.value).toBe("Example");
        await pickDisplay("cardLink");
        await settle();
        expect(description()?.value).toBe("About");
        expect(fetchPageDetails).toHaveBeenCalledTimes(2);
        await nextFrame();
        await submit();
        expect(addLinkPreview)
            .toHaveBeenLastCalledWith("https://example.com", "cardLink", "Example", "About");
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
        expect(titleCard?.nextElementSibling?.matches(".edit-link-targets")).toBe(true);
        expect(titleCard?.nextElementSibling?.firstElementChild?.matches(".edit-link-anchors"))
            .toBe(true);
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

        // With neither headings nor anchors, a placeholder takes the place of the page.
        await open({ anchors: [], headings: [] });
        await act(async () => choice()[2]?.click());
        expect(headings()).toStrictEqual([]);
        expect(field("text")).toBeNull();
        expect(container.querySelector(".no-items")?.textContent)
            .toBe("add_link.no_headings_or_anchors");
        expect(container.querySelector(".no-items .bx-bookmark")).not.toBeNull();
    });

    it("lists the headings as a tree above the anchors, and links one mirroring it", async () => {
        const intro = createHeading("Intro", 2);
        const linux = createHeading("Linux", 4);
        await open({
            anchors: [ "top" ],
            headings: [ intro, createHeading("Setup", 3), linux, createHeading("Usage", 2) ]
        });
        await act(async () => choice()[2]?.click());
        expect(headings()).toStrictEqual([ "add_link.headings", "add_link.target_anchor" ]);
        expect(container.querySelector(".edit-link-targets")?.firstElementChild
            ?.matches(".edit-link-headings")).toBe(true);
        // Sub-headings start collapsed.
        expect(headingRows().map((row) => row.textContent)).toStrictEqual([ "Intro", "Usage" ]);
        await toggleHeading(0);
        expect(headingRows().map((row) => row.textContent))
            .toStrictEqual([ "Intro", "Setup", "Usage" ]);
        await toggleHeading(1);
        expect(headingRows().map((row) => [
            row.textContent,
            row.getAttribute("style") ?? "",
            !!row.querySelector(".tn-card-choice-icon.bx-heading"),
            row.querySelector(".tn-card-choice-expander-empty") !== null
        ])).toStrictEqual([
            [ "Intro", "", true, false ],
            [ "Setup", "--tn-card-section-nesting-level: 1;", true, false ],
            [ "Linux", "--tn-card-section-nesting-level: 2;", true, true ],
            [ "Usage", "", true, true ]
        ]);

        await toggleHeading(0);
        expect(headingRows().map((row) => row.textContent)).toStrictEqual([ "Intro", "Usage" ]);
        expect(checkedHeading()).toBeUndefined();
        await toggleHeading(0);
        expect(headingRows()).toHaveLength(4);

        await act(async () => headingRows()[2]?.click());
        expect(checkedHeading()).toBe("Linux");
        expect(field("text")?.placeholder).toBe("add_link.title_from_heading");
        // A heading and an anchor are one choice.
        await act(async () => anchorRows()[0]?.click());
        expect([ checkedHeading(), checkedAnchor() ]).toStrictEqual([ undefined, "top" ]);
        await act(async () => headingRows()[2]?.click());
        expect([ checkedHeading(), checkedAnchor() ]).toStrictEqual([ "Linux", undefined ]);
        expect(linux.createLinkPath).not.toHaveBeenCalled();
        await submit();
        expect(linux.createLinkPath).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenLastCalledWith("root/note?block=Linux", null);

        await open({ headings: [ intro ] });
        await act(async () => choice()[2]?.click());
        await act(async () => headingRows()[0]?.click());
        await type(field("text"), " Read the intro ");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("root/note?block=Intro", "Read the intro");

        // A selection keeps its text, and a selection without one takes the heading's.
        for (const [ text, title ] of [ [ "some words", "some words" ], [ "", "Intro" ] ]) {
            await open({ text, hasSelection: true, headings: [ intro ] });
            await act(async () => choice()[2]?.click());
            await act(async () => headingRows()[0]?.click());
            await submit();
            expect(addLink).toHaveBeenLastCalledWith("root/note?block=Intro", title);
        }
    });

    it("opens an edited heading link on its heading, scrolled to the middle of the list", async () => {
        // The checked row is 400px below the top of the list until the list scrolls.
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
            this: Element
        ) {
            const list = this.closest(".edit-link-targets");
            const isChecked = this.getAttribute("aria-checked") === "true";
            return { top: isChecked ? 400 - (list?.scrollTop ?? 0) : 0 } as DOMRect;
        });
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
        vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(640);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
        onTestFinished(() => {
            vi.restoreAllMocks();
        });

        const usage = createHeading("Usage", 2);
        await open({
            anchors: [], headings: [ createHeading("Intro", 2), usage ], currentHeading: usage,
            currentTitle: "See usage"
        });
        expect(container.querySelector(".modal-title")?.textContent).toBe("add_link.edit_link");
        expect(current()).toBe("add_link.anchors");
        // A list without items has no card.
        expect(headings()).toStrictEqual([ "add_link.headings" ]);
        expect(checkedHeading()).toBe("Usage");
        expect(field("text")?.value).toBe("See usage");
        const list = container.querySelector(".edit-link-targets");
        expect(list?.scrollTop).toBe(300);
        // Rows lie past both edges of the list, so both edges fade.
        expect([ "scroll-fade", "scroll-fade-start", "scroll-fade-end" ]
            .map((name) => list?.classList.contains(name))).toStrictEqual([ true, true, true ]);
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("root/note?block=Usage", "See usage");

        // A link that mirrors its heading opens with no title, and keeps mirroring it.
        await open({ anchors: [], headings: [ usage ], currentHeading: usage });
        expect(field("text")?.value).toBe("");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("root/note?block=Usage", null);

        // A sub-heading opens with the headings above it expanded, and no others.
        const linux = createHeading("Linux", 4);
        await open({
            anchors: [],
            headings: [
                createHeading("Intro", 2), createHeading("Setup", 3), linux,
                createHeading("Usage", 2), createHeading("Examples", 3)
            ],
            currentHeading: linux
        });
        expect(headingRows().map((row) => row.textContent))
            .toStrictEqual([ "Intro", "Setup", "Linux", "Usage" ]);
        expect(checkedHeading()).toBe("Linux");
        // Scrolled by `fillAndFocus()`, once Bootstrap reports the dialog shown.
        await vi.waitFor(() => {
            expect(container.querySelector(".edit-link-targets")?.scrollTop).toBe(300);
        });
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

        const button = form.querySelector<HTMLButtonElement>(".edit-link-actions button");
        expect(button?.disabled).toBe(true);
        await submit(form);
        expect(onClose).not.toHaveBeenCalled();

        await type(url, "example.com");
        expect(button?.disabled).toBe(false);
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

    it("pastes the clipboard over the address, selects it and applies it", async () => {
        readClipboardText.mockResolvedValue("example.com/pasted");
        const form = await show({ target: "url" });
        // The effect calling `canReadClipboardText()` runs as the first `act()` ends.
        await settle();
        const url = form.querySelector<HTMLInputElement>(".edit-link-url input");
        const button = form.querySelector<HTMLButtonElement>(".edit-link-url .bx-paste");
        if (!url || !button) throw new Error("The address has no paste button.");
        expect(form.querySelector(".edit-link-url label")?.getAttribute("for")).toBe(url.id);

        await type(url, "typed");
        button.click();
        await settle();
        expect(url.value).toBe("example.com/pasted");
        expect([ url.selectionStart, url.selectionEnd ]).toStrictEqual([ 0, url.value.length ]);

        await submit(form);
        expect(addLink).toHaveBeenCalledExactlyOnceWith(
            "https://example.com/pasted", "https://example.com/pasted", true
        );
    });

    it("fills the title from the page of an address pasted with the button", async () => {
        options.set("textNoteLinkTitleRetrievalEnabled", "true");
        fetchPageDetails.mockResolvedValue({ title: "Pasted" });
        readClipboardText.mockResolvedValue("example.com/pasted");
        const form = await show({ target: "url" });
        await settle();
        const url = form.querySelector<HTMLInputElement>(".edit-link-url input");
        const title = form.querySelector<HTMLInputElement>(".edit-link-text input");
        form.querySelector<HTMLButtonElement>(".edit-link-url .bx-paste")?.click();
        await vi.waitFor(() => expect(title?.value).toBe("Pasted"));
        expect(fetchPageDetails).toHaveBeenCalledExactlyOnceWith("https://example.com/pasted");
        expect(document.activeElement).toBe(url);
        expect(form.querySelector(".edit-link-text label")?.getAttribute("for")).toBe(title?.id);
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

    it("refuses an invalid address on submit and focuses its field", async () => {
        const form = await show({ target: "url" });
        const url = form.querySelector<HTMLInputElement>(".edit-link-url input");
        await type(url, "exa mple.com");
        await act(async () => url?.blur());
        expect(document.activeElement).not.toBe(url);
        await submit(form);
        expect(form.querySelector(".edit-link-url .form-field-error")?.textContent)
            .toBe("add_link.invalid_url");
        expect(document.activeElement).toBe(url);
        expect(onClose).not.toHaveBeenCalled();
        expect(addLink).not.toHaveBeenCalled();
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

    it("applies a card on Enter in its description, but not mid-composition", async () => {
        const addLinkPreview = vi.fn<NonNullable<EditLinkOpts["addLinkPreview"]>>(async () => {});
        const form = await show({ target: "url", display: "cardLink", addLinkPreview });
        await type(form.querySelector<HTMLInputElement>(".edit-link-url input"), "example.com");
        const textarea = form.querySelector<HTMLTextAreaElement>(".edit-link-description textarea");
        await type(textarea, "About");

        async function pressEnter(isComposing: boolean) {
            const enter = new KeyboardEvent("keydown", {
                key: "Enter", isComposing, bubbles: true, cancelable: true
            });
            await act(async () => {
                textarea?.dispatchEvent(enter);
            });
            return enter.defaultPrevented;
        }
        expect(await pressEnter(true)).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        expect(await pressEnter(false)).toBe(true);
        expect(onClose).toHaveBeenCalledOnce();
        expect(addLinkPreview)
            .toHaveBeenCalledExactlyOnceWith("https://example.com", "cardLink", null, "About");
    });
});

function createHeading(title: string, level: number) {
    return {
        title,
        level,
        createLinkPath: vi.fn(() => `root/note?block=${title}`)
    } satisfies LinkHeading;
}

async function type(input: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
    if (!input) throw new Error("The field is not shown.");
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Moves the focus out of `input`, and waits for what that sets off. */
async function leave(input: HTMLInputElement | null) {
    if (!input) throw new Error("The field is not shown.");
    await act(async () => {
        // Preact listens for the bubbling `focusout` in place of `blur`.
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    await settle();
}

/**
 * Waits a frame, so that the effects of a render outside `act()` have run, as they have before
 * any real submit. `Modal` registers the `onHidden` of each render in such an effect.
 */
function nextFrame() {
    return act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    });
}

/** A promise, with the function that resolves it. */
function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

/** Waits a task, so that what a pending promise renders is in the DOM. */
function settle() {
    return act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}

import type {
    CreateReferenceResponse, NoteReferencesResponse, ReferenceTarget
} from "@triliumnext/commons";
import { Modal as BootstrapModal } from "bootstrap";
import { type RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, type MockInstance, onTestFinished, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type { PageDetails } from "../../services/link_embed";
import type { LinkTarget } from "../../services/link_targets";
import type { Suggestion } from "../../services/note_autocomplete";
import options from "../../services/options";
import server from "../../services/server";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import Modal from "../react/Modal";
import type { NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import { ParentComponent } from "../react/react_utils";
import EditLinkDialog, {
    EditLinkBalloon, type EditLinkOpts, getShownDisplay, getWebLinkError, normalizeWebLink
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
    default: ({ onChange, inputRef, handleRef }: {
        onChange: (suggestion: Suggestion | null) => void;
        inputRef?: RefObject<HTMLInputElement>;
        handleRef?: RefObject<NoteAutocompleteHandle | null>;
    }) => {
        autocomplete.onChange = onChange;
        if (handleRef) {
            handleRef.current = {
                showRecentNotes: vi.fn(),
                showAllCommands: vi.fn(),
                setText(text, selectedPath = "") {
                    if (!inputRef?.current) return;
                    inputRef.current.value = text;
                    inputRef.current.dataset.notePath = selectedPath;
                },
                clear: vi.fn(),
                focus: () => inputRef?.current?.focus()
            };
        }
        return <input ref={inputRef} className="note-autocomplete" />;
    }
}));

/** What `GET notes/:noteId/references` answers, by note id. A note not listed has nothing. */
const noteReferences = new Map<string, NoteReferencesResponse | Promise<NoteReferencesResponse>>();
const { get: serverGet } = server;
let createHeadingReference: MockInstance<typeof server.postWithSilentErrors>;

beforeEach(() => {
    fetchPageDetails.mockReset();
    options.set("textNoteLinkTitleRetrievalEnabled", "false");
    options.set("textNoteLinkDetailsRetrievalEnabled", "false");

    noteReferences.clear();
    vi.spyOn(server, "get").mockImplementation((async (url: string) => {
        const id = /^(?:notes|attachments)\/(\w+)\/references$/.exec(url)?.[1];
        if (!id) return serverGet(url);
        return noteReferences.get(id) ?? { targets: [] };
    }) as typeof server.get);
    createHeadingReference = vi.spyOn(server, "postWithSilentErrors")
        .mockResolvedValue({ params: { block: "NewId" } } satisfies CreateReferenceResponse);
});

/** A heading as the server lists it, with the block id `block` when it has one. */
function headingTarget(title: string, level: number, block?: string): ReferenceTarget {
    return block
        ? { kind: "heading", title, level, params: { block } }
        : { kind: "heading", title, level };
}

/** An anchor as the server lists it. */
function anchorTarget(name: string): ReferenceTarget {
    return { kind: "anchor", title: name, params: { bookmark: name } };
}

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
    it("refuses a link that can run code and an address that new URL() cannot parse", () => {
        const refused = "add_link.script_link_not_allowed";
        expect(getWebLinkError("https://example.com/a b")).toBeUndefined();
        expect(getWebLinkError("mailto:someone@example.com")).toBeUndefined();
        expect(getWebLinkError("javascript:alert(1)")).toBe(refused);
        expect(getWebLinkError("JavaScript:void(0)")).toBe(refused);
        // `new URL()` drops the tab, as the browser does when it follows the link.
        expect(getWebLinkError("java\tscript:alert(1)")).toBe(refused);
        expect(getWebLinkError("VBScript:msgbox(1)")).toBe(refused);
        expect(getWebLinkError("data:text/html,<script>alert(1)</script>")).toBe(refused);
        expect(getWebLinkError("https://exa mple.com")).toBe("add_link.invalid_url");
        expect(getWebLinkError("https://example.com:99999")).toBe("add_link.invalid_url");
    });

    it("takes only a web address for media", () => {
        expect(getWebLinkError("https://example.com/clip.mp4", true)).toBeUndefined();
        expect(getWebLinkError("mailto:someone@example.com", true))
            .toBe("youtube_video.not_a_video");
        expect(getWebLinkError("javascript:alert(1)", true))
            .toBe("add_link.script_link_not_allowed");
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
        // The specs dispatch `shown.bs.modal` and `hidden.bs.modal` themselves. Bootstrap's own
        // transitions end on timers, and a late `hidden.bs.modal` resets the next dialog opened.
        const show = vi.spyOn(BootstrapModal.prototype, "show").mockImplementation(() => {});
        const hide = vi.spyOn(BootstrapModal.prototype, "hide").mockImplementation(() => {});
        onTestFinished(() => {
            show.mockRestore();
            hide.mockRestore();
        });
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
        return [ ...container.querySelectorAll<HTMLElement>(
            ".link-target-anchor .tn-card-choice"
        ) ];
    }

    function checkedAnchor() {
        return anchorRows().find((row) => row.getAttribute("aria-checked") === "true")?.textContent;
    }

    function headingRows() {
        return [ ...container.querySelectorAll<HTMLElement>(
            ".link-target-heading .tn-card-choice"
        ) ];
    }

    function checkedHeading() {
        return headingRows().find((row) => row.getAttribute("aria-checked") === "true")?.textContent;
    }

    async function toggleHeading(index: number) {
        const expander = headingRows()[index]?.querySelector<HTMLElement>(".tn-card-choice-expander");
        if (!expander) throw new Error(`The heading ${index} has no expander.`);
        await act(async () => expander.click());
    }

    function button() {
        return container.querySelector<HTMLButtonElement>(".modal-footer button");
    }

    /** The box of the note page that lists where in the note picked the link can point. */
    function noteTargets() {
        return container.querySelector<HTMLElement>(".edit-link-note-targets");
    }

    function noteRows() {
        return [ ...noteTargets()?.querySelectorAll<HTMLElement>(".tn-card-choice") ?? [] ];
    }

    /** The choices of the note page, by their text, the checked one marked with a `*`. */
    function noteChoices() {
        return noteRows().map((row) => {
            const mark = row.getAttribute("aria-checked") === "true" ? "*" : "";
            return `${mark}${row.textContent}`;
        });
    }

    async function checkNoteChoice(text: string) {
        const row = noteRows().find((choice) => choice.textContent === text);
        if (!row) throw new Error(`The note page lists no '${text}'.`);
        await act(async () => row.click());
    }

    /** Picks the note at `notePath` on the note page, and waits for its headings and anchors. */
    async function pickNote(notePath: string) {
        await act(async () => autocomplete.onChange?.({ notePath }));
        await settle();
    }

    /** Submits the form without the dialog hiding, as when the link is refused. */
    async function requestSubmit() {
        await act(async () => {
            container.querySelector("form")
                ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        await settle();
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

    /** Submits a link to a heading the server gives a block id first, then hides the dialog. */
    async function submitWithReference() {
        await requestSubmit();
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("hidden.bs.modal"));
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
        await pickNote(path);
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
        const note = buildNote({ title: "Target" });
        noteReferences.set(note.noteId, { targets: [ anchorTarget("part") ] });
        const edited = {
            currentLink: { notePath: `root/${note.noteId}` }, currentTitle: "See there"
        };
        await open({ ...edited, currentBookmark: "part" });
        await settle();
        expect(noteChoices()).toStrictEqual([ "add_link.top_of_note", "*part" ]);
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

    it("edits the title of an attachment link, and lists the headings of the attachment", async () => {
        const note = buildNote({ title: "Owner" });
        await open({ currentLink: { notePath: `root/${note.noteId}` } });
        await settle();
        expect(noteChoices()).toStrictEqual([ "*add_link.top_of_note" ]);
        await submit();
        vi.mocked(server.get).mockClear();

        const path = `root/${note.noteId}?viewMode=attachments&attachmentId=abc123`;
        noteReferences.set("abc123", { targets: [
            { kind: "heading", title: "Appendix", level: 1, params: { page: "9", heading: "h1" } }
        ] });
        await open({
            currentLink: { notePath: path }, currentTitle: "The file", anchors: [ "x" ],
            noteId: note.noteId
        });
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("shown.bs.modal"));
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(choice()).toStrictEqual([]);
        expect(container.querySelector(".note-autocomplete")).toBeNull();
        await settle();
        // The targets of the attachment, never those of the document being edited.
        expect(noteChoices()).toStrictEqual([ "*add_link.top_of_note", "Appendix" ]);
        expect(server.get).toHaveBeenCalledExactlyOnceWith("attachments/abc123/references",
            undefined, false, { silentBadRequest: true, silentNotFound: true });
        expect(field("text")?.value).toBe("The file");
        expect(field("text")?.placeholder).toBe("add_link.title_from_attachment");
        expect(document.activeElement).toBe(field("text"));
        await type(field("text"), "Report");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, "Report");

        await open({ currentLink: { notePath: path }, currentTitle: "The file" });
        await type(field("text"), "");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, null);

        // A heading of the attachment adds its parameters after those of the attachment.
        await open({ currentLink: { notePath: path }, currentTitle: "The file" });
        await settle();
        await checkNoteChoice("Appendix");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`${path}&page=9&heading=h1`, "The file");
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

    it("keeps the state of each page while another is shown, and applies the page shown", async () => {
        const note = buildNote({ title: "Target" });
        noteReferences.set(note.noteId, { targets: [ anchorTarget("part") ] });
        const path = `root/${note.noteId}`;
        const noteField = () => container.querySelector<HTMLInputElement>(".note-autocomplete");

        await open({ anchors: [ "intro" ] });
        await act(async () => autocomplete.onChange?.({ notePath: path }));
        await act(async () => choice()[2]?.click());
        await act(async () => anchorRows()[0]?.click());
        await act(async () => choice()[0]?.click());
        await type(field("url"), "example.com");
        await submit();
        expect(addLink).toHaveBeenCalledExactlyOnceWith(
            "https://example.com", "https://example.com", true
        );

        await open({ anchors: [ "intro" ] });
        await pickNote(path);
        await checkNoteChoice("part");
        await type(field("text"), "Note text");

        await act(async () => choice()[0]?.click());
        expect([ field("url")?.value, field("text")?.value ]).toStrictEqual([ "", "" ]);
        // A refused address blocks only its own page.
        await type(field("url"), "exa mple.com");
        await type(field("text"), "Web text");

        await act(async () => choice()[2]?.click());
        expect([ checkedAnchor(), field("text")?.value ]).toStrictEqual([ undefined, "" ]);
        await act(async () => anchorRows()[0]?.click());
        await type(field("text"), "Anchor text");

        await act(async () => choice()[1]?.click());
        expect([ noteField()?.value, noteField()?.dataset.notePath, field("text")?.value ])
            .toStrictEqual([ "Target", path, "Note text" ]);
        expect(noteChoices()).toStrictEqual([ "add_link.top_of_note", "*part" ]);
        await act(async () => choice()[0]?.click());
        expect([ field("url")?.value, field("text")?.value ])
            .toStrictEqual([ "exa mple.com", "Web text" ]);
        await act(async () => choice()[2]?.click());
        expect([ checkedAnchor(), field("text")?.value ]).toStrictEqual([ "intro", "Anchor text" ]);

        await act(async () => choice()[1]?.click());
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`${path}?bookmark=part`, "Note text");
        expect(addLink).toHaveBeenCalledTimes(2);
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
        expect(error()).toBe("add_link.script_link_not_allowed");

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
            [ "add_link.display_plain", "add_link.display_inline", "add_link.display_card" ]
        );
        const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        await type(field("url"), video);
        expect(displays()).toContain("add_link.display_embed");
        await pickDisplay("cardLink");
        await type(field("text"), "Never gonna");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "cardLink", "Never gonna", null);
        expect(addLink).not.toHaveBeenCalled();

        // A player keeps a title, which its title row shows.
        await open({ target: "url", display: "embedLink", addLinkPreview });
        await type(field("url"), video);
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "embedLink", null, null);
        await open({ target: "url", display: "embedLink", addLinkPreview });
        await type(field("url"), video);
        await type(field("text"), "Never gonna");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "embedLink", "Never gonna", null);

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
        expect(addLinkPreview).toHaveBeenCalledTimes(3);

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
        expect(addLinkPreview).toHaveBeenCalledTimes(3);
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
            [ "add_link.display_plain", "add_link.display_inline", "add_link.display_card" ]
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

    it("edits only the address and the title of a media embed, applied as an embed", async () => {
        const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        const media = {
            currentLink: { externalLink: video }, currentTitle: "Never gonna",
            currentDescription: "About", display: "embedLink", isMedia: true, addLinkPreview
        } satisfies Partial<EditLinkOpts>;
        await open(media);
        expect(choice()).toHaveLength(0);
        expect(field("url")?.value).toBe(video);
        expect(field("text")?.value).toBe("Never gonna");
        expect([ displaySelect(), description() ]).toStrictEqual([ null, null ]);
        await type(field("text"), "Mine");
        await submit();
        expect(addLinkPreview).toHaveBeenLastCalledWith(video, "embedLink", "Mine", null);

        // Only the server tells that an address without an extension is media.
        await open(media);
        await type(field("url"), "example.com/clip");
        expect(field("text")?.value).toBe("");
        await submit();
        expect(addLinkPreview)
            .toHaveBeenLastCalledWith("https://example.com/clip", "embedLink", null, null);

        await open(media);
        await type(field("url"), "mailto:someone@example.com");
        await act(async () => {
            container.querySelector("form")
                ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        expect(container.querySelector(".edit-link-url .form-field-error")?.textContent)
            .toBe("youtube_video.not_a_video");
        expect(addLinkPreview).toHaveBeenCalledTimes(2);
        expect(addLink).not.toHaveBeenCalled();
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

    it("shows the spinner on the web page's title alone, filling it in the background", async () => {
        options.set("textNoteLinkTitleRetrievalEnabled", "true");
        const page = deferred<PageDetails | null>();
        fetchPageDetails.mockReturnValueOnce(page.promise);
        await open({ target: "url" });
        await type(field("url"), "example.com");
        await leave(field("url"));
        expect(spinner("text")).not.toBeNull();

        // The note page shares the title field, which the web page does not fill.
        await act(async () => choice()[1]?.click());
        expect(field("text")).not.toBeNull();
        expect(spinner("text")).toBeNull();
        page.resolve({ title: "Example" });
        await settle();
        expect(field("text")?.value).toBe("");

        await act(async () => choice()[0]?.click());
        expect(spinner("text")).toBeNull();
        expect(field("text")?.value).toBe("Example");
        await nextFrame();
        await submit();
        expect(addLink).toHaveBeenLastCalledWith("https://example.com", "Example", true);
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
        expect(titleCard?.nextElementSibling?.firstElementChild?.matches(".link-target-anchor"))
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
            ?.matches(".link-target-heading")).toBe(true);
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
        // Scrolled by `fillAndFocus()`, once the dialog is reported shown.
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("shown.bs.modal"));
        });
        expect(container.querySelector(".edit-link-targets")?.scrollTop).toBe(300);
    });

    it("lists where in the note picked a link can point, from the top of the note", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        const references = deferred<NoteReferencesResponse>();
        noteReferences.set(note.noteId, references.promise);

        await open();
        expect(field("text")?.closest(".tn-card")?.nextElementSibling).toBe(noteTargets());
        expect(noteTargets()?.querySelector(".no-items .bx-bookmark")).not.toBeNull();
        expect(noteTargets()?.textContent).toBe("add_link.select_note_for_targets");
        expect(server.get).not.toHaveBeenCalled();

        await pickNote(path);
        expect(server.get).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        expect(noteTargets()?.getAttribute("role")).toBe("status");
        expect(noteTargets()?.querySelector(".no-items .bx-loader.bx-spin")).not.toBeNull();
        expect(noteTargets()?.textContent).toBe("add_link.inspecting_note");
        expect(button()?.disabled).toBe(false);

        references.resolve({
            targets: [
                headingTarget("Setup", 2), headingTarget("Linux", 3, "L"),
                headingTarget("Usage", 2), anchorTarget("alpha"), anchorTarget("zeta")
            ]
        });
        await settle();
        expect(noteTargets()?.getAttribute("role")).toBeNull();
        expect(headings()).toStrictEqual([ "add_link.link_to_heading", "add_link.link_to_anchor" ]);
        expect(noteTargets()?.querySelector(".no-items")).toBeNull();
        expect(noteTargets()?.firstElementChild?.matches(".link-target-whole-note")).toBe(true);
        expect(noteTargets()?.querySelector(".link-target-whole-note .bx-arrow-to-top"))
            .not.toBeNull();
        // Sub-headings start collapsed.
        expect(noteChoices())
            .toStrictEqual([ "*add_link.top_of_note", "Setup", "Usage", "alpha", "zeta" ]);
        const expander = noteRows()[1]?.querySelector<HTMLElement>(".tn-card-choice-expander");
        await act(async () => expander?.click());
        expect(noteChoices()).toContain("Linux");

        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, null);
        expect(createHeadingReference).not.toHaveBeenCalled();
    });

    it("links a heading or an anchor of the note picked, giving a heading a block id", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, {
            targets: [
                headingTarget("Setup", 2), headingTarget("Usage", 2, "U"), anchorTarget("a b")
            ]
        });

        await open();
        await pickNote(path);
        await checkNoteChoice("Usage");
        expect(noteChoices()).toStrictEqual([ "add_link.top_of_note", "Setup", "*Usage", "a b" ]);
        expect(field("text")?.placeholder).toBe("add_link.title_from_heading");
        await submit();
        expect(createHeadingReference).not.toHaveBeenCalled();
        expect(addLink).toHaveBeenLastCalledWith(`${path}?block=U`, null);

        await open();
        await pickNote(path);
        await checkNoteChoice("Setup");
        await submitWithReference();
        expect(createHeadingReference).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`,
            { kind: "heading", index: 0, title: "Setup" }
        );
        expect(addLink).toHaveBeenLastCalledWith(`${path}?block=NewId`, null);

        await open();
        await pickNote(path);
        await checkNoteChoice("a b");
        expect(field("text")?.placeholder).toBe("add_link.title_from_note");
        await type(field("text"), "See there");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`${path}?bookmark=a%20b`, "See there");

        // A selection without text of its own takes the heading's.
        await open({ text: "", hasSelection: true });
        await pickNote(path);
        await checkNoteChoice("Usage");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`${path}?block=U`, "Usage");
        expect(createHeadingReference).toHaveBeenCalledOnce();
    });

    it("lists the note again when a heading was picked from a listing of another blob", async () => {
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        onTestFinished(() => showError.mockRestore());
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Status", 2) ], blobId: "listed"
        });

        await open();
        await pickNote(path);
        await checkNoteChoice("Status");
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Moved", 2), headingTarget("Status", 2) ], blobId: "now"
        });
        createHeadingReference.mockRejectedValueOnce(
            JSON.stringify({ reason: "listing", message: "Changed" }));
        await requestSubmit();
        await settle();

        expect(createHeadingReference).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`,
            { kind: "heading", index: 0, title: "Status", blobId: "listed" }
        );
        expect(showError).toHaveBeenCalledExactlyOnceWith("add_link.listing_changed");
        expect(addLink).not.toHaveBeenCalled();
        expect(noteChoices().map((choice) => choice.replace(/^\*/, "")))
            .toStrictEqual([ "add_link.top_of_note", "Moved", "Status" ]);
    });

    it("keeps the note page for a listing that arrives once the dialog closes", async () => {
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        onTestFinished(() => showError.mockRestore());
        const note = buildNote({ title: "Target" });
        const referencesUrl = `notes/${note.noteId}/references`;
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Status", 2) ], blobId: "listed"
        });

        await open();
        await pickNote(`root/${note.noteId}`);
        await checkNoteChoice("Status");
        const relisted = deferred<NoteReferencesResponse>();
        noteReferences.set(note.noteId, relisted.promise);
        createHeadingReference.mockRejectedValueOnce(
            JSON.stringify({ reason: "listing", message: "Changed" }));
        await requestSubmit();
        expect(showError).toHaveBeenCalledExactlyOnceWith("add_link.listing_changed");
        expect(vi.mocked(server.get).mock.calls.filter(([ url ]) => url === referencesUrl))
            .toHaveLength(2);

        const modal = container.querySelector(".modal");
        expect(modal).not.toBeNull();
        await act(async () => {
            modal?.dispatchEvent(new Event("hide.bs.modal"));
        });
        relisted.resolve({
            targets: [ headingTarget("Moved", 2), headingTarget("Status", 2) ], blobId: "now"
        });
        await settle();

        expect(noteChoices()).toStrictEqual([ "add_link.top_of_note", "*Status" ]);
        expect(addLink).not.toHaveBeenCalled();
    });

    it("stays open with a toast when the heading's block id cannot be created", async () => {
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        onTestFinished(() => {
            showError.mockRestore();
            consoleError.mockRestore();
        });
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Setup", 2) ]
        });

        await open();
        await pickNote(path);
        await checkNoteChoice("Setup");
        const created = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(created.promise);
        await requestSubmit();
        expect(button()?.disabled).toBe(true);
        // Another submit while the server works sends nothing more.
        await requestSubmit();
        expect(createHeadingReference).toHaveBeenCalledOnce();

        created.reject("{\"message\":\"The headings changed\"}");
        await settle();
        expect(showError).toHaveBeenCalledExactlyOnceWith("add_link.heading_reference_failed");
        expect(addLink).not.toHaveBeenCalled();
        expect(noteChoices()).toStrictEqual([ "add_link.top_of_note", "*Setup" ]);
        expect(button()?.disabled).toBe(false);

        await submitWithReference();
        expect(createHeadingReference).toHaveBeenCalledTimes(2);
        expect(addLink).toHaveBeenCalledExactlyOnceWith(`${path}?block=NewId`, null);

        // A dialog closed while the server works applies nothing, then or when it next closes.
        const late = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(late.promise);
        await open();
        await pickNote(path);
        await checkNoteChoice("Setup");
        await requestSubmit();
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("hidden.bs.modal"));
        });
        late.resolve({ params: { block: "Late" } });
        await settle();
        await open();
        await pickNote(path);
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("hidden.bs.modal"));
        });
        expect(addLink).toHaveBeenCalledOnce();
        expect(showError).toHaveBeenCalledOnce();

        // Nor does one whose server answers while it fades out.
        const fading = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(fading.promise);
        await open();
        await pickNote(path);
        await checkNoteChoice("Setup");
        await requestSubmit();
        const modal = container.querySelector(".modal");
        await act(async () => {
            modal?.dispatchEvent(new Event("hide.bs.modal"));
        });
        fading.resolve({ params: { block: "Fading" } });
        await settle();
        await act(async () => {
            modal?.dispatchEvent(new Event("hidden.bs.modal"));
        });
        expect(createHeadingReference).toHaveBeenCalledTimes(4);
        expect(addLink).toHaveBeenCalledOnce();
    });

    it("has the editors of the note save before the heading gets its block id", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Setup", 2) ]
        });
        const saved = deferred<void>();
        const { triggerEvent } = appContext;
        let saveCount = 0;
        const trigger = vi.spyOn(appContext, "triggerEvent").mockImplementation(((name, data) => {
            // The editors save before the listing, and again before the reference.
            if (name === "saveNoteChanges") {
                return ++saveCount === 1 ? Promise.resolve() : saved.promise;
            }
            return triggerEvent.call(appContext, name, data);
        }) as typeof appContext.triggerEvent);
        onTestFinished(() => trigger.mockRestore());

        await open();
        await pickNote(path);
        expect(trigger).toHaveBeenCalledWith("saveNoteChanges", { noteId: note.noteId });
        expect(saveCount).toBe(1);
        await checkNoteChoice("Setup");
        await requestSubmit();
        expect(saveCount).toBe(2);
        expect(createHeadingReference).not.toHaveBeenCalled();

        saved.resolve();
        await settle();
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("hidden.bs.modal"));
        });
        expect(createHeadingReference).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenCalledExactlyOnceWith(`${path}?block=NewId`, null);
    });

    it("applies the heading submitted, though another is checked while it waits", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Setup", 2), headingTarget("Usage", 2) ]
        });

        await open();
        await pickNote(path);
        await checkNoteChoice("Setup");
        const created = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(created.promise);
        await requestSubmit();
        await checkNoteChoice("Usage");
        created.resolve({ params: { block: "SetupId" } });
        await settle();
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("hidden.bs.modal"));
        });
        expect(createHeadingReference).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`,
            { kind: "heading", index: 0, title: "Setup" }
        );
        expect(addLink).toHaveBeenCalledExactlyOnceWith(`${path}?block=SetupId`, null);
    });

    it("lists the editor's headings and anchors when the edited note is picked", async () => {
        const note = buildNote({ title: "Here" });
        const intro = createHeading("Intro", 2);
        await open({ noteId: note.noteId, headings: [ intro ], anchors: [ "top" ] });
        await pickNote(`root/${note.noteId}`);
        expect(server.get).not.toHaveBeenCalled();
        expect(noteChoices()).toStrictEqual([ "*add_link.top_of_note", "Intro", "top" ]);

        await checkNoteChoice("Intro");
        await submit();
        expect(createHeadingReference).not.toHaveBeenCalled();
        expect(intro.createLinkPath).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenLastCalledWith("root/note?block=Intro", null);
    });

    it("opens an edited link on its heading or anchor, keeping a target not listed", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, new Promise(() => {}));
        // Saved before the list arrives, the link keeps its heading.
        await open({ currentLink: { notePath: `${path}?block=L` } });
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`${path}?block=L`, null);

        noteReferences.set(note.noteId, {
            targets: [
                headingTarget("Setup", 2), headingTarget("Linux", 3, "L"),
                headingTarget("Usage", 2), anchorTarget("part")
            ]
        });
        // The headings above the heading of the link are expanded.
        await open({ currentLink: { notePath: `${path}?block=L` } });
        await settle();
        expect(noteChoices())
            .toStrictEqual([ "add_link.top_of_note", "Setup", "*Linux", "Usage", "part" ]);
        expect(field("text")?.placeholder).toBe("add_link.title_from_heading");
        await checkNoteChoice("add_link.top_of_note");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(path, null);

        await open({ currentLink: { notePath: path }, currentBookmark: "part" });
        await settle();
        expect(noteChoices()).toContain("*part");
        await submit();
        expect(addLink).toHaveBeenLastCalledWith(`${path}?bookmark=part`, null);

        // A link to a block that is not a heading, or to a range of blocks, checks nothing.
        for (const block of [ "P", "L:P" ]) {
            await open({ currentLink: { notePath: `${path}?block=${block}` } });
            await settle();
            expect(noteChoices().filter((choice) => choice.startsWith("*"))).toStrictEqual([]);
            await submit();
            expect(addLink).toHaveBeenLastCalledWith(`${path}?block=${block}`, null);
        }
        expect(createHeadingReference).not.toHaveBeenCalled();
    });

    it("reads the list again for another note, asking nothing of a protected note", async () => {
        const first = buildNote({ title: "First" });
        const second = buildNote({ title: "Second" });
        const firstReferences = deferred<NoteReferencesResponse>();
        noteReferences.set(first.noteId, firstReferences.promise);
        noteReferences.set(second.noteId, {
            targets: [ headingTarget("Second heading", 2) ]
        });

        await open();
        await pickNote(`root/${first.noteId}`);
        await pickNote(`root/${second.noteId}`);
        await checkNoteChoice("Second heading");
        // The list of the first note, arriving late, does not replace it.
        firstReferences.resolve({
            targets: [ headingTarget("First heading", 2) ]
        });
        await settle();
        expect(noteChoices()).toStrictEqual([ "add_link.top_of_note", "*Second heading" ]);

        await act(async () => autocomplete.onChange?.({ notePath: `root/${first.noteId}` }));
        expect(noteTargets()?.textContent).toBe("add_link.inspecting_note");
        await settle();
        expect(noteChoices()).toStrictEqual([ "*add_link.top_of_note", "First heading" ]);

        // The server lists nothing for a note type without targets.
        vi.mocked(server.get).mockClear();
        const code = buildNote({ title: "Code", type: "code" });
        const secret = buildNote({ title: "Secret" });
        secret.isProtected = true;
        for (const other of [ code, secret ]) {
            await pickNote(`root/${other.noteId}`);
            expect(noteChoices()).toStrictEqual([ "*add_link.top_of_note" ]);
            // A placeholder takes the place of the headings and anchors.
            const placeholder = noteTargets()?.querySelector(".link-target-whole-note + .no-items");
            expect(placeholder?.textContent).toBe("add_link.no_link_targets");
            expect(placeholder?.querySelector(".bx-bookmark")).not.toBeNull();
        }
        expect(server.get).toHaveBeenCalledExactlyOnceWith(
            `notes/${code.noteId}/references`, undefined, false, { silentBadRequest: true }
        );
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

        const row = form.querySelector<HTMLElement>(".link-target-anchor .tn-card-choice");
        await act(async () => row?.click());
        await submit(form);
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(addLink).toHaveBeenLastCalledWith("#intro", "intro", true);
    });

    it("creates a heading's block id before closing, and applies nothing once closed", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        noteReferences.set(note.noteId, {
            targets: [ headingTarget("Setup", 2) ]
        });

        async function showOnHeading() {
            const form = await show({ currentLink: { notePath: path } });
            await settle();
            const rows = form.querySelectorAll<HTMLElement>(
                ".edit-link-note-targets .tn-card-choice"
            );
            const row = [ ...rows ].find((choice) => choice.textContent === "Setup");
            if (!row) throw new Error("The note page lists no heading.");
            await act(async () => row.click());
            return form;
        }

        async function close(form: HTMLFormElement) {
            const container = form.parentElement;
            if (!container) throw new Error("The balloon is not rendered.");
            await act(async () => render(null, container));
        }

        const form = await showOnHeading();
        const created = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(created.promise);
        await submit(form);
        expect(onClose).not.toHaveBeenCalled();
        expect(form.querySelector<HTMLButtonElement>(".edit-link-actions button")?.disabled)
            .toBe(true);
        await submit(form);
        expect(createHeadingReference).toHaveBeenCalledOnce();
        created.resolve({ params: { block: "NewId" } });
        await settle();
        expect(onClose).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenCalledExactlyOnceWith(`${path}?block=NewId`, null);

        const closed = await showOnHeading();
        const late = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(late.promise);
        await submit(closed);
        await close(closed);
        late.resolve({ params: { block: "Late" } });
        await settle();
        expect(onClose).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenCalledOnce();

        // A server that fails once the balloon is closed shows no error.
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        onTestFinished(() => {
            showError.mockRestore();
            consoleError.mockRestore();
        });
        const failing = await showOnHeading();
        const failed = deferred<CreateReferenceResponse>();
        createHeadingReference.mockReturnValueOnce(failed.promise);
        await submit(failing);
        await close(failing);
        failed.reject("{\"message\":\"Gone\"}");
        await settle();
        expect(createHeadingReference).toHaveBeenCalledTimes(3);
        expect(showError).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(addLink).toHaveBeenCalledOnce();
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
        kind: "heading",
        title,
        level,
        createLinkPath: vi.fn(() => `root/note?block=${title}`)
    } satisfies LinkTarget;
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
 * Waits until the effects of a render outside `act()` have run, as they have before any real
 * submit. `Modal` registers the `onHidden` of each render in such an effect, which Preact runs in a
 * timeout it sets from the next frame.
 */
function nextFrame() {
    return act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => setTimeout(resolve));
    });
}

/** A promise, with the functions that settle it. */
function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

/** Waits a task, so that what a pending promise renders is in the DOM. */
function settle() {
    return act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}

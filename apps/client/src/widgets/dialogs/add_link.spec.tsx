import type { RefObject } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type { Suggestion } from "../../services/note_autocomplete";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import Modal from "../react/Modal";
import { ParentComponent } from "../react/react_utils";
import AddLinkDialog, { AddLinkBalloon, type AddLinkOpts, normalizeWebLink } from "./add_link";

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

describe("AddLinkDialog", () => {
    let host: Component;
    let container: HTMLElement;
    const addLink = vi.fn<AddLinkOpts["addLink"]>(async () => {});

    beforeEach(() => {
        vi.clearAllMocks();
        autocomplete.onChange = undefined;
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <AddLinkDialog />
            </ParentComponent.Provider>
        );
    });

    async function open(opts: Partial<AddLinkOpts> = {}) {
        await act(async () => {
            void host.handleEventInChildren("showAddLinkDialog", {
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
        return container.querySelector<HTMLInputElement>(".add-link-mirror input.switch-toggle");
    }

    /** Whether the row of the field is indented under the row it depends on. */
    function nested(name: "url" | "text") {
        return container.querySelector(`.add-link-${name}`)?.classList.contains("tn-card-section-nested");
    }

    /** The rows that put their control under the label rather than beside it. */
    function stacked() {
        return [ ...container.querySelectorAll(".tn-card-option-stacked") ];
    }

    function field(name: "url" | "text") {
        return container.querySelector<HTMLInputElement>(`.add-link-${name} input`);
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
        expect(nested("text")).toBe(true);
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
                    <AddLinkDialog />
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

    it("offers no web link when fixing a link to a missing note", async () => {
        await open({ text: "Gone", fixLink: true });
        expect(choice()).toStrictEqual([]);
        expect(container.querySelector(".note-autocomplete")).not.toBeNull();
    });
});

describe("AddLinkBalloon", () => {
    const addLink = vi.fn<AddLinkOpts["addLink"]>(async () => {});
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function show(opts: Partial<AddLinkOpts> = {}) {
        const rendered: { container?: HTMLElement } = {};
        await act(async () => {
            rendered.container = renderInto(
                <AddLinkBalloon
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
        const url = form.querySelector<HTMLInputElement>(".add-link-url input");
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
        expect(document.activeElement).toBe(form.querySelector(".add-link-url input"));
    });

    it("opens on an edited link with its address selected, and applies it left alone", async () => {
        const form = await show({
            currentLink: { externalLink: "https://example.com/page" }, currentTitle: "Page"
        });
        const url = form.querySelector<HTMLInputElement>(".add-link-url input");
        expect(url?.value).toBe("https://example.com/page");
        expect([ url?.selectionStart, url?.selectionEnd ]).toStrictEqual([ 0, url?.value.length ]);

        await submit(form);
        expect(onClose).toHaveBeenCalledOnce();
        expect(addLink).toHaveBeenCalledExactlyOnceWith("https://example.com/page", "Page", true);
    });
});

async function type(input: HTMLInputElement | null, value: string) {
    if (!input) throw new Error("The field is not shown.");
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flush, renderComponent } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real bootstrap Modal/Tooltip machinery does not behave under happy-dom; provide inert stubs.
// (Kept local: the dialog's Modal uses BootstrapModal.getOrCreateInstance, which the shared
// bootstrapMock does not provide.)
vi.mock("bootstrap", () => {
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        dispose() {}
    }
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// openDialog resolves with a jQuery-wrapped element; the Modal effect calls `.then(...)` on it.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($el: JQuery<HTMLElement>) => $el)
}));

// link_embed.fetchMetadata performs a server.get; stub the whole service so the dialog never hits
// the (throwing) mock server. The default export carries fetchMetadata used by the dialog.
// The factory is hoisted, so the mock fn is created inside it and captured after import.
vi.mock("../../services/link_embed", () => {
    const fetchMetadataMock = vi.fn(async (url: string) => ({ url, embedType: "opengraph", title: url }));
    return { default: { fetchMetadata: fetchMetadataMock }, fetchMetadata: fetchMetadataMock };
});

import type Component from "../../components/component";
import linkEmbedService from "../../services/link_embed";
import LinkEmbedDialog from "./link_embed";
import type { CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";

const fetchMetadata = vi.mocked(linkEmbedService.fetchMetadata);

// --- Render harness for the full dialog -----------------------------------------------------------

let parent: Component | undefined;

function renderDialog() {
    const result = renderComponent(<LinkEmbedDialog />);
    parent = result.parent;
    return result.container;
}

/** Dispatch a DOM event inside `act` without leaking the boolean return value (typing). */
function dispatch(el: EventTarget | null | undefined, event: Event) {
    if (!el) return;
    act(() => { el.dispatchEvent(event); });
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent?.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

function getModal(root: HTMLElement) {
    return root.querySelector(".modal.link-embed-dialog");
}

function getUrlInput(root: HTMLElement) {
    return root.querySelector<HTMLInputElement>("input[type='url']");
}

function typeUrl(root: HTMLElement, value: string) {
    const input = getUrlInput(root);
    if (input) {
        input.value = value;
        dispatch(input, new Event("input", { bubbles: true }));
    }
    return input;
}

/** The three paste-mode buttons live inside `.btn-group`, labelled @ Mention / URL / Embed. */
function getModeButtons(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLButtonElement>(".btn-group button"));
}

function clickMode(root: HTMLElement, label: "@ Mention" | "URL" | "Embed") {
    const button = getModeButtons(root).find((b) => b.textContent === label);
    if (button) {
        act(() => button.click());
    }
    return button;
}

function submitForm(root: HTMLElement) {
    dispatch(root.querySelector("form"), new Event("submit", { bubbles: true, cancelable: true }));
}

function makeEditorApi(overrides: Partial<CKEditorApi> = {}): CKEditorApi {
    return {
        hasSelection: vi.fn(() => false),
        getSelectedText: vi.fn(() => ""),
        addLink: vi.fn(),
        addLinkToEditor: vi.fn(),
        addHtmlToEditor: vi.fn(),
        addIncludeNote: vi.fn(),
        addImage: vi.fn(async () => undefined),
        addLinkEmbed: vi.fn(),
        addLinkMention: vi.fn(),
        ...overrides
    };
}

/** Open the dialog by firing the Trilium command the widget subscribes to. */
function openDialog(editorApi: CKEditorApi) {
    fireEvent("showLinkEmbedDialog", { editorApi });
}

beforeEach(() => {
    parent = undefined;
    vi.clearAllMocks();
    fetchMetadata.mockImplementation(async (url: string) => ({ url, embedType: "opengraph", title: url }));
});

// --- Tests ----------------------------------------------------------------------------------------

describe("LinkEmbedDialog", () => {
    it("renders the modal shell hidden initially (no dialog body)", () => {
        const root = renderDialog();
        const modal = getModal(root);
        expect(modal).not.toBeNull();
        // show=false -> the inner .modal-dialog is not rendered.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(getUrlInput(root)).toBeNull();
    });

    it("opens on showLinkEmbedDialog: shows body, empty URL input, and three mode buttons (embed default)", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        const input = getUrlInput(root);
        expect(input).not.toBeNull();
        expect(input?.value).toBe("");

        const buttons = getModeButtons(root);
        expect(buttons.map((b) => b.textContent)).toEqual([ "@ Mention", "URL", "Embed" ]);
        // "embed" is the default mode -> the Embed button is primary, the others outlined.
        const embed = buttons.find((b) => b.textContent === "Embed");
        expect(embed?.className).toContain("btn-primary");
        expect(buttons.filter((b) => b.className.includes("btn-outline-secondary")).length).toBe(2);
    });

    it("typing into the URL field updates the controlled value", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        const input = typeUrl(root, "https://example.com");
        expect(input?.value).toBe("https://example.com");
    });

    it("clicking a mode button selects it (primary highlight moves)", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        const mention = clickMode(root, "@ Mention");
        expect(mention?.className).toContain("btn-primary");
        // The previously-default Embed button is no longer primary.
        const embed = getModeButtons(root).find((b) => b.textContent === "Embed");
        expect(embed?.className).toContain("btn-outline-secondary");

        // Switching to URL moves the highlight again.
        clickMode(root, "URL");
        const url = getModeButtons(root).find((b) => b.textContent === "URL");
        expect(url?.className).toContain("btn-primary");
    });

    it("submitting in url mode inserts the link directly without fetching metadata", async () => {
        const editorApi = makeEditorApi();
        const root = renderDialog();
        openDialog(editorApi);

        typeUrl(root, "  https://direct.test  ");
        clickMode(root, "URL");
        submitForm(root);
        await flush();

        // URL is trimmed and passed as both href and title; no metadata fetch.
        expect(editorApi.addLinkToEditor).toHaveBeenCalledWith("https://direct.test", "https://direct.test");
        expect(fetchMetadata).not.toHaveBeenCalled();
        expect(editorApi.addLinkEmbed).not.toHaveBeenCalled();
        expect(editorApi.addLinkMention).not.toHaveBeenCalled();
        // Dialog hides after a successful submit.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("submitting in embed mode (default) fetches metadata and inserts an embed", async () => {
        const editorApi = makeEditorApi();
        const meta = { url: "https://embed.test", embedType: "opengraph", title: "Embed" };
        fetchMetadata.mockResolvedValue(meta);

        const root = renderDialog();
        openDialog(editorApi);
        typeUrl(root, "https://embed.test");
        submitForm(root);
        await flush();

        expect(fetchMetadata).toHaveBeenCalledWith("https://embed.test");
        expect(editorApi.addLinkEmbed).toHaveBeenCalledWith(meta);
        expect(editorApi.addLinkMention).not.toHaveBeenCalled();
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("submitting in mention mode fetches metadata and inserts a mention", async () => {
        const editorApi = makeEditorApi();
        const meta = { url: "https://mention.test", embedType: "opengraph", title: "Mention" };
        fetchMetadata.mockResolvedValue(meta);

        const root = renderDialog();
        openDialog(editorApi);
        typeUrl(root, "https://mention.test");
        clickMode(root, "@ Mention");
        submitForm(root);
        await flush();

        expect(fetchMetadata).toHaveBeenCalledWith("https://mention.test");
        expect(editorApi.addLinkMention).toHaveBeenCalledWith(meta);
        expect(editorApi.addLinkEmbed).not.toHaveBeenCalled();
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("submitting an empty / whitespace-only URL does nothing and keeps the dialog open", async () => {
        const editorApi = makeEditorApi();
        const root = renderDialog();
        openDialog(editorApi);

        typeUrl(root, "   ");
        submitForm(root);
        await flush();

        expect(fetchMetadata).not.toHaveBeenCalled();
        expect(editorApi.addLinkToEditor).not.toHaveBeenCalled();
        expect(editorApi.addLinkEmbed).not.toHaveBeenCalled();
        // Dialog stays open (still shown).
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
    });

    it("reopening resets the URL field and mode back to embed", async () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        typeUrl(root, "https://leftover.test");
        clickMode(root, "@ Mention");
        expect(getModeButtons(root).find((b) => b.textContent === "@ Mention")?.className).toContain("btn-primary");

        // Re-fire the open event with a fresh editor API: url cleared, mode reset to embed.
        openDialog(makeEditorApi());
        await flush();

        expect(getUrlInput(root)?.value).toBe("");
        const embed = getModeButtons(root).find((b) => b.textContent === "Embed");
        expect(embed?.className).toContain("btn-primary");
    });

    it("hiding the modal externally (close/backdrop) closes the dialog body", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());
        expect(root.querySelector(".modal-dialog")).not.toBeNull();

        // onHidden -> setShown(false): drive the modal's hidden event to run it.
        dispatch(getModal(root) as HTMLElement, new Event("hidden.bs.modal"));

        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("onShown focuses the URL input", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());
        const input = getUrlInput(root);
        expect(input).not.toBeNull();
        // Drive the modal's shown event; the onShown handler focuses the input ref.
        dispatch(getModal(root) as HTMLElement, new Event("shown.bs.modal"));
        expect(document.activeElement).toBe(input);
    });
});

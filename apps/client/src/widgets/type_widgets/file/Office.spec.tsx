import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderOfficeToHtml = vi.fn<(entityType: string, entityId: string) => Promise<string>>();

vi.mock("../../../services/office_renderer", () => ({
    renderOfficeToHtml: (...args: [string, string]) => renderOfficeToHtml(...args)
}));

const { default: OfficePreview } = await import("./Office");

type OfficeNote = Parameters<typeof OfficePreview>[0]["note"];

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
});

function mount(noteId = "office1", blobId = "blob1") {
    const note = { noteId, blobId } as unknown as OfficeNote;
    render(<OfficePreview note={note} />, container);
}

describe("OfficePreview", () => {
    it("shows the loading state, then the sanitized server-rendered HTML for the note", async () => {
        let resolve: (html: string) => void = () => {};
        renderOfficeToHtml.mockReturnValue(new Promise((r) => { resolve = r; }));

        mount("note42");
        // While the conversion is in flight, only the loading placeholder is shown.
        expect(container.querySelector(".office-preview-loading")).not.toBeNull();
        expect(container.querySelector(".office-preview-body")).toBeNull();
        // Effects run after the render tick, so the fetch is observed asynchronously.
        await vi.waitFor(() => expect(renderOfficeToHtml).toHaveBeenCalledWith("notes", "note42"));

        resolve('<p class="converted-doc">Hello</p>');
        await vi.waitFor(() => expect(container.querySelector(".converted-doc")?.textContent).toBe("Hello"));

        const body = container.querySelector(".office-preview-body");
        // The preview body opts into text selection (the app disables it globally).
        expect(body?.classList.contains("selectable-text")).toBe(true);
        expect(container.querySelector(".office-preview-loading")).toBeNull();
    });

    it("falls back to the not-available notice when the conversion fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        renderOfficeToHtml.mockRejectedValue(new Error("conversion exploded"));

        mount();
        await vi.waitFor(() => expect(container.querySelector(".file-preview-not-available")).not.toBeNull());
        expect(container.querySelector(".office-preview-body")).toBeNull();
    });

    it("re-fetches when the note's content (blobId) changes", async () => {
        renderOfficeToHtml.mockResolvedValue("<p>v1</p>");
        mount("note1", "blobA");
        await vi.waitFor(() => expect(container.querySelector(".office-preview-body")).not.toBeNull());

        renderOfficeToHtml.mockResolvedValue('<p class="v2">v2</p>');
        mount("note1", "blobB");
        await vi.waitFor(() => expect(container.querySelector(".v2")).not.toBeNull());
        expect(renderOfficeToHtml).toHaveBeenCalledTimes(2);
    });

    it("discards a conversion that resolves after unmount without touching the DOM", async () => {
        let resolve: (html: string) => void = () => {};
        renderOfficeToHtml.mockReturnValue(new Promise((r) => { resolve = r; }));

        mount();
        // Wait for the effect to start the fetch before unmounting, so the cleanup
        // path (not a never-started effect) is what's exercised.
        await vi.waitFor(() => expect(renderOfficeToHtml).toHaveBeenCalled());
        render(null, container);
        resolve("<p>too late</p>");
        // Let the microtask run; the cancelled effect must not re-render into the container.
        await Promise.resolve();
        expect(container.innerHTML).toBe("");
    });
});

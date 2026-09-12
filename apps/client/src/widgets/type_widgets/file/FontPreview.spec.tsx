import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// i18next is never initialized under test, so t() is rendered deterministic instead: the key with
// the interpolated values appended, e.g. "font_preview.size_pixels|36".
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => [ key, ...Object.values(opts ?? {}) ].join("|")
}));

// The real hooks module imports half the app (app_context, keyboard actions) at module scope; only
// the one the preview reaches for is stood in for.
const setOffered = vi.fn();
let isOffered = false;

vi.mock("../../react/hooks", () => ({
    useNoteLabelBoolean: () => [ isOffered, setOffered ]
}));

const { default: FontPreview } = await import("./FontPreview");

/** The faces `document.fonts` currently holds, as the stubbed registry below sees them. */
let registeredFonts: Set<FontStub>;
let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;

/** Stands in for `FontFace`: records what it was constructed with and resolves unless the source
 *  bytes say otherwise, so an undecodable file can be tested without one. */
class FontStub {
    constructor(public family: string, public source: ArrayBuffer | string) {}

    load() {
        const isUndecodable = typeof this.source !== "string" && new Uint8Array(this.source)[0] === 0xff;
        return isUndecodable ? Promise.reject(new Error("Failed to decode downloaded font.")) : Promise.resolve(this);
    }
}

beforeEach(() => {
    isOffered = false;
    registeredFonts = new Set();
    fetchMock = vi.fn(async () => new Response(new Uint8Array([ 0x00, 0x01, 0x00, 0x00 ])));

    vi.stubGlobal("FontFace", FontStub);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "fonts", {
        configurable: true,
        value: {
            add: (font: FontStub) => registeredFonts.add(font),
            delete: (font: FontStub) => registeredFonts.delete(font)
        }
    });

    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function mount({ noteId = "font1", blobId = "blobA" as string | null, isContentAvailable = true, title = "Iosevka-Regular" } = {}) {
    const note = { noteId, title, isContentAvailable: () => isContentAvailable };
    const blob = blobId ? { blobId } : null;
    const props = { note, blob } as unknown as Parameters<typeof FontPreview>[0];
    render(<FontPreview {...props} />, container);
}

/** The rendered specimen line, once the font has loaded and the preview has replaced its blank. */
async function waitForSpecimen() {
    return await vi.waitFor(() => {
        const specimen = container.querySelector<HTMLElement>(".font-preview-specimen");
        expect(specimen).not.toBeNull();
        return specimen as HTMLElement;
    });
}

describe("FontPreview", () => {
    it("renders the file in itself: the font is registered under a note-private family the specimen and ladder are drawn in", async () => {
        mount();
        const specimen = await waitForSpecimen();

        // Fetched from the note's own endpoint, versioned by blobId so a replaced file is not
        // served from the cache of the one it replaced.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain("api/notes/font1/open?v=blobA");

        const [ font ] = registeredFonts;
        expect(font.family).toBe("trilium-font-preview-font1");
        expect(container.querySelector<HTMLElement>(".font-preview")?.style.getPropertyValue("--font-preview-family"))
            .toBe(`"trilium-font-preview-font1"`);

        // Nothing was typed yet, so the pangram stands in — in the specimen and every ladder line.
        expect(specimen.textContent).toBe("font_preview.pangram");
        const ladderLines = container.querySelectorAll<HTMLElement>(".font-preview-ladder-line");
        expect(ladderLines).toHaveLength(5);
        expect([ ...ladderLines ].map((line) => line.style.getPropertyValue("--font-preview-ladder-size")))
            .toEqual([ "36px", "24px", "18px", "14px", "12px" ]);
        expect(ladderLines[0].textContent).toBe("font_preview.pangram");
    });

    it("draws the typed specimen text at the size the slider is set to", async () => {
        mount();
        const specimen = await waitForSpecimen();
        expect(specimen.style.getPropertyValue("--font-preview-specimen-size")).toBe("56px");

        const input = container.querySelector<HTMLInputElement>(".font-preview-specimen-input");
        if (!input) throw new Error("specimen box not rendered");
        input.value = "Hamburgefonstiv";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        const slider = container.querySelector<HTMLInputElement>("input.slider");
        if (!slider) throw new Error("size slider not rendered");
        slider.value = "72";
        slider.dispatchEvent(new Event("input", { bubbles: true }));

        await vi.waitFor(() => {
            expect(container.querySelector(".font-preview-specimen")?.textContent).toBe("Hamburgefonstiv");
            expect(container.querySelector<HTMLElement>(".font-preview-specimen")?.style.getPropertyValue("--font-preview-specimen-size")).toBe("72px");
        });
        // The ladder shows the same text, at its own fixed sizes.
        expect(container.querySelector(".font-preview-ladder-line")?.textContent).toBe("Hamburgefonstiv");
    });

    it("unregisters the font when the preview goes away", async () => {
        mount();
        await waitForSpecimen();
        expect(registeredFonts.size).toBe(1);

        render(null, container);
        expect(registeredFonts.size).toBe(0);
    });

    it("falls back to the no-preview notice for a file the engine will not rasterize, and registers nothing", async () => {
        fetchMock.mockResolvedValue(new Response(new Uint8Array([ 0xff, 0xff ])));
        mount();

        await vi.waitFor(() => expect(container.querySelector(".file-preview-not-available")).not.toBeNull());
        expect(container.querySelector(".font-preview")).toBeNull();
        expect(registeredFonts.size).toBe(0);
    });

    it("falls back to the no-preview notice when the file cannot be fetched", async () => {
        fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
        mount();

        await vi.waitFor(() => expect(container.querySelector(".file-preview-not-available")).not.toBeNull());
        expect(registeredFonts.size).toBe(0);
    });

    it("does not reach for the content of a protected note outside a protected session", async () => {
        mount({ isContentAvailable: false });

        await vi.waitFor(() => expect(container.querySelector(".file-preview-not-available")).not.toBeNull());
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("offers the font to the picker, and takes the offer back, through #customFont", async () => {
        mount();
        await waitForSpecimen();

        const toggle = () => container.querySelector<HTMLInputElement>(".font-preview-offer input.switch-toggle");
        expect(toggle()?.checked).toBe(false);
        toggle()?.dispatchEvent(new Event("input", { bubbles: true }));
        expect(setOffered).toHaveBeenCalledWith(true);

        // The label alone says the font is offered — the picker names it by the note's title, so
        // there is no family to keep in step with a rename.
        isOffered = true;
        render(null, container);
        mount();
        await waitForSpecimen();

        expect(toggle()?.checked).toBe(true);
        toggle()?.dispatchEvent(new Event("input", { bubbles: true }));
        expect(setOffered).toHaveBeenCalledWith(false);
    });

    it("stays blank until the blob that versions the request arrives", () => {
        mount({ blobId: null });

        expect(container.innerHTML).toBe("");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

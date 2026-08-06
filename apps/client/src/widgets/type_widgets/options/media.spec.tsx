import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The image compression card: the tool's own rows, driving the options that govern every image
 * arriving in the database rather than a run the user is watching.
 *
 * What is worth holding here is the wiring, since the rows themselves are tested where they live —
 * that each row reads and writes the option it stands for, that the group hangs off the switch
 * above it, and that the sentences the settings carried before they became rows are still on the
 * page.
 */
const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string>,
    saved: vi.fn<(name: string, value: string) => void>()
}));

// i18next is never initialised for these tests and answers `undefined` until it is, which would
// make every assertion about a description true of any string at all.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    translationsInitializedPromise: Promise.resolve(),
    initLocale: async () => {},
    getAvailableLocales: () => [],
    getLocaleById: () => null,
    getCurrentLanguage: () => "en"
}));

// A stand-in options store: the page reads through these hooks and writes back through them, so
// this is the whole of what the card touches. Partial-mocked, since sibling components below it
// use other hooks from the same module.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [ mocks.stored[name], (value: string) => mocks.saved(name, value) ],
    useTriliumOptionBool: (name: string) => [
        mocks.stored[name] === "true",
        (value: boolean) => mocks.saved(name, String(value))
    ],
    useTriliumOptionInt: (name: string) => [
        parseInt(mocks.stored[name] ?? "", 10),
        (value: number) => mocks.saved(name, String(value))
    ],
    useNoteContext: () => ({ note: undefined })
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));
vi.mock("./components/RelatedSettings", () => ({ default: () => <div className="related-stub" /> }));

import MediaSettings from "./media";

/** What an untouched install has: everything on, PNGs converted, as automatic shrinking always did. */
const DEFAULTS: Record<string, string> = {
    compressImages: "true",
    imageResize: "true",
    imageMaxWidthHeight: "2000",
    imageJpegHandling: "compress",
    imagePngHandling: "optimize",
    imageJpegQuality: "75",
    imageConversionQuality: "75",
    downloadImagesAutomatically: "true"
};

let host: HTMLElement;

function open(overrides: Record<string, string> = {}) {
    mocks.stored = { ...DEFAULTS, ...overrides };

    void act(() => {
        render(<MediaSettings />, host);
    });
}

/** The card's rows, in the order they are drawn, named by their titles. */
function rowTitles(): (string | undefined)[] {
    return [ ...host.querySelectorAll(".media-image-compression .image-compression-section") ]
        .map((row) => row.querySelector(".image-compression-section-title")?.textContent ?? undefined);
}

function row(title: string): HTMLElement | undefined {
    return [ ...host.querySelectorAll<HTMLElement>(".media-image-compression .image-compression-section") ]
        .find((candidate) => candidate.querySelector(".image-compression-section-title")?.textContent === title);
}

/** Presses one of a row's choice buttons by its label. */
async function choose(title: string, label: string) {
    const button = [ ...(row(title)?.querySelectorAll<HTMLElement>("button") ?? []) ]
        .find((candidate) => candidate.textContent?.trim() === label);

    await act(async () => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

describe("the image compression card", () => {
    it("hangs the whole group off its switch, nesting what qualifies each choice", () => {
        open();

        // What an untouched install shows, in order: the switch, scaling with its bound, then one
        // exclusive choice per format. Recompressing a JPEG brings a quality with it; optimizing a
        // PNG does not, there being no quality to reducing it to a palette — so only one of the two
        // choices carries a nested row here.
        expect(rowTitles()).toEqual([
            "images.automatic_image_compression",
            "space_usage.compress_resize",
            "space_usage.compress_max_dimensions",
            "space_usage.compress_jpeg_handling",
            "space_usage.compress_quality",
            "space_usage.compress_png_handling"
        ]);

        // Switched off, the settings are not merely greyed out but gone: there is nothing for them
        // to govern, and a bound sitting there would read as one still in force.
        open({ compressImages: "false" });
        expect(rowTitles()).toEqual([ "images.automatic_image_compression" ]);
    });

    it("drops a quality that no longer qualifies anything", () => {
        open({ imageJpegHandling: "keep", imagePngHandling: "keep" });

        // Neither format is being re-encoded, so neither quality is in force — and resizing is
        // still on offer, being the one step that reaches an image whatever its encoding.
        expect(rowTitles()).toEqual([
            "images.automatic_image_compression",
            "space_usage.compress_resize",
            "space_usage.compress_max_dimensions",
            "space_usage.compress_jpeg_handling",
            "space_usage.compress_png_handling"
        ]);

        // And the bound goes with scaling, for the same reason.
        open({ imageResize: "false" });
        expect(rowTitles()).not.toContain("space_usage.compress_max_dimensions");
    });

    it("carries the sentences the settings had before they were rows", () => {
        open();

        const describes = (title: string) =>
            row(title)?.querySelector(".image-compression-section-description")?.textContent;

        expect(describes("images.automatic_image_compression")).toBe("images.enable_image_compression_description");
        expect(describes("space_usage.compress_resize")).toBe("images.max_image_dimensions_description");
        // Both qualities take the same advice, being the same scale read twice.
        expect(describes("space_usage.compress_quality")).toBe("images.jpeg_quality_description");
        // A row with nothing extra to say keeps its help mark alone rather than inventing prose.
        expect(describes("space_usage.compress_png_handling")).toBeUndefined();
        expect(row("space_usage.compress_png_handling")?.querySelector(".contextual-help")).not.toBeNull();
    });

    it("writes each choice back to the option it stands for", async () => {
        open();

        await choose("space_usage.compress_png_handling", "space_usage.compress_png_optimize");
        expect(mocks.saved).toHaveBeenCalledWith("imagePngHandling", "optimize");

        await choose("space_usage.compress_jpeg_handling", "space_usage.compress_jpeg_keep");
        expect(mocks.saved).toHaveBeenCalledWith("imageJpegHandling", "keep");

        // Each row writes its own and only its own: the settings are separate synced options, not
        // one blob, so a client that has never heard of the newer ones still reads the older ones.
        expect(mocks.saved.mock.calls.map(([ name ]) => name)).toEqual([ "imagePngHandling", "imageJpegHandling" ]);
    });
});

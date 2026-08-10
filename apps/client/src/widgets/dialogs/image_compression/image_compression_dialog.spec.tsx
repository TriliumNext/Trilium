import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { EMPTY_RESULT } = vi.hoisted(() => ({
    /** What a run reports when it found nothing; tests that care override it. */
    EMPTY_RESULT: {
        items: [], compressedCount: 0, skippedCount: 0, originalSize: 0, newSize: 0, savedSize: 0
    }
}));

/** A report of `count` images compressed, weighing `originalSize` before and `newSize` after. */
function resultOf(count: number, originalSize: number, newSize: number) {
    return {
        items: Array.from({ length: count }, (_, index) => ({ entityId: `img${index}` })),
        compressedCount: count,
        skippedCount: 0,
        originalSize,
        newSize,
        savedSize: originalSize - newSize
    };
}

/**
 * A run called off part-way: the images it got through, and then the ones it never reached.
 *
 * Those carry no sizes because nothing read them — which is exactly why they cannot be counted
 * alongside the bytes the run does report.
 */
function stoppedRun(done: number, cancelled: number, originalSize: number, newSize: number) {
    const result = resultOf(done, originalSize, newSize);
    const untouched = Array.from({ length: cancelled },
        (_, index) => ({ entityId: `left${index}`, skipReason: "cancelled" }));

    return { ...result, items: [ ...result.items, ...untouched ], skippedCount: cancelled };
}

const mocks = vi.hoisted(() => ({
    storedOption: "{}",
    /** URLs the summary asked for, in order, so a re-reading can be told from a first reading. */
    read: [] as string[],
    inventory: {} as Record<string, unknown>,
    info: {} as Record<string, unknown>,
    save: vi.fn(async () => {}),
    postWithTimeout: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => EMPTY_RESULT),
    showMessage: vi.fn<(message: string, timeout?: number) => void>(),
    showPersistent: vi.fn<(options: { id: string, message: string }) => void>(),
    closePersistent: vi.fn<(id: string) => void>()
}));

vi.mock("../../../services/options", () => ({
    default: {
        get: () => mocks.storedOption,
        save: mocks.save
    }
}));

vi.mock("../../../services/server", () => ({
    default: {
        // The summary reads one of these before the dialog can draw anything. Everything else the
        // app loads on the way past — the keyboard actions among them — expects a list.
        get: async (url: string) => {
            if (!url.includes("image-info") && !url.includes("image-inventory")) {
                return [];
            }

            mocks.read.push(url);

            return url.includes("image-info") ? mocks.info : mocks.inventory;
        },
        postWithTimeout: (url: string, _timeoutMs: number, body?: object) => mocks.postWithTimeout(url, body)
    }
}));

vi.mock("../../../services/toast", () => ({
    default: {
        showMessage: mocks.showMessage,
        showPersistent: mocks.showPersistent,
        closePersistent: mocks.closePersistent
    }
}));

// The harness loads no translations, so the real `t` answers undefined for every key. Echoing the
// key back instead lets each row be identified by the string it actually asked for, and lets the
// quality reading be read as the value it interpolates.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    translationsInitializedPromise: Promise.resolve(),
    initLocale: async () => {},
    getAvailableLocales: () => [],
    getLocaleById: () => null,
    getCurrentLanguage: () => "en"
}));

// The real modal reports its close once the animation is done; the stub reports it as soon as it is
// told to hide, which is the signal the dialog's own flow keys off.
vi.mock("../../react/Modal", () => ({
    default: function ModalStub({ children, footer, show, onHidden }: {
        children: ComponentChildren, footer: ComponentChildren, show: boolean, onHidden: () => void
    }) {
        useEffect(() => {
            if (!show) {
                onHidden();
            }
            // Keyed on the visibility alone: the dialog hands down a fresh closure each render, and
            // following that identity would report the same close over and over.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [ show ]);

        return show ? <div className="modal-stub">{children}<div className="footer-stub">{footer}</div></div> : null;
    }
}));

import { showImageCompressionDialog } from "./image_compression_dialog";
import { IMAGE_COMPRESSION_TOAST_ID, type ImageCompressionTarget } from "./image_compression_operation";
import {
    DEFAULT_CONVERSION_QUALITY,
    DEFAULT_MAX_WIDTH_HEIGHT,
    DEFAULT_QUALITY
} from "./image_compression_options";

/** A note holding whatever it holds; the collection case, where every setting is in play. */
const NOTE_TARGET: ImageCompressionTarget = { type: "note", noteId: "n1" };
/**
 * One image apiece. Carrying a mime is what marks a target as a single image; which format it is
 * comes from the reading, so these deliberately carry the non-standard mime Trilium itself writes
 * for a JPEG — nothing may depend on it being a real one.
 */
const JPEG_IMAGE_TARGET: ImageCompressionTarget = { type: "attachment", attachmentId: "a1", mime: "image/jpg" };
const PNG_IMAGE_TARGET: ImageCompressionTarget = { type: "attachment", attachmentId: "a1", mime: "image/png" };

/** Opens a single-image dialog on an image the reading will report as the given format. */
async function openImageDialog(format: string, compressible = true) {
    mocks.info = { ...mocks.info, format, compressible };

    return openDialog(format === "jpg" ? JPEG_IMAGE_TARGET : PNG_IMAGE_TARGET);
}

function rows(within: ParentNode = document.body) {
    return Array.from(within.querySelectorAll<HTMLElement>(".image-compression-section"));
}

const titles = () => titlesOf(document.body);
const titlesOf = (within: ParentNode) =>
    rows(within).map((row) => row.querySelector(".image-compression-section-title")?.textContent);

const cards = () => Array.from(document.body.querySelectorAll<HTMLElement>(".modal-stub .tn-card"));
const numberField = () => document.body.querySelector<HTMLInputElement>(".image-compression-section-number");
const slider = () => document.body.querySelector<HTMLInputElement>(".slider");
const qualityRows = () => rows().filter((row) => !!row.querySelector(".slider"));
const qualityReading = () => document.body.querySelector(".image-compression-section-value")?.textContent ?? "";
const toggles = () => Array.from(document.body.querySelectorAll<HTMLInputElement>(".switch-toggle"));
const hasHelp = (row: HTMLElement) => !!row.querySelector(".image-compression-section-title .contextual-help");

/** The buttons of one format's choice, the groups being in the order the card lists them. */
const choiceButtons = (group: number) =>
    Array.from(document.body.querySelectorAll<HTMLElement>(".image-compression-section-choice"))
        .map((element) => Array.from(element.querySelectorAll<HTMLButtonElement>("button")))[group] ?? [];

/** How many choice groups precede the PNG one, which is last and so counts from the end. */
const pngGroup = () => document.body.querySelectorAll(".image-compression-section-choice").length - 1;

const chosenOf = (group: number) =>
    choiceButtons(group).find((button) => button.classList.contains("active"))?.textContent?.trim();
const chosenJpeg = () => chosenOf(0);
const chosenPng = () => chosenOf(pngGroup());

async function chooseJpeg(handling: "keep" | "compress") {
    await click(choiceButtons(0)[[ "keep", "compress" ].indexOf(handling)]);
}

async function choosePng(handling: "keep" | "optimize" | "jpeg") {
    await click(choiceButtons(pngGroup())[[ "keep", "optimize", "jpeg" ].indexOf(handling)]);
}
const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>(".footer-stub button"));
const cancelButton = () => buttons()[0];
const compressButton = () => buttons()[1];

/**
 * Opens the dialog. The pending close is handed back wrapped: returned bare, awaiting this helper
 * would adopt it and wait for the dialog to be dismissed.
 */
async function openDialog(target: ImageCompressionTarget = NOTE_TARGET) {
    const closed = showImageCompressionDialog(target);
    // Two turns: the summary's reading is requested by an effect on mount and applied when it
    // resolves, and a macrotask turn drains the microtasks between them.
    await settle();
    await settle();
    return { closed };
}

/** The body of the one request a run made, or `undefined` if it made none. */
function postedBody() {
    return mocks.postWithTimeout.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
}

const postedUrl = () => mocks.postWithTimeout.mock.calls[0]?.[0];
const reportedMessage = () => mocks.showMessage.mock.calls[0]?.[0] ?? "";

function settle() {
    return act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function click(button: HTMLButtonElement | undefined) {
    await act(async () => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

/** Flips a switch, the way a click on it does. */
async function toggle(input: HTMLInputElement | null | undefined) {
    await act(async () => {
        input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Types into a field, the way the user does — the component reads the value off the element. */
async function type(field: HTMLInputElement | null | undefined, value: string) {
    await setAndDispatch(field, value, [ "input" ]);
}

/** Drags a range control: a real drag reports every step as an input and the release as a change. */
async function drag(range: HTMLInputElement | null | undefined, value: string) {
    await setAndDispatch(range, value, [ "input", "change" ]);
}

async function setAndDispatch(field: HTMLInputElement | null | undefined, value: string, events: string[]) {
    await act(async () => {
        if (field) {
            field.value = value;
            for (const event of events) {
                field.dispatchEvent(new Event(event, { bubbles: true }));
            }
        }
    });
}

beforeEach(() => {
    mocks.storedOption = "{}";
    mocks.read = [];
    mocks.inventory = {
        title: "Holiday", noteCount: 1,
        total: { count: 4, size: 4000 },
        compressible: { count: 3, size: 3000 },
        oversized: { count: 1, size: 1000 },
        formats: [
            { format: "jpg", count: 2, size: 2000 },
            { format: "png", count: 1, size: 1000 },
            // Counted and listed, but nothing here can act on it — so it earns no setting.
            { format: "webp", count: 1, size: 1000 }
        ],
        compressibleFormats: [ "jpg", "png" ],
        maxWidthHeight: DEFAULT_MAX_WIDTH_HEIGHT,
        unreadable: 0
    };
    mocks.info = {
        entityType: "attachment", entityId: "a1", title: "shot.png",
        mime: "image/png", format: "png", detectedMime: "image/png",
        size: 2048, width: 1920, height: 1080,
        bitDepth: 8, channels: 4, hasAlpha: true, indexed: false, quality: null, compressible: true
    };
    vi.clearAllMocks();
    mocks.postWithTimeout.mockResolvedValue(EMPTY_RESULT);
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("showImageCompressionDialog", () => {
    it("offers each kind of image its own choice, with what qualifies it nested beneath", async () => {
        await openDialog();

        expect(titles()).toEqual([
            "space_usage.compress_resize",
            "space_usage.compress_max_dimensions",
            // One exclusive choice per kind of image, since only one thing can ever become of a
            // given image — and each brings the quality that governs it alone.
            "space_usage.compress_jpeg_handling",
            "space_usage.compress_quality",
            "space_usage.compress_png_handling",
            "space_usage.compress_process_child_notes"
        ]);
        expect(rows().map(controlOf))
            .toEqual([ "toggle", "number", "choice", "slider", "choice", "toggle" ]);
        expect(rows().map(isNested)).toEqual([ false, true, false, true, false, false ]);

        // Every choice and switch carries a consequence its label cannot — what is left untouched,
        // a permanent loss of quality, a reach past the note the run was invoked on — so each
        // explains itself beside its title. The two figures say all there is to say already.
        expect(rows().map(hasHelp)).toEqual([ true, false, true, false, true, true ]);
    });

    it("puts the reach of the run in a card of its own, apart from how it compresses", async () => {
        await openDialog();

        // Everything in the first card says *how*; the second says how far.
        expect(cards()).toHaveLength(2);
        expect(titlesOf(cards()[1])).toEqual([ "space_usage.compress_process_child_notes" ]);
    });

    it("shows the bound only while there is a step that measures against it", async () => {
        await openDialog();

        // Reading it off a switch that is off would present a figure still in force.
        await toggle(toggles()[0]);
        expect(numberField()).toBeNull();

        await toggle(toggles()[0]);
        expect(numberField()?.value).toBe(String(DEFAULT_MAX_WIDTH_HEIGHT));
    });

    it("shows each quality only while the choice it qualifies is the one taken", async () => {
        await openDialog();

        // Opens on compressing JPEGs and optimizing PNGs, so one quality is in force and one is not.
        expect(qualityRows()).toHaveLength(1);

        await choosePng("jpeg");
        expect(qualityRows()).toHaveLength(2);

        await chooseJpeg("keep");
        expect(qualityRows()).toHaveLength(1);

        await choosePng("optimize");
        expect(qualityRows()).toHaveLength(0);
    });

    it("reads a quality out between its title and the slider", async () => {
        await openDialog();

        // A slider says which way it is going but never where it is, so the row reads
        // title, value, control — the reading placed before the control it reads.
        expect(Array.from(qualityRows()[0].children).map((child) => child.classList[0])).toEqual([
            "image-compression-section-title",
            "image-compression-section-value",
            "slider"
        ]);
        expect(qualityReading()).toContain(String(DEFAULT_QUALITY));

        await drag(slider(), "45");

        expect(qualityReading()).toContain("45");
    });

    it("opens on its own defaults when the setting has never been written", async () => {
        await openDialog();

        // Defaults of the tool's own rather than the image options': those govern every image on
        // the way in, where this is a deliberate one-off on one that has already grown too heavy.
        expect(numberField()?.value).toBe(String(DEFAULT_MAX_WIDTH_HEIGHT));
        expect(slider()?.value).toBe(String(DEFAULT_QUALITY));

        // A JPEG is compressed and a PNG is made smaller without ceasing to be one — the least
        // surprising thing to do to each. Reaching into the subtree is not assumed: that widens
        // what the run touches rather than how hard it compresses, and a child may be a clone.
        expect(chosenJpeg()).toBe("space_usage.compress_jpeg_compress");
        expect(chosenPng()).toBe("space_usage.compress_png_optimize");
        expect(toggles().map((input) => input.checked)).toEqual([ true, false ]);
    });

    it("keeps a stored answer, rather than reasserting the defaults over it", async () => {
        mocks.storedOption = JSON.stringify({
            maxWidthHeight: 800, quality: 35, jpegHandling: "keep", pngHandling: "keep",
            processChildNotes: true
        });

        await openDialog();

        expect(numberField()?.value).toBe("800");
        expect(chosenJpeg()).toBe("space_usage.compress_jpeg_keep");
        expect(chosenPng()).toBe("space_usage.compress_png_keep");
        expect(toggles().map((input) => input.checked)).toEqual([ true, true ]);
    });

    it.each([
        [ "an unknown JPEG handling", { jpegHandling: "squash" }, "space_usage.compress_jpeg_compress" ],
        [ "an unknown PNG handling", { pngHandling: "shrink" }, "space_usage.compress_png_optimize" ]
    ])("falls back to the default on %s", async (_label, stored, expected) => {
        mocks.storedOption = JSON.stringify(stored);

        await openDialog();

        expect([ chosenJpeg(), chosenPng() ]).toContain(expected);
    });

    it.each([
        [ "out of range", { quality: 500 } ],
        [ "fractional", { quality: 62.5 } ],
        [ "of the wrong type", { quality: "high" } ]
    ])("ignores a stored quality that is %s and falls back to the default", async (_label, stored) => {
        mocks.storedOption = JSON.stringify(stored);

        await openDialog();

        expect(slider()?.value).toBe(String(DEFAULT_QUALITY));
    });

    it("ignores a nonsensical stored dimension and falls back to the default", async () => {
        mocks.storedOption = JSON.stringify({ maxWidthHeight: 0 });

        await openDialog();

        expect(numberField()?.value).toBe(String(DEFAULT_MAX_WIDTH_HEIGHT));
    });

    it("writes every change straight back, so the next run opens where this one left off", async () => {
        await openDialog();

        await type(numberField(), "900");
        await drag(slider(), "45");
        await chooseJpeg("keep");
        await choosePng("jpeg");
        await toggle(toggles()[1]);

        // The last write carries the whole set, each change having been folded into the one before.
        expect(mocks.save).toHaveBeenLastCalledWith("imageCompressionToolOptions", JSON.stringify({
            resize: true,
            maxWidthHeight: 900,
            jpegHandling: "keep",
            pngHandling: "jpeg",
            quality: 45,
            conversionQuality: DEFAULT_CONVERSION_QUALITY,
            processChildNotes: true
        }));
    });

    it("offers no run at all once nothing is asked of anything", async () => {
        await openDialog();

        await toggle(toggles()[0]);
        await chooseJpeg("keep");
        await choosePng("keep");

        // Every image would be visited and none of them changed; a button that provably does
        // nothing is not one to offer.
        expect(compressButton()?.disabled).toBe(true);

        // Any one of them is enough to make the run worth offering again.
        await choosePng("optimize");
        expect(compressButton()?.disabled).toBe(false);
    });

    it("holds the dimension to at least one pixel, which is the least the server accepts", async () => {
        await openDialog();

        await type(numberField(), "0");

        expect(numberField()?.value).toBe("1");
    });

    it("hands back nothing when the user backs out, settings remembered all the same", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[1]);
        await click(cancelButton());

        // The answer is "no run", and nothing was asked of the server — but the settings are kept
        // either way, so the next run opens where this one left off.
        await expect(closed).resolves.toBeNull();
        expect(mocks.postWithTimeout).not.toHaveBeenCalled();
        expect(mocks.save).toHaveBeenCalledWith(
            "imageCompressionToolOptions", expect.stringContaining('"processChildNotes":true'));
    });
});

describe("offering only what there are images for", () => {
    it("drops the JPEG choice for a note holding none", async () => {
        mocks.inventory = { ...mocks.inventory, compressibleFormats: [ "png" ] };

        await openDialog();

        expect(titles()).not.toContain("space_usage.compress_jpeg_handling");
        expect(titles()).toContain("space_usage.compress_png_handling");
    });

    it("drops the PNG choice for a note holding none", async () => {
        mocks.inventory = { ...mocks.inventory, compressibleFormats: [ "jpg" ] };

        await openDialog();

        expect(titles()).toContain("space_usage.compress_jpeg_handling");
        expect(titles()).not.toContain("space_usage.compress_png_handling");
    });

    it("drops every setting, resizing included, when nothing there can be compressed", async () => {
        // Four images, none of them a format a run could act on.
        mocks.inventory = { ...mocks.inventory, compressibleFormats: [] };

        await openDialog();

        expect(titles()).toEqual([ "space_usage.compress_process_child_notes" ]);
        expect(compressButton()?.disabled).toBe(true);
    });

    it("keeps the reach on offer, so a note can still be looked into", async () => {
        mocks.inventory = { ...mocks.inventory, compressibleFormats: [] };

        await openDialog();

        // The one setting that can change the answer: what is not here may be below.
        expect(cards()).toHaveLength(1);
        expect(titlesOf(cards()[0])).toEqual([ "space_usage.compress_process_child_notes" ]);
    });

    it("brings the settings back once descending finds something", async () => {
        mocks.inventory = { ...mocks.inventory, compressibleFormats: [] };
        await openDialog();
        expect(compressButton()?.disabled).toBe(true);

        mocks.inventory = { ...mocks.inventory, compressibleFormats: [ "jpg" ] };
        // With nothing on offer, the reach is the only switch there is.
        await toggle(toggles()[0]);
        await settle();
        await settle();

        expect(titles()).toContain("space_usage.compress_jpeg_handling");
        expect(compressButton()?.disabled).toBe(false);
    });

});

describe("the reading above the settings", () => {
    const summaryLines = () => Array.from(
        document.body.querySelectorAll<HTMLElement>(".image-compression-summary > *")
    ).map((line) => line.textContent);

    it("names the note and says what its images amount to", async () => {
        await openDialog();

        expect(summaryLines()).toEqual([
            "Holiday",
            'space_usage.compress_summary_total {"count":4,"size":"3.91 KiB"}',
            // One clause per format, then the two figures the settings above are about.
            'space_usage.compress_summary_format {"count":2,"format":"JPEG","size":"1.95 KiB"}, '
            + 'space_usage.compress_summary_format {"count":1,"format":"PNG","size":"1000 B"}, '
            + 'space_usage.compress_summary_format {"count":1,"format":"WEBP","size":"1000 B"}, '
            + 'space_usage.compress_summary_oversized {"count":1,"bound":1920}, '
            + 'space_usage.compress_summary_compressible {"count":3}.'
        ]);
    });

    it("says how far past the note it reached, once it reached anywhere", async () => {
        mocks.inventory = { ...mocks.inventory, noteCount: 21 };
        mocks.storedOption = JSON.stringify({ processChildNotes: true });

        await openDialog();

        // Twenty-one notes visited is the note itself plus twenty below it.
        expect(summaryLines()[0]).toBe('space_usage.compress_summary_scope {"title":"Holiday","count":20}');
    });

    it("names the note alone when descending reached no further", async () => {
        mocks.storedOption = JSON.stringify({ processChildNotes: true });

        await openDialog();

        expect(summaryLines()[0]).toBe("Holiday");
    });

    it("says so plainly when there is nothing to compress", async () => {
        mocks.inventory = {
            ...mocks.inventory,
            total: { count: 0, size: 0 }, compressible: { count: 0, size: 0 },
            oversized: { count: 0, size: 0 }, formats: [], compressibleFormats: []
        };

        await openDialog();

        // A breakdown of nothing would be a row of zeroes rather than an answer.
        expect(summaryLines()).toEqual([ "Holiday", "space_usage.compress_summary_none" ]);
    });

    it("mentions what it could not read, and only then", async () => {
        mocks.inventory = { ...mocks.inventory, unreadable: 2 };

        await openDialog();

        expect(summaryLines()[2]).toContain('space_usage.compress_summary_unreadable {"count":2}');
    });

    it("re-reads when the reach changes, since that is part of what the figures mean", async () => {
        await openDialog();
        expect(mocks.read).toEqual([ `notes/n1/image-inventory?recursive=false&maxWidthHeight=${DEFAULT_MAX_WIDTH_HEIGHT}` ]);

        await toggle(toggles()[1]);
        await settle();

        expect(mocks.read).toContain(`notes/n1/image-inventory?recursive=true&maxWidthHeight=${DEFAULT_MAX_WIDTH_HEIGHT}`);
    });

    it("re-reads when the bound changes, but only once the typing has stopped", async () => {
        await openDialog();
        await type(numberField(), "800");

        // The keystroke itself asks for nothing: a four-digit bound would otherwise cost four
        // readings of the note on its way to the one the user meant.
        expect(mocks.read).toHaveLength(1);

        await vi.waitFor(
            () => expect(mocks.read).toContain("notes/n1/image-inventory?recursive=false&maxWidthHeight=800"),
            { timeout: 3000 }
        );
    });

    it("reads nothing about a subtree for a single image, and describes the image instead", async () => {
        await openDialog(PNG_IMAGE_TARGET);

        expect(mocks.read).toEqual([ "attachments/a1/image-info" ]);
        expect(summaryLines()).toEqual([
            "shot.png",
            // Type and size read as one line rather than two.
            'space_usage.compress_info_file {"format":"PNG","size":"2 KiB"}',
            'space_usage.compress_info_pixels {"width":1920,"height":1080}, '
            + 'space_usage.compress_info_bits {"bits":32}, '
            + "space_usage.compress_info_transparency"
        ]);
    });

    it("leaves out what the header did not state", async () => {
        mocks.info = {
            ...mocks.info, format: "gif", width: 100, height: 50,
            bitDepth: null, channels: null, hasAlpha: null, quality: null
        };

        await openDialog({ type: "attachment", attachmentId: "a1", mime: "image/gif" });

        // A size it could read, and nothing guessed at for the rest.
        expect(summaryLines()[2]).toBe('space_usage.compress_info_pixels {"width":100,"height":50}');
    });

    it("says a JPEG has been squeezed already, which is what decides whether to squeeze it more", async () => {
        mocks.info = { ...mocks.info, format: "jpg", channels: 3, hasAlpha: false, quality: 62 };

        await openDialog(JPEG_IMAGE_TARGET);

        expect(summaryLines()[2]).toContain('space_usage.compress_info_quality {"quality":62}');
    });
});

describe("a single image rather than a note's collection", () => {
    it("offers only the choice for its own format, and nothing about a subtree", async () => {
        await openImageDialog("jpg");

        // A lone JPEG can never be reached by anything the PNG choice says, so offering it would
        // be offering a setting that cannot apply. And one image has no subtree to descend into.
        expect(titles()).toEqual([
            "space_usage.compress_resize",
            "space_usage.compress_max_dimensions",
            "space_usage.compress_jpeg_handling",
            "space_usage.compress_quality"
        ]);
        expect(cards()).toHaveLength(1);
    });

    it("offers the PNG choice for a PNG, and its conversion quality when converting", async () => {
        await openImageDialog("png");

        expect(titles()).toEqual([
            "space_usage.compress_resize",
            "space_usage.compress_max_dimensions",
            "space_usage.compress_png_handling"
        ]);

        await choosePng("jpeg");
        expect(titles()).toContain("space_usage.compress_quality");
    });

    it("treats an image note as one image, the same as an attachment", async () => {
        mocks.info = { ...mocks.info, format: "png", compressible: true };
        await openDialog({ type: "note", noteId: "n1", mime: "image/png" });

        expect(titles()).not.toContain("space_usage.compress_jpeg_handling");
        expect(titles()).not.toContain("space_usage.compress_process_child_notes");
    });

    it("says why it has nothing to offer for a format it cannot compress", async () => {
        mocks.info = { ...mocks.info, format: "gif", compressible: false };
        await openDialog({ type: "attachment", attachmentId: "a1", mime: "image/gif" });

        // Not even resizing: it acts on the same two formats as everything else, so a GIF is out
        // of its reach too and a row offering it would be a control that does nothing.
        expect(titles()).toEqual([]);
        expect(document.body.querySelector(".image-compression-notice")?.textContent)
            .toBe("space_usage.compress_unsupported_format");
        expect(compressButton()?.disabled).toBe(true);
    });

    it("offers no run for a lone JPEG once its own choice is the only one left off", async () => {
        await openImageDialog("jpg");

        await toggle(toggles()[0]);
        await chooseJpeg("keep");

        // The PNG setting is still stored as "optimize", but it could never reach this image, so
        // it must not count as work either.
        expect(compressButton()?.disabled).toBe(true);
    });
});

describe("running the compression", () => {
    it("sends the settings to the note endpoint, the subtree choice among them", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[1]);
        await click(compressButton());
        await closed;

        expect(postedUrl()).toBe("notes/n1/compress-images");
        expect(postedBody()).toEqual({
            // Names the run so its progress can be followed back over the websocket; generated per
            // request, so only its presence is worth asserting.
            taskId: expect.any(String),
            resize: true,
            maxWidthHeight: DEFAULT_MAX_WIDTH_HEIGHT,
            jpegHandling: "compress",
            pngHandling: "optimize",
            quality: DEFAULT_QUALITY,
            conversionQuality: DEFAULT_CONVERSION_QUALITY,
            recursive: true
        });
    });

    it("sends a choice that was narrowed as narrowed, rather than leaving it out", async () => {
        const { closed } = await openDialog();

        await toggle(toggles()[0]);
        await chooseJpeg("keep");
        await click(compressButton());
        await closed;

        // The server defaults an omitted setting to acting, so silence would ask for the opposite.
        expect(postedBody()).toMatchObject({ resize: false, jpegHandling: "keep", pngHandling: "optimize" });
    });

    it("sends nothing about subtrees to the attachment endpoint, which has no use for it", async () => {
        mocks.info = { ...mocks.info, format: "jpg" };
        const { closed } = await openDialog(JPEG_IMAGE_TARGET);

        await click(compressButton());
        await closed;

        expect(postedUrl()).toBe("attachments/a1/compress-image");
        expect(postedBody()).not.toHaveProperty("recursive");
    });

    it("holds a spinner up for the length of the run, and takes it down once it is over", async () => {
        let finish: (result: unknown) => void = () => {};
        mocks.postWithTimeout.mockReturnValueOnce(new Promise<unknown>((resolve) => { finish = resolve; }));

        const { closed } = await openDialog();
        await click(compressButton());

        // The dialog is out of the way and the run is under way: nothing here can say how far along
        // it is, so the toast stays up rather than counting anything down.
        expect(mocks.showPersistent).toHaveBeenCalledWith(expect.objectContaining({
            id: IMAGE_COMPRESSION_TOAST_ID,
            message: "space_usage.compress_running",
            dismissible: false
        }));
        expect(mocks.closePersistent).not.toHaveBeenCalled();

        finish(resultOf(3, 100, 40));
        await closed;

        expect(mocks.closePersistent).toHaveBeenCalledWith(IMAGE_COMPRESSION_TOAST_ID);
    });

    it("reports what the run did, in real sizes", async () => {
        mocks.postWithTimeout.mockResolvedValueOnce(resultOf(10, 45 * 1024 * 1024, 7 * 1024 * 1024));

        const { closed } = await openDialog();
        await click(compressButton());
        const result = await closed;

        expect(reportedMessage()).toBe(
            'space_usage.compress_result {"count":10,"before":"45 MiB","after":"7 MiB"}');
        // Handed back as well as reported, so a caller knows its own figures are now stale.
        expect(result?.compressedCount).toBe(10);
    });

    it("counts out the images a stopped run never reached, instead of claiming it processed them", async () => {
        // The figures a real run produced: a tree of 867, called off after fifteen. Counting the
        // 852 it never opened put the whole tree's number in front of fifteen images' worth of
        // bytes — "867 images processed, reducing the size from 73 MiB to 554 KiB".
        mocks.postWithTimeout.mockResolvedValueOnce(stoppedRun(15, 852, 73 * 1024 * 1024, 554 * 1024));

        const { closed } = await openDialog();
        await click(compressButton());
        await closed;

        expect(reportedMessage()).toBe('space_usage.compress_result_stopped '
            + '{"done":15,"total":867,"before":"73 MiB","after":"554 KiB"}');
    });

    it.each([
        [ "found no images at all", EMPTY_RESULT, "space_usage.compress_result_none" ],
        // Stopped before the first image was read: no count is worth quoting, but "there are no
        // images to compress" would be a plain untruth about a tree full of them.
        [ "was stopped at once", stoppedRun(0, 12, 0, 0), "space_usage.compress_result_stopped_none" ],
        [ "was stopped having gained nothing", stoppedRun(4, 20, 900, 900),
            'space_usage.compress_result_stopped_no_gain {"done":4,"total":24}' ],
        // Quoting "from 45 MiB to 45 MiB" would read as a failure to report, where it is in fact a
        // complete answer: the images were already as small as these settings can make them.
        [ "made nothing smaller", resultOf(4, 900, 900), 'space_usage.compress_result_no_gain {"count":4}' ]
    ])("says so plainly when the run %s", async (_label, response, expected) => {
        mocks.postWithTimeout.mockResolvedValueOnce(response);

        const { closed } = await openDialog();
        await click(compressButton());
        await closed;

        expect(reportedMessage()).toBe(expected);
    });

    it("takes the spinner down and claims nothing when the run fails", async () => {
        mocks.postWithTimeout.mockRejectedValueOnce(new Error("boom"));

        const { closed } = await openDialog();
        await click(compressButton());

        // Answered as no run: the request layer already reported the failure, and nothing here can
        // say what it managed to change before it failed.
        await expect(closed).resolves.toBeNull();
        expect(mocks.closePersistent).toHaveBeenCalledWith(IMAGE_COMPRESSION_TOAST_ID);
        expect(mocks.showMessage).not.toHaveBeenCalled();
        // Mounted on demand, and gone again with it, however the run ended.
        expect(rows()).toEqual([]);
    });
});

/** Whether a row is drawn as qualifying the one above it rather than standing beside it. */
function isNested(row: HTMLElement) {
    return row.classList.contains("image-compression-section-nested");
}

/** Which control a row carries, standing in for the setting it configures. */
function controlOf(row: HTMLElement) {
    if (row.querySelector(".image-compression-section-number")) {
        return "number";
    }
    if (row.querySelector(".slider")) {
        return "slider";
    }
    if (row.querySelector(".image-compression-section-choice")) {
        return "choice";
    }

    return row.querySelector(".switch-toggle") ? "toggle" : "none";
}

import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../../../services/toast", () => ({
    default: {
        showMessage: vi.fn(),
        showError: vi.fn()
    }
}));
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: vi.fn(() => false),
    openInAppHelpFromUrl: vi.fn()
}));

import options from "../../../services/options";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import MediaSettings from "./media";

// --- Render helper --------------------------------------------------------------------------------

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    setOptions({
        downloadImagesAutomatically: "true",
        compressImages: "true",
        imageMaxWidthHeight: "1200",
        imageJpegQuality: "75",
        ocrAutoProcessImages: "false",
        ocrMinConfidence: "0.75"
    });
    vi.clearAllMocks();
    // The auto-mocked server (test/setup.ts) only defines get/post — make them controllable.
    Object.assign(server, {
        get: vi.fn(async () => ({ inProgress: false, total: 0, processed: 0 })),
        post: vi.fn(async () => ({ success: true }))
    });
    (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("MediaSettings", () => {
    it("renders the image and OCR sections with toggles, slider and number input", () => {
        const { container: root } = renderComponent(<MediaSettings />);

        // Two toggles in image section + one in OCR section => 3 switch widgets.
        const toggles = root.querySelectorAll(".switch-widget input.switch-toggle");
        expect(toggles.length).toBe(3);

        // Two sliders (jpeg quality + ocr confidence).
        const sliders = root.querySelectorAll("input.slider");
        expect(sliders.length).toBe(2);

        // The max-width number input.
        const numberInput = root.querySelector(".tn-number-unit-pair input[type='number']");
        expect(numberInput).not.toBeNull();
    });

    it("disables the max-dimensions input when compression is off", () => {
        setOptions({
            compressImages: "false",
            imageMaxWidthHeight: "1200",
            imageJpegQuality: "75",
            ocrMinConfidence: "0.75"
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const numberInput = root.querySelector<HTMLInputElement>(".tn-number-unit-pair input[type='number']");
        expect(numberInput?.disabled).toBe(true);
    });

    it("seeds slider values from imageJpegQuality and ocrMinConfidence options", () => {
        setOptions({
            compressImages: "true",
            imageJpegQuality: "50",
            ocrMinConfidence: "0.5"
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const sliders = root.querySelectorAll<HTMLInputElement>("input.slider");
        // First slider = jpeg quality (50), second = ocr confidence (0.5 -> 50).
        expect(sliders[0].value).toBe("50");
        expect(sliders[1].value).toBe("50");
    });

    it("uses fallback values when jpeg quality / confidence options are missing", () => {
        setOptions({ compressImages: "true" });
        const { container: root } = renderComponent(<MediaSettings />);
        const sliders = root.querySelectorAll<HTMLInputElement>("input.slider");
        expect(sliders[0].value).toBe("75"); // imageJpegQuality fallback
        expect(sliders[1].value).toBe("75"); // 0.75 confidence -> 75
    });
});

describe("ImageSettings interactions", () => {
    it("saves a new jpeg quality when the slider changes", async () => {
        const { container: root } = renderComponent(<MediaSettings />);
        const sliders = root.querySelectorAll<HTMLInputElement>("input.slider");
        const jpegSlider = sliders[0];
        jpegSlider.value = "60";
        await act(async () => {
            // Preact maps a range input's onChange onto the native "input" event.
            jpegSlider.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(options.get("imageJpegQuality" as OptionNames)).toBe("60");
    });

    it("saves a new max width/height when the number input changes", async () => {
        const { container: root } = renderComponent(<MediaSettings />);
        const input = root.querySelector<HTMLInputElement>(".tn-number-unit-pair input[type='number']");
        expect(input).not.toBeNull();
        if (!input) return;
        input.value = "800";
        await act(async () => {
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(options.get("imageMaxWidthHeight" as OptionNames)).toBe("800");
    });

    it("toggles download-images-automatically", async () => {
        const { container: root } = renderComponent(<MediaSettings />);
        const toggle = root.querySelector<HTMLInputElement>(".switch-widget input.switch-toggle");
        expect(toggle).not.toBeNull();
        if (!toggle) return;
        await act(async () => {
            toggle.dispatchEvent(new Event("input", { bubbles: true }));
        });
        // Was "true", flipping to "false".
        expect(options.get("downloadImagesAutomatically" as OptionNames)).toBe("false");
    });

    it("saves a new ocr confidence when its slider changes", async () => {
        const { container: root } = renderComponent(<MediaSettings />);
        const sliders = root.querySelectorAll<HTMLInputElement>("input.slider");
        const confSlider = sliders[1];
        confSlider.value = "40";
        await act(async () => {
            confSlider.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(options.get("ocrMinConfidence" as OptionNames)).toBe("0.4");
    });
});

describe("OcrSettings related links", () => {
    it("omits the languages related-setting on web (non-electron)", () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
        const { container: root } = renderComponent(<MediaSettings />);
        const relatedLinks = root.querySelectorAll("a.option-row-link");
        expect(relatedLinks.length).toBe(0);
    });

    it("shows the languages related-setting on desktop (electron)", () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const { container: root } = renderComponent(<MediaSettings />);
        const relatedLinks = root.querySelectorAll("a.option-row-link");
        expect(relatedLinks.length).toBe(1);
    });
});

describe("BatchProcessing", () => {
    it("renders the start button when nothing is running", () => {
        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        expect(btn).not.toBeNull();
        expect(btn?.querySelector(".bx-play")).not.toBeNull();
    });

    it("starts a batch, shows a starting toast and begins polling", async () => {
        vi.useFakeTimers();
        const getMock = vi.fn(async () => ({ inProgress: true, total: 10, processed: 0, percentage: 0 }));
        Object.assign(server, {
            post: vi.fn(async () => ({ success: true })),
            get: getMock
        });

        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        expect(btn).not.toBeNull();
        if (!btn) return;

        await act(async () => {
            btn.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(server.post).toHaveBeenCalledWith("ocr/batch-process");
        expect(toast.showMessage).toHaveBeenCalled();
        // pollProgress is called immediately after starting.
        expect(getMock).toHaveBeenCalledWith("ocr/batch-progress");

        // Progress bar should now be visible.
        const bar = root.querySelector(".progress-bar");
        expect(bar).not.toBeNull();
    });

    it("shows an error toast when starting fails (success=false)", async () => {
        Object.assign(server, {
            post: vi.fn(async () => ({ success: false, message: "boom" }))
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;
        await act(async () => {
            btn.click();
            await Promise.resolve();
        });
        expect(toast.showError).toHaveBeenCalledWith("boom");
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("shows an error toast with fallback message when success=false and no message", async () => {
        Object.assign(server, {
            post: vi.fn(async () => ({ success: false }))
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;
        await act(async () => {
            btn.click();
            await Promise.resolve();
        });
        expect(toast.showError).toHaveBeenCalledTimes(1);
    });

    it("swallows server errors thrown by post", async () => {
        Object.assign(server, {
            post: vi.fn(async () => {
                throw new Error("network");
            })
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;
        await act(async () => {
            btn.click();
            await Promise.resolve();
        });
        expect(toast.showError).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("stops polling and shows completion toast once progress reports done", async () => {
        vi.useFakeTimers();
        // First poll: in progress; later poll: completed.
        let call = 0;
        const getMock = vi.fn(async () => {
            call++;
            return call <= 1
                ? { inProgress: true, total: 4, processed: 2, percentage: 50 }
                : { inProgress: false, total: 4, processed: 4, percentage: 100 };
        });
        Object.assign(server, {
            post: vi.fn(async () => ({ success: true })),
            get: getMock
        });

        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;

        await act(async () => {
            btn.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        // Advance the polling interval to trigger the second (completing) poll.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
            await Promise.resolve();
        });

        expect(toast.showMessage).toHaveBeenCalled();
        // Once done, the button should be back (progress bar gone).
        const btnAfter = root.querySelector("button.btn-secondary");
        expect(btnAfter).not.toBeNull();
    });

    it("renders a progress bar reflecting percentage while running", async () => {
        vi.useFakeTimers();
        Object.assign(server, {
            post: vi.fn(async () => ({ success: true })),
            get: vi.fn(async () => ({ inProgress: true, total: 8, processed: 4, percentage: 50 }))
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;
        await act(async () => {
            btn.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        const bar = root.querySelector<HTMLElement>(".progress-bar");
        expect(bar).not.toBeNull();
        expect(bar?.style.width).toBe("50%");
    });

    it("falls back to 0 width/processed/total when those fields are missing", async () => {
        vi.useFakeTimers();
        Object.assign(server, {
            post: vi.fn(async () => ({ success: true })),
            // inProgress but without percentage/processed/total -> exercises the ?? 0 fallbacks.
            get: vi.fn(async () => ({ inProgress: true }))
        });
        const { container: root } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;
        await act(async () => {
            btn.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        const bar = root.querySelector<HTMLElement>(".progress-bar");
        expect(bar).not.toBeNull();
        expect(bar?.style.width).toBe("0%");
    });

    it("cleans up the polling interval on unmount", async () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(globalThis, "clearInterval");
        Object.assign(server, {
            post: vi.fn(async () => ({ success: true })),
            get: vi.fn(async () => ({ inProgress: true, total: 8, processed: 0, percentage: 0 }))
        });
        const { container: root, unmount } = renderComponent(<MediaSettings />);
        const btn = root.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!btn) return;
        await act(async () => {
            btn.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        // Unmount should clear the active interval.
        unmount();
        expect(clearSpy).toHaveBeenCalled();
    });
});

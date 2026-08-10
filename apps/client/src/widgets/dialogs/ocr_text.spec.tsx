/**
 * The dialog showing the text OCR pulled out of an image or a document.
 *
 * Reading and extracting are two different capabilities: the text is stored on the blob and travels
 * with it, so any client can show it, but running the extraction needs the engine only the server
 * has. What is held here is that the dialog offers exactly what the client it is running in can do.
 */
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import OcrTextDialog from "./ocr_text";

const mocks = vi.hoisted(() => ({ standalone: false }));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../components/app_context", () => ({ default: { triggerCommand: vi.fn() } }));
// Answer the dialog's own request and nothing else: the modal's shortcut hints go through the same
// service, and handing them this payload instead of the list they expect throws inside their fetch.
vi.mock("../../services/server", () => ({
    default: {
        get: vi.fn(async (url: string) => (url.endsWith("/text")
            ? { success: true, hasOcr: true, text: "scanned text" }
            : [])),
        post: vi.fn()
    }
}));

// `isStandalone` is a const in the target, read here through a getter so a scenario can flip which
// kind of client we are pretending to be. Partial-mock, so the rest of utils stays real.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    get isStandalone() {
        return mocks.standalone;
    }
}));

/** Opens the dialog on a note, as the command that shows it does, and waits for the text to arrive. */
async function open() {
    const host = new Component();
    renderInto(
        <ParentComponent.Provider value={host}>
            <OcrTextDialog />
        </ParentComponent.Provider>
    );

    await act(async () => {
        await host.handleEvent("showOcrTextDialog", {
            textUrl: "ocr/notes/n1/text",
            processUrl: "ocr/process-note/n1"
        });
    });
}

function footerButtons(): string[] {
    return [ ...document.querySelectorAll(".ocr-text-modal .modal-footer button") ]
        .map((button) => button.textContent?.trim() ?? "");
}

describe("OcrTextDialog", () => {
    beforeEach(() => {
        mocks.standalone = false;
        document.body.innerHTML = "";
    });

    it("shows the text, and offers to extract it again where an engine can", async () => {
        await open();

        expect(document.querySelector(".ocr-text-modal-content")?.textContent).toBe("scanned text");
        expect(footerButtons()).toContain("ocr.process_now");
    });

    it("drops the offer to extract in standalone, which has no engine to run", async () => {
        mocks.standalone = true;
        await open();

        // The text still shows: it was extracted wherever OCR ran and synced here with the blob.
        expect(document.querySelector(".ocr-text-modal-content")?.textContent).toBe("scanned text");
        expect(footerButtons()).not.toContain("ocr.process_now");
        // Copying is not extraction, and stays.
        expect(footerButtons()).toContain("info.copy_to_clipboard");
    });
});

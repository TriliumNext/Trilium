import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PasteButton from "./PasteButton";

const { canReadClipboardText, readClipboardText, showError } = vi.hoisted(() => ({
    canReadClipboardText: vi.fn(async () => true),
    readClipboardText: vi.fn(async () => ""),
    showError: vi.fn()
}));

vi.mock("../../services/clipboard_ext", () => ({ canReadClipboardText, readClipboardText }));
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../services/toast", () => ({ default: { showError } }));

const VIDEO_URL = "https://youtu.be/dQw4w9WgXcQ";

describe("PasteButton", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        canReadClipboardText.mockResolvedValue(true);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** Renders the button after a plain controlled field, which reports what it receives. */
    async function renderField(onInput: (value: string, inputType: string) => void = () => {}) {
        function Field() {
            const inputRef = useRef<HTMLInputElement>(null);
            const [ value, setValue ] = useState("typed");
            return (
                <div className="input-group">
                    <input
                        ref={inputRef}
                        value={value}
                        onInput={(e) => {
                            setValue(e.currentTarget.value);
                            onInput(e.currentTarget.value, e.inputType);
                        }}
                    />
                    <PasteButton inputRef={inputRef} />
                </div>
            );
        }

        act(() => render(<Field />, container));
        // The effect calling `canReadClipboardText()` runs as the first `act()` ends.
        await settle();
        const input = container.querySelector("input");
        if (!input) throw new Error("The field is not shown.");
        return input;
    }

    function pasteButton() {
        return container.querySelector<HTMLButtonElement>(".input-group > .tn-paste-button");
    }

    async function paste() {
        const button = pasteButton();
        if (!button) throw new Error("The paste button is not shown.");
        button.click();
        await settle();
    }

    it("replaces the value of the field as a paste would, and selects all of it", async () => {
        const onInput = vi.fn();
        readClipboardText.mockResolvedValue(VIDEO_URL);
        const input = await renderField(onInput);
        expect(pasteButton()?.type).toBe("button");

        await paste();
        expect(onInput).toHaveBeenCalledExactlyOnceWith(VIDEO_URL, "insertFromPaste");
        expect(input.value).toBe(VIDEO_URL);
        expect(document.activeElement).toBe(input);
        expect([ input.selectionStart, input.selectionEnd ]).toEqual([ 0, VIDEO_URL.length ]);

        readClipboardText.mockResolvedValue("");
        await paste();
        expect(input.value).toBe(VIDEO_URL);
        expect(onInput).toHaveBeenCalledOnce();
    });

    it("shows only where the clipboard can be read, and hides after a denial", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        canReadClipboardText.mockResolvedValue(false);
        await renderField();
        expect(pasteButton()).toBeNull();

        render(null, container);
        canReadClipboardText.mockResolvedValue(true);
        await renderField();
        expect(pasteButton()).not.toBeNull();

        readClipboardText.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
        canReadClipboardText.mockResolvedValue(false);
        await paste();
        expect(showError).toHaveBeenCalledExactlyOnceWith("clipboard.paste_failed");
        expect(pasteButton()).toBeNull();
    });
});

/** Waits a task, so that what a pending promise renders is in the DOM. */
function settle() {
    return act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}

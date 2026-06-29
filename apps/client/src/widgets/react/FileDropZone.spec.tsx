import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FileDropZone from "./FileDropZone";

// Note: the drag-and-drop branch (onDrop → onNativeDrop fallback) isn't exercised here — happy-dom doesn't
// dispatch drag/drop events to preact listeners. That decision logic (native-handled vs. upload fallback)
// is covered at the hook level in dialogs/import/useProviderImport.spec.tsx, which drives onNativeDrop
// directly. This spec covers FileDropZone's own additions: the external-selection display and browse override.

describe("FileDropZone", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    const zone = () => container.querySelector(".file-drop-zone") as HTMLElement;
    const filenames = () => Array.from(container.querySelectorAll(".file-drop-zone-filename")).map((el) => el.textContent);

    it("notifies a null selection on mount", async () => {
        const onChange = vi.fn();
        await act(async () => render(<FileDropZone onChange={onChange} />, container));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it("forwards multiple and accept to the underlying file input", async () => {
        await act(async () => render(<FileDropZone onChange={vi.fn()} multiple accept=".zip" />, container));
        const input = container.querySelector("input[type=file]") as HTMLInputElement;
        expect(input.multiple).toBe(true);
        expect(input.getAttribute("accept")).toBe(".zip");
    });

    describe("displayNames (external selection)", () => {
        it("shows externally-provided names and marks the zone as having files", async () => {
            await act(async () => render(<FileDropZone onChange={vi.fn()} displayNames={["Vault.zip"]} />, container));
            expect(filenames()).toEqual(["Vault.zip"]);
            expect(zone().className).toContain("has-files");
        });

        it("lists every external name when several are provided", async () => {
            await act(async () => render(<FileDropZone onChange={vi.fn()} displayNames={["a.zip", "b.zip"]} />, container));
            expect(filenames()).toEqual(["a.zip", "b.zip"]);
        });

        it("shows no selection when there is neither an external nor an internal one", async () => {
            await act(async () => render(<FileDropZone onChange={vi.fn()} />, container));
            expect(filenames()).toEqual([]);
            expect(zone().className).not.toContain("has-files");
        });
    });

    describe("onBrowse override", () => {
        it("calls the override and prevents the in-page file input from opening", async () => {
            const onBrowse = vi.fn();
            await act(async () => render(<FileDropZone onChange={vi.fn()} onBrowse={onBrowse} />, container));

            const click = new MouseEvent("click", { bubbles: true, cancelable: true });
            await act(async () => {
                zone().dispatchEvent(click);
            });

            expect(onBrowse).toHaveBeenCalledTimes(1);
            expect(click.defaultPrevented).toBe(true);
        });

        it("does not intercept the click when no override is provided", async () => {
            await act(async () => render(<FileDropZone onChange={vi.fn()} />, container));
            const click = new MouseEvent("click", { bubbles: true, cancelable: true });
            await act(async () => {
                zone().dispatchEvent(click);
            });
            // Without an override the label keeps its default behaviour (opening the native input).
            expect(click.defaultPrevented).toBe(false);
        });
    });
});

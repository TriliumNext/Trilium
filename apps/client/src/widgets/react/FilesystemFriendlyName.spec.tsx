import { render } from "preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FilesystemFriendlyName from "./FilesystemFriendlyName";

// What a file name may and may not hold is tested where those rules live, in
// `@triliumnext/commons`; what is left here is the field's own behaviour as it is typed into.
describe("FilesystemFriendlyName", () => {
    let container: HTMLDivElement | undefined;
    const onChange = vi.fn();

    /** Renders the field with its value held in state, which is what puts the caret back. */
    function renderField(initial: string): HTMLInputElement {
        container = document.createElement("div");
        document.body.appendChild(container);

        function Harness() {
            const [ value, setValue ] = useState(initial);

            return (
                <FilesystemFriendlyName
                    currentValue={value}
                    onChange={(cleaned) => {
                        onChange(cleaned);
                        setValue(cleaned);
                    }}
                />
            );
        }

        render(<Harness />, container);

        const input = container.querySelector("input");
        if (!input) {
            throw new Error("the field did not render");
        }
        return input;
    }

    /** Preact applies state through a microtask, so a rendered result is awaited rather than read. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** Types into the box the way a browser does: value, caret, then the input event. */
    function type(input: HTMLInputElement, value: string, caret = value.length) {
        input.value = value;
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /** Leaves the field. Preact's compat layer listens for the bubbling counterpart of blur. */
    function leave(input: HTMLInputElement) {
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    beforeEach(() => {
        onChange.mockReset();
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("takes a refused character straight back out as it is typed", async () => {
        const input = renderField("Backup");

        type(input, "Backup:");
        await settle();

        expect(onChange).toHaveBeenCalledWith("Backup");
        expect(input.value).toBe("Backup");
    });

    it("cleans a pasted name in one go", async () => {
        const input = renderField("");

        type(input, 'C:\\Users\\me\\notes "final"');
        await settle();

        expect(onChange).toHaveBeenCalledWith("CUsersmenotes final");
    });

    it("tidies the edges when the field is left, which is where a paste lands", async () => {
        const input = renderField("  Before the import.  ");

        leave(input);
        await settle();

        expect(onChange).toHaveBeenCalledWith("Before the import");
    });

    it("leaves the caret where the typing was, rather than at the end", async () => {
        const input = renderField("Backup 2026");

        // A colon typed after "Backup", which is refused: the caret belongs right after "Backup",
        // not thrown to the end of the box by the value being replaced.
        type(input, "Backup: 2026", 7);
        await settle();

        expect(onChange).toHaveBeenCalledWith("Backup 2026");
        expect(input.selectionStart).toBe(6);
    });

    it("keeps the caret ahead of the character typed after a refused one", async () => {
        const input = renderField("Backup");

        // Refused, and the host's value does not change, so this causes no render of its own.
        type(input, "Backup:", 7);
        await settle();
        expect(input.value).toBe("Backup");

        // Accepted, and this one does render. The position remembered for the refusal must not
        // survive to it, or the caret lands before the character that was just typed.
        type(input, "BackupX", 7);
        await settle();

        expect(input.value).toBe("BackupX");
        expect(input.selectionStart).toBe(7);
    });
});

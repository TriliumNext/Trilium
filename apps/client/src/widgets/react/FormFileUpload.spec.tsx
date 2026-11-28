import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import FormFileUpload from "./FormFileUpload";

describe("FormFileUpload", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => act(() => render(null, host)));

    it("offers the accepted types, and clears the choice after a change when asked to", () => {
        const onChange = vi.fn();
        act(() => render(<FormFileUpload accept="image/*" clearAfterChange onChange={onChange} />, host));
        const input = host.querySelector<HTMLInputElement>("input[type=file]");
        if (!input) throw new Error("expected the file input");
        expect(input.accept).toBe("image/*");

        const file = new File([ "x" ], "a.png", { type: "image/png" });
        Object.defineProperty(input, "files", { configurable: true, value: [ file ] });
        let value = "C:\\fakepath\\a.png";
        Object.defineProperty(input, "value", { configurable: true, get: () => value, set: (next: string) => { value = next; } });
        act(() => {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(onChange).toHaveBeenLastCalledWith([ file ]);
        expect(value).toBe("");
    });
});

import { Locale } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import MathInputView from "./math_input_view.js";

// Evaluating this mock throws, so the dynamic import rejects as a failed chunk download does.
vi.mock("mathlive", () => ({
    get MathfieldElement(): never {
        throw new Error("Failed to fetch dynamically imported module");
    }
}));

describe("MathInputView when MathLive fails to load", () => {
    let view: MathInputView | undefined;

    afterEach(() => {
        view?.element?.remove();
        view?.destroy();
    });

    it("shows a notice in place of the math field and keeps the LaTeX field working", async () => {
        view = new MathInputView(new Locale());
        view.render();
        document.body.appendChild(view.element as HTMLElement);
        const container = view.element?.querySelector(".ck-mathlive-container");

        await vi.waitFor(() => expect(container?.textContent).toBe("Math editor unavailable"));

        view.value = "x^2";

        expect(view.latexTextAreaView.element.value).toBe("x^2");
        expect(container?.querySelector("math-field")).toBeNull();
    });
});

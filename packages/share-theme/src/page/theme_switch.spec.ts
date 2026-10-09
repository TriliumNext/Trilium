// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import setupThemeSelector from "./theme_switch.js";

describe("setupThemeSelector", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        document.documentElement.className = "";
        localStorage.clear();
    });

    it("checks the switch for the dark theme and switches and stores the theme on change", () => {
        document.documentElement.className = "theme-dark";
        document.body.innerHTML = `<div class="theme-selection"><input type="checkbox"></div>`;
        const input = document.querySelector<HTMLInputElement>(".theme-selection input");
        if (!input) {
            throw new Error("The switch is missing.");
        }

        setupThemeSelector();
        expect(input.checked).toBe(true);

        input.checked = false;
        input.dispatchEvent(new Event("change"));
        expect(document.documentElement.className).toBe("theme-light");
        expect(localStorage.getItem("theme")).toBe("light");
    });
});

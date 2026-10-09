// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import setupThemeSelector from "./theme_switch.js";

const OPTIONS = `
    <div class="theme-options">
        <button class="theme-option" data-theme="light"></button>
        <button class="theme-option" data-theme="dark"></button>
        <button class="theme-option" data-theme="system"></button>
    </div>
    <button id="theme-cycle-button"></button>`;

describe("setupThemeSelector", () => {
    let systemDark: ReturnType<typeof mockSystemTheme>;

    beforeEach(() => {
        systemDark = mockSystemTheme(false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
        document.documentElement.className = "";
        localStorage.clear();
    });

    it("applies, marks and stores the chosen theme, or forgets it for the system", () => {
        document.body.innerHTML = OPTIONS;
        setupThemeSelector();
        expect(rootClasses()).toStrictEqual([ "theme-light", "theme-preference-system" ]);
        expect(pressed()).toStrictEqual([ "system" ]);

        clickOption("dark");
        expect(rootClasses()).toStrictEqual([ "theme-dark", "theme-preference-dark" ]);
        expect(pressed()).toStrictEqual([ "dark" ]);
        expect(localStorage.getItem("theme")).toBe("dark");

        clickOption("light");
        expect(rootClasses()).toStrictEqual([ "theme-light", "theme-preference-light" ]);
        expect(localStorage.getItem("theme")).toBe("light");

        clickOption("system");
        expect(rootClasses()).toStrictEqual([ "theme-light", "theme-preference-system" ]);
        expect(localStorage.getItem("theme")).toBeNull();
    });

    it("cycles light, dark and system from the header button", () => {
        localStorage.setItem("theme", "light");
        document.body.innerHTML = OPTIONS;
        setupThemeSelector();
        const cycle = document.getElementById("theme-cycle-button");
        expect(cycle).not.toBeNull();

        const preferences = [];
        for (let i = 0; i < 3; i++) {
            cycle?.click();
            preferences.push(localStorage.getItem("theme"));
        }
        expect(preferences).toStrictEqual([ "dark", null, "light" ]);
        expect(pressed()).toStrictEqual([ "light" ]);
    });

    it("follows a change of the system theme only while the preference is the system's", () => {
        document.body.innerHTML = OPTIONS;
        setupThemeSelector();

        systemDark.change(true);
        expect(rootClasses()).toStrictEqual([ "theme-dark", "theme-preference-system" ]);

        clickOption("light");
        systemDark.change(false);
        systemDark.change(true);
        expect(rootClasses()).toStrictEqual([ "theme-light", "theme-preference-light" ]);
    });

    it("ignores an unknown stored value and works when storage is blocked", () => {
        localStorage.setItem("theme", "sepia");
        systemDark = mockSystemTheme(true);
        document.body.innerHTML = OPTIONS;
        setupThemeSelector();
        expect(rootClasses()).toStrictEqual([ "theme-dark", "theme-preference-system" ]);

        const blocked = () => {
            throw new Error("Storage is blocked.");
        };
        vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
        document.body.innerHTML = OPTIONS;
        setupThemeSelector();
        expect(rootClasses()).toStrictEqual([ "theme-dark", "theme-preference-system" ]);

        clickOption("light");
        expect(rootClasses()).toStrictEqual([ "theme-light", "theme-preference-light" ]);
    });

    it("keeps the switch of a custom template copied from an earlier page.ejs working", () => {
        localStorage.setItem("theme", "dark");
        document.body.innerHTML = `<div class="theme-selection"><input type="checkbox"></div>`;
        const input = document.querySelector<HTMLInputElement>(".theme-selection input");
        if (!input) {
            throw new Error("The switch is missing.");
        }

        setupThemeSelector();
        expect(input.checked).toBe(true);

        input.checked = false;
        input.dispatchEvent(new Event("change"));
        expect(rootClasses()).toStrictEqual([ "theme-light", "theme-preference-light" ]);
        expect(localStorage.getItem("theme")).toBe("light");

        input.checked = true;
        input.dispatchEvent(new Event("change"));
        expect(localStorage.getItem("theme")).toBe("dark");
    });

    it("does nothing on a page without the controls", () => {
        expect(() => setupThemeSelector()).not.toThrow();
    });
});

/** Replaces `matchMedia` with a system theme the spec can change. */
function mockSystemTheme(matches: boolean) {
    const listeners: (() => void)[] = [];
    const query = {
        matches,
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener)
    };
    vi.stubGlobal("matchMedia", () => query);
    return {
        change(dark: boolean) {
            query.matches = dark;
            for (const listener of listeners) {
                listener();
            }
        }
    };
}

function rootClasses() {
    return [ ...document.documentElement.classList ].sort();
}

function pressed() {
    return [ ...document.querySelectorAll<HTMLElement>(".theme-option[aria-pressed=true]") ]
        .map((button) => button.dataset.theme);
}

function clickOption(theme: string) {
    const button = document.querySelector<HTMLButtonElement>(`.theme-option[data-theme=${theme}]`);
    expect(button).not.toBeNull();
    button?.click();
}

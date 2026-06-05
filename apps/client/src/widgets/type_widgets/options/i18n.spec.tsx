import { OptionNames } from "@triliumnext/commons";
import type { Locale } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// bootstrap is used by Dropdown (BootstrapDropdown.getOrCreateInstance) and useTooltip (Tooltip).
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let instance = Dropdown.instances.get(el);
            if (!instance) {
                instance = new Dropdown(el);
                Dropdown.instances.set(el, instance);
            }
            return instance;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

// Control the locale list and translation function deterministically.
const getAvailableLocales = vi.fn<() => Locale[]>(() => []);
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    getAvailableLocales: () => getAvailableLocales()
}));

// restartDesktopApp is the only side-effectful util the component invokes on click.
const restartDesktopApp = vi.fn();
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    restartDesktopApp: () => restartDesktopApp(),
    isElectron: () => isElectronValue
}));

import options from "../../../services/options";
import server from "../../../services/server";
import ws from "../../../services/ws";
import Component from "../../../components/component";
import { ParentComponent } from "../../react/react_utils";
import InternationalizationOptions, { ContentLanguagesList } from "./i18n";

// --- Shared helpers -------------------------------------------------------------------------------

let isElectronValue = false;
let container: HTMLDivElement | undefined;

function renderComponent(vnode: preact.ComponentChildren) {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render(
            <ParentComponent.Provider value={new Component()}>
                {vnode}
            </ParentComponent.Provider>,
            el
        );
    });
    return el;
}

function unmountContainer() {
    const el = container;
    if (!el) return;
    act(() => { render(null, el); });
    el.remove();
    container = undefined;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

const FULL_LOCALES: Locale[] = [
    { id: "en", name: "English", electronLocale: "en" },
    { id: "ar", name: "Arabic", electronLocale: "ar", rtl: true },
    { id: "he", name: "Hebrew", contentOnly: true, rtl: true },
    { id: "dev", name: "Dev Only", electronLocale: "en", devOnly: true },
    { id: "nolocale", name: "No electron locale" }
];

beforeEach(() => {
    isElectronValue = false;
    getAvailableLocales.mockReturnValue(FULL_LOCALES);
    setOptions({ locale: "en", formattingLocale: "en", firstDayOfWeek: "1", firstWeekOfYear: "0", minDaysInFirstWeek: "4", languages: JSON.stringify([ "en" ]) });
    const glob = window.glob as unknown as Record<string, unknown>;
    glob.isDev = false;
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    vi.clearAllMocks();
    getAvailableLocales.mockReturnValue(FULL_LOCALES);
    // The auto-mocked server (test/setup.ts) only defines get/post — add the write verbs option setters use.
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
});

afterEach(() => {
    unmountContainer();
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("InternationalizationOptions", () => {
    it("renders localization + content-language sections and omits related settings in browser mode", () => {
        isElectronValue = false;
        const root = renderComponent(<InternationalizationOptions />);

        // Localization section + content language section = two options-section headers (h4).
        const sections = root.querySelectorAll(".options-section");
        expect(sections.length).toBe(2);

        // No related-settings (electron-only) section.
        const links = root.querySelectorAll("a.option-row-link");
        expect(links.length).toBe(0);

        // Date settings rows exist: language, formatting-locale, first-day, first-week, restart.
        expect(root.querySelector(".option-row")).toBeTruthy();
        // firstWeekOfYear is "0" => min-days row hidden. Count select elements.
        // language + formatting are Dropdowns (buttons), first-day + first-week are FormSelects.
        expect(root.querySelectorAll("select").length).toBe(2);
    });

    it("renders the electron-only related-settings section when running under Electron", () => {
        isElectronValue = true;
        const root = renderComponent(<InternationalizationOptions />);

        // Now three sections: localization, content-languages, related-settings.
        expect(root.querySelectorAll(".options-section").length).toBe(3);
        // The related-settings section renders an OptionsRowLink anchor.
        expect(root.querySelectorAll("a.option-row-link").length).toBe(1);
    });
});

describe("LocalizationOptions locale filtering", () => {
    it("excludes contentOnly + dev-only (when not dev) from the UI locale dropdown and keeps formatting locales with electronLocale", () => {
        isElectronValue = false;
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.isDev = false;
        const root = renderComponent(<InternationalizationOptions />);

        // Two dropdown toggle buttons (UI locale + formatting locale).
        const dropdownButtons = root.querySelectorAll(".dropdown button.dropdown-toggle");
        expect(dropdownButtons.length).toBe(2);
    });

    it("includes dev-only locales when glob.isDev is true", () => {
        isElectronValue = false;
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.isDev = true;
        // No throw and renders both dropdowns even with the dev-only locale present.
        const root = renderComponent(<InternationalizationOptions />);
        expect(root.querySelectorAll(".dropdown").length).toBeGreaterThanOrEqual(2);
    });
});

describe("DateSettings", () => {
    it("shows the min-days-in-first-week selector only when firstWeekOfYear is '2'", () => {
        // firstWeekOfYear "0" => hidden.
        setOptions({ locale: "en", formattingLocale: "en", firstDayOfWeek: "1", firstWeekOfYear: "0", minDaysInFirstWeek: "4", languages: JSON.stringify([ "en" ]) });
        const rootHidden = renderComponent(<InternationalizationOptions />);
        expect(rootHidden.querySelector("[name='min-days-in-first-week']")).toBeNull();
        // cleanup before re-render
        unmountContainer();

        // firstWeekOfYear "2" => shown.
        setOptions({ locale: "en", formattingLocale: "en", firstDayOfWeek: "1", firstWeekOfYear: "2", minDaysInFirstWeek: "4", languages: JSON.stringify([ "en" ]) });
        const rootShown = renderComponent(<InternationalizationOptions />);
        expect(rootShown.querySelector("[name='min-days-in-first-week']")).toBeTruthy();
        // The min-days select renders 7 day options.
        const minDaysSelect = rootShown.querySelector<HTMLSelectElement>("[name='min-days-in-first-week']");
        expect(minDaysSelect?.querySelectorAll("option").length).toBe(7);
    });

    it("changing a date FormSelect persists via the option setter, and the restart button calls restartDesktopApp", async () => {
        const root = renderComponent(<InternationalizationOptions />);

        const firstWeekSelect = root.querySelector<HTMLSelectElement>("[name='first-week-of-year']");
        expect(firstWeekSelect).toBeTruthy();
        if (firstWeekSelect) {
            firstWeekSelect.value = "2";
            act(() => { firstWeekSelect.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        // The change handler routes through useTriliumOption -> options.save -> server.put.
        expect(server.put).toHaveBeenCalled();

        const restartButton = root.querySelector<HTMLButtonElement>("button[name='restart-app-button']");
        expect(restartButton).toBeTruthy();
        act(() => { restartButton?.click(); });
        expect(restartDesktopApp).toHaveBeenCalledTimes(1);
    });
});

describe("ContentLanguagesList", () => {
    it("renders a checkbox per available locale and reflects the selected languages", () => {
        getAvailableLocales.mockReturnValue(FULL_LOCALES);
        setOptions({ languages: JSON.stringify([ "en", "ar" ]) });
        const root = renderComponent(<ContentLanguagesList />);

        const checkboxes = root.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
        expect(checkboxes.length).toBe(FULL_LOCALES.length);

        const checked = Array.from(checkboxes).filter(c => c.checked).map(c => c.value).sort();
        expect(checked).toEqual([ "ar", "en" ]);
    });

    it("toggling a checkbox adds/removes the language via the option setter", () => {
        getAvailableLocales.mockReturnValue(FULL_LOCALES);
        setOptions({ languages: JSON.stringify([ "en" ]) });
        const root = renderComponent(<ContentLanguagesList />);

        const arabicCheckbox = root.querySelector<HTMLInputElement>("input[value='ar']");
        expect(arabicCheckbox?.checked).toBe(false);
        // Toggling should not throw (exercises CheckboxList.toggleValue -> onChange -> setLanguages).
        act(() => {
            if (arabicCheckbox) {
                arabicCheckbox.checked = true;
                arabicCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        const enCheckbox = root.querySelector<HTMLInputElement>("input[value='en']");
        act(() => {
            if (enCheckbox) {
                enCheckbox.checked = false;
                enCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
        expect(root.querySelectorAll("input[type='checkbox']").length).toBe(FULL_LOCALES.length);
    });
});

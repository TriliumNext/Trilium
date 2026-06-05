import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    reloadFrontendApp: vi.fn()
}));

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import options from "../../../services/options";
import { reloadFrontendApp } from "../../../services/utils";
import ws from "../../../services/ws";
import { ParentComponent } from "../../react/react_utils";
import SpellcheckSettings from "./spellcheck";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
const parent = new Component();

/** Render inside a ParentComponent provider so the internal `useTriliumEvent`/option hooks register. */
function renderSpellcheck() {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render((
            <ParentComponent.Provider value={parent}>
                <SpellcheckSettings />
            </ParentComponent.Provider>
        ), el);
    });
    return el;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

type WindowWithElectron = Omit<typeof window, "electronApi"> & { electronApi?: unknown };

function setElectronApi(api: unknown) {
    (window as unknown as WindowWithElectron).electronApi = api;
}

function clearElectronApi() {
    delete (window as unknown as WindowWithElectron).electronApi;
}

beforeEach(() => {
    setOptions({});
    clearElectronApi();
    vi.clearAllMocks();
    Object.assign(ws, { logError: vi.fn() });
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container ?? document.createElement("div")); });
        container.remove();
        container = undefined;
    }
    clearElectronApi();
    vi.restoreAllMocks();
});

// --- Web (non-electron) ---------------------------------------------------------------------------

describe("SpellcheckSettings (web)", () => {
    it("renders the NoItems placeholder when not running under Electron", () => {
        const root = renderSpellcheck();
        const noItems = root.querySelector(".no-items");
        expect(noItems).not.toBeNull();
        // The Electron-only toggle / language section must be absent.
        expect(root.querySelector("input.switch-toggle")).toBeNull();
        expect(root.querySelector("ul")).toBeNull();
    });
});

// --- Electron -------------------------------------------------------------------------------------

describe("ElectronSpellcheckSettings", () => {
    function electronApi(overrides: Record<string, unknown> = {}) {
        return {
            window: { restartApp: vi.fn() },
            spellcheck: { getAvailableSpellCheckerLanguages: vi.fn(() => [] as string[]) },
            ...overrides
        };
    }

    it("renders the enable toggle and restart button; hides language/dictionary sections when disabled", () => {
        setElectronApi(electronApi());
        setOptions({ spellCheckEnabled: "false" });
        const root = renderSpellcheck();

        // The toggle reflects the disabled option.
        const toggle = root.querySelector("input.switch-toggle");
        expect(toggle).toBeInstanceOf(HTMLInputElement);
        if (toggle instanceof HTMLInputElement) {
            expect(toggle.checked).toBe(false);
        }

        // Restart button present.
        const restartBtn = root.querySelector("button[name='restart-app-button']");
        expect(restartBtn).not.toBeNull();

        // No checkbox list (languages) nor custom-dictionary button while disabled.
        expect(root.querySelector("ul")).toBeNull();
        expect(root.querySelector("button[name='open-custom-dictionary']")).toBeNull();
    });

    it("toggling the enable switch persists via options.save and reveals language + dictionary sections", async () => {
        const save = vi.spyOn(options, "save").mockResolvedValue(undefined);
        setElectronApi(electronApi({
            spellcheck: { getAvailableSpellCheckerLanguages: vi.fn(() => [ "en-US", "de" ]) }
        }));
        setOptions({ spellCheckEnabled: "false", spellCheckLanguageCode: "" });
        const root = renderSpellcheck();

        const toggle = root.querySelector("input.switch-toggle");
        expect(toggle).toBeInstanceOf(HTMLInputElement);
        if (toggle instanceof HTMLInputElement) {
            await act(async () => {
                toggle.checked = true;
                toggle.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }

        expect(save).toHaveBeenCalledWith("spellCheckEnabled", "true");

        // Sub-sections now visible: checkbox list (languages) + custom dictionary button.
        const list = root.querySelector("ul");
        expect(list).not.toBeNull();
        expect(root.querySelectorAll("input[type='checkbox'].form-check-input").length).toBe(2);
        expect(root.querySelector("button[name='open-custom-dictionary']")).not.toBeNull();
    });

    it("restart button restarts the app via the Electron API", () => {
        const api = electronApi();
        setElectronApi(api);
        setOptions({ spellCheckEnabled: "false" });
        const root = renderSpellcheck();

        const restartBtn = root.querySelector("button[name='restart-app-button']");
        expect(restartBtn).toBeInstanceOf(HTMLButtonElement);
        if (restartBtn instanceof HTMLButtonElement) {
            restartBtn.click();
        }
        expect(api.window.restartApp).toHaveBeenCalledTimes(1);
        expect(reloadFrontendApp).not.toHaveBeenCalled();
    });
});

// --- Languages section ----------------------------------------------------------------------------

describe("SpellcheckLanguages", () => {
    it("lists available languages, marks selected codes, and writes joined codes on toggle", () => {
        const save = vi.spyOn(options, "save").mockResolvedValue(undefined);
        setElectronApi({
            window: { restartApp: vi.fn() },
            spellcheck: { getAvailableSpellCheckerLanguages: vi.fn(() => [ "en-US", "fr", "de" ]) }
        });
        // Enabled, with one language already selected (also exercises trim + filter of selectedCodes).
        setOptions({ spellCheckEnabled: "true", spellCheckLanguageCode: " en-US , " });
        const root = renderSpellcheck();

        const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='checkbox'].form-check-input"));
        expect(checkboxes.length).toBe(3);

        // The already-selected language is checked.
        const enBox = checkboxes.find(c => c.value === "en-US");
        expect(enBox?.checked).toBe(true);

        // Toggling an unchecked language adds it -> codes joined with ", ".
        const frBox = checkboxes.find(c => c.value === "fr");
        expect(frBox).toBeInstanceOf(HTMLInputElement);
        if (frBox) {
            act(() => {
                frBox.checked = true;
                frBox.dispatchEvent(new Event("change", { bubbles: true }));
            });
        }
        expect(save).toHaveBeenCalledWith("spellCheckLanguageCode", "en-US, fr");
    });

    it("unchecking a selected language removes it from the joined codes", () => {
        const save = vi.spyOn(options, "save").mockResolvedValue(undefined);
        setElectronApi({
            window: { restartApp: vi.fn() },
            spellcheck: { getAvailableSpellCheckerLanguages: vi.fn(() => [ "en-US", "fr" ]) }
        });
        setOptions({ spellCheckEnabled: "true", spellCheckLanguageCode: "en-US, fr" });
        const root = renderSpellcheck();

        const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='checkbox'].form-check-input"));
        const frBox = checkboxes.find(c => c.value === "fr");
        expect(frBox?.checked).toBe(true);
        if (frBox) {
            act(() => {
                frBox.checked = false;
                frBox.dispatchEvent(new Event("change", { bubbles: true }));
            });
        }
        expect(save).toHaveBeenCalledWith("spellCheckLanguageCode", "en-US");
    });

    it("tolerates an unset language option and falls back to the raw code when no display name exists", () => {
        const realDisplayNames = Intl.DisplayNames;
        // Force `displayNames.of(code)` to return undefined so the `?? code` fallback is exercised.
        class FakeDisplayNames {
            of() { return undefined; }
        }
        Object.assign(Intl, { DisplayNames: FakeDisplayNames });
        try {
            setElectronApi({
                window: { restartApp: vi.fn() },
                spellcheck: { getAvailableSpellCheckerLanguages: vi.fn(() => [ "xx" ]) }
            });
            // spellCheckLanguageCode intentionally NOT set -> selectedCodes uses the `?? ""` fallback.
            setOptions({ spellCheckEnabled: "true" });
            const root = renderSpellcheck();

            const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='checkbox'].form-check-input"));
            expect(checkboxes.length).toBe(1);
            expect(checkboxes[0]?.value).toBe("xx");
            // No selection because the option was undefined.
            expect(checkboxes[0]?.checked).toBe(false);
            // Title text falls back to the raw code "xx".
            expect(root.textContent).toContain("xx");
        } finally {
            Object.assign(Intl, { DisplayNames: realDisplayNames });
        }
    });

    it("renders an empty language list when the spellcheck API is unavailable", () => {
        // Electron present (so we get the Electron settings) but without a spellcheck sub-API.
        setElectronApi({ window: { restartApp: vi.fn() } });
        setOptions({ spellCheckEnabled: "true", spellCheckLanguageCode: "" });
        const root = renderSpellcheck();

        // The languages <ul> exists but has no checkbox entries (availableLanguages === []).
        const lists = root.querySelectorAll("ul");
        expect(lists.length).toBeGreaterThanOrEqual(1);
        expect(root.querySelectorAll("input[type='checkbox'].form-check-input").length).toBe(0);
    });
});

// --- Custom dictionary ----------------------------------------------------------------------------

describe("CustomDictionary", () => {
    it("opening the dictionary triggers the openInPopup command", () => {
        const trigger = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as never);
        setElectronApi({
            window: { restartApp: vi.fn() },
            spellcheck: { getAvailableSpellCheckerLanguages: vi.fn(() => [] as string[]) }
        });
        setOptions({ spellCheckEnabled: "true", spellCheckLanguageCode: "" });
        const root = renderSpellcheck();

        const openBtn = root.querySelector("button[name='open-custom-dictionary']");
        expect(openBtn).toBeInstanceOf(HTMLButtonElement);
        if (openBtn instanceof HTMLButtonElement) {
            openBtn.click();
        }
        expect(trigger).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "_customDictionary" });
    });
});

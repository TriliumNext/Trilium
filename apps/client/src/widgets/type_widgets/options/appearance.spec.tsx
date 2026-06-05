import { OptionNames } from "@triliumnext/commons";
import { ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, Modal, default: { Tooltip, Dropdown, Modal } };
});

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: vi.fn(() => false),
    isMobile: vi.fn(() => false),
    reloadFrontendApp: vi.fn(),
    restartDesktopApp: vi.fn()
}));

vi.mock("../../../services/dialog", () => ({
    openDialog: vi.fn(async ($el) => $el)
}));

vi.mock("../../../components/zoom", () => ({
    default: { setZoomFactorAndSave: vi.fn(async () => undefined) }
}));

import zoomService from "../../../components/zoom";
import Component from "../../../components/component";
import options from "../../../services/options";
import server from "../../../services/server";
import { isElectron, isMobile, reloadFrontendApp, restartDesktopApp } from "../../../services/utils";
import ws from "../../../services/ws";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import AppearanceSettings from "./appearance";

// --- Render harness (wraps the component in the Trilium providers, like react_utils.tsx) -----------

let container: HTMLDivElement | undefined;
const parent = { current: new Component() };

function renderApp(node: ComponentChildren = <AppearanceSettings />) {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => {
        render((
            <ParentComponent.Provider value={parent.current}>
                <NoteContextContext.Provider value={null}>
                    {node}
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), root);
    });
    return root;
}

/** Dispatch a native DOM event inside an act() block, discarding dispatchEvent's boolean return. */
function dispatch(el: Element, event: Event) {
    act(() => { el.dispatchEvent(event); });
}

function input(el: Element) { dispatch(el, new Event("input", { bubbles: true })); }
function change(el: Element) { dispatch(el, new Event("change", { bubbles: true })); }
function blur(el: Element) { dispatch(el, new Event("focusout", { bubbles: true })); }
function click(el: HTMLElement) { act(() => { el.click(); }); }

/**
 * `OptionsRow` clones its child with a `useUniqueName(name)` id, e.g. `motion-enabled-ab12cd34ef`,
 * so a toggle / text input for a given option is reachable by id prefix even though `FormToggle`
 * does not forward the `name` attribute.
 */
function toggleFor(root: ParentNode, option: string): HTMLInputElement | null {
    return root.querySelector(`input[id^='${option}-'].switch-toggle`);
}

function fieldFor(root: ParentNode, option: string): HTMLInputElement | null {
    return root.querySelector(`input[id^='${option}-']`);
}

/**
 * `Dropdown` only mounts its children once it receives bootstrap's `show.bs.dropdown` event (the
 * real bootstrap plugin is mocked away), so trigger it manually to render the menu items.
 */
function showDropdown(root: ParentNode) {
    const dropdown = root.querySelector(".dropdown");
    if (dropdown) {
        act(() => { $(dropdown).trigger("show.bs.dropdown"); });
    }
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent.current.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

const DEFAULT_OPTIONS = {
    theme: "next",
    layoutOrientation: "vertical",
    newLayout: "false",
    overrideThemeFonts: "false",
    mainFontFamily: "theme", mainFontSize: "100",
    treeFontFamily: "theme", treeFontSize: "100",
    detailFontFamily: "theme", detailFontSize: "100",
    monospaceFontFamily: "theme", monospaceFontSize: "100",
    zoomFactor: "1",
    nativeTitleBarVisible: "false",
    backgroundEffects: "false",
    motionEnabled: "true",
    shadowsEnabled: "true",
    backdropEffectsEnabled: "true",
    smoothScrollEnabled: "true",
    maxContentWidth: "1000",
    centerContent: "true",
    editedNotesOpenInRibbon: "true"
};

beforeEach(() => {
    setOptions({ ...DEFAULT_OPTIONS });
    parent.current = new Component();
    vi.clearAllMocks();
    (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // The auto-mocked server (test/setup.ts) only defines get/post — add the write verbs and the
    // user-themes GET endpoint the UserInterface section loads on mount.
    Object.assign(server, {
        get: vi.fn(async (url: string) => (url === "options/user-themes" ? [] : undefined)),
        put: vi.fn(async () => undefined),
        upload: vi.fn(async () => undefined)
    });
    Object.assign(ws, { logError: vi.fn() });
    // Bootstrap's jQuery tooltip plugin isn't loaded in happy-dom; stub it (used by useTooltip /
    // useStaticTooltip via Dropdown, PlatformIndicator and FormListItem).
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn(), dropdown: vi.fn() });
});

afterEach(() => {
    if (container) {
        act(() => { if (container) render(null, container); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Top-level structure --------------------------------------------------------------------------

describe("AppearanceSettings", () => {
    it("renders the non-electron sections and omits the desktop section", async () => {
        const root = renderApp();
        await flush();
        const sections = root.querySelectorAll(".options-section");
        // UserInterface, Fonts, Performance, MaxContentWidth, Ribbon, RelatedSettings (no Electron).
        expect(sections.length).toBe(6);
        // No zoom-factor row (lives in the Electron section).
        expect(root.querySelector("[name='zoom-factor']")).toBeNull();
    });

    it("renders the desktop integration section when running under Electron", async () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const root = renderApp();
        await flush();
        const sections = root.querySelectorAll(".options-section");
        expect(sections.length).toBe(7);
        // Electron section adds smooth scroll inside Performance too.
        expect(root.querySelector(".switch-toggle")).toBeTruthy();
    });
});

// --- UserInterface: theme + color scheme + layout -------------------------------------------------

describe("UserInterface", () => {
    it("loads custom themes and disables color scheme for a custom theme", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([
            { val: "myTheme", title: "My Theme", icon: "bx bx-cool" }
        ]);
        setOptions({ ...DEFAULT_OPTIONS, theme: "myTheme" });
        const root = renderApp();
        await flush();
        expect(server.get).toHaveBeenCalledWith("options/user-themes");
        // Custom theme is current → color scheme buttons are disabled.
        const schemeButtons = root.querySelectorAll(".btn-group button");
        expect(schemeButtons.length).toBe(3);
        schemeButtons.forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(true));
        // Clicking a disabled scheme button is a no-op (resolved.family is null).
        click(schemeButtons[2] as HTMLElement);
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("renders the custom themes inside the opened theme dropdown and selects one", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([
            { val: "myTheme", title: "My Theme", icon: "bx bx-cool" }
        ]);
        setOptions({ ...DEFAULT_OPTIONS, theme: "next" });
        const root = renderApp();
        await flush();
        showDropdown(root);
        const items = root.querySelectorAll(".dropdown-menu .dropdown-item");
        // 2 theme families + 1 custom theme.
        expect(items.length).toBe(3);
        click(items[2] as HTMLElement); // the custom theme
        await flush();
        expect(server.put).toHaveBeenCalledWith("options", { theme: "myTheme" });
    });

    it("switching theme family persists the matching color-scheme variant", async () => {
        setOptions({ ...DEFAULT_OPTIONS, theme: "next-dark" });
        const root = renderApp();
        await flush();
        showDropdown(root);
        // The dropdown content only mounts once shown; the family items live inside the menu.
        const familyItems = root.querySelectorAll(".dropdown-menu .dropdown-item");
        expect(familyItems.length).toBe(2);
        click(familyItems[1] as HTMLElement); // legacy family
        await flush();
        // Keeps "dark" scheme when switching modern→legacy: legacy.dark === "dark".
        expect(server.put).toHaveBeenCalledWith("options", { theme: "dark" });
    });

    it("color scheme buttons set the family variant when a known family is selected", async () => {
        setOptions({ ...DEFAULT_OPTIONS, theme: "next" });
        const root = renderApp();
        await flush();
        const schemeButtons = root.querySelectorAll(".btn-group button");
        // system button is active for "next".
        expect(schemeButtons[0].className).toContain("active");
        click(schemeButtons[2] as HTMLElement); // dark
        await flush();
        expect(server.put).toHaveBeenCalledWith("options", { theme: "next-dark" });
    });

    it("renders the layout style + orientation radios on desktop and persists changes", async () => {
        setOptions({ ...DEFAULT_OPTIONS, newLayout: "false", layoutOrientation: "vertical" });
        const root = renderApp();
        await flush();
        const radios = root.querySelectorAll(".radio-with-illustration");
        expect(radios.length).toBe(2); // layout style + orientation

        // Pick the "new-layout" illustration (second item of the first radio group).
        const layoutItems = radios[0].querySelectorAll(".illustration");
        click(layoutItems[1] as HTMLElement);
        await flush();
        expect(server.put).toHaveBeenCalledWith("options", { newLayout: "true" });
        expect(reloadFrontendApp).toHaveBeenCalled();

        // Pick the "horizontal" orientation (second item of the second radio group).
        const orientItems = radios[1].querySelectorAll(".illustration");
        click(orientItems[1] as HTMLElement);
        await flush();
        expect(server.put).toHaveBeenCalledWith("options", { layoutOrientation: "horizontal" });
    });

    it("hides the layout radios on mobile", async () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const root = renderApp();
        await flush();
        expect(root.querySelectorAll(".radio-with-illustration").length).toBe(0);
    });

    it("renders both layout-style and both orientation illustration variants", async () => {
        const root = renderApp();
        await flush();
        // Both LayoutIllustration variants are always rendered (one per radio option):
        //  - new-layout variant → status bar + note-title-actions
        //  - old-layout variant → ribbon
        expect(root.querySelector(".status-bar")).toBeTruthy();
        expect(root.querySelector(".note-title-actions")).toBeTruthy();
        expect(root.querySelector(".ribbon")).toBeTruthy();
        // Both OrientationIllustration variants render too:
        //  - horizontal → full-width tab bar + horizontal launcher bar
        //  - vertical → vertical launcher bar
        expect(root.querySelector(".tab-bar.full-width")).toBeTruthy();
        expect(root.querySelector(".launcher-bar.horizontal")).toBeTruthy();
        expect(root.querySelector(".launcher-bar.vertical")).toBeTruthy();
    });
});

// --- Fonts ----------------------------------------------------------------------------------------

describe("Fonts", () => {
    it("disables font buttons until overrideThemeFonts is enabled", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "false" });
        const root = renderApp();
        await flush();
        const fontButtons = root.querySelectorAll(".font-option-row");
        expect(fontButtons.length).toBe(4); // main, tree, detail, monospace
        fontButtons.forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(true));
    });

    it("enables font buttons and opens the picker modal on click", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "true", mainFontFamily: "Arial", mainFontSize: "120" });
        const root = renderApp();
        await flush();
        const fontButtons = root.querySelectorAll(".font-option-row");
        fontButtons.forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(false));

        click(fontButtons[0] as HTMLElement);
        await flush();
        // Modal portal is appended to document.body.
        expect(document.querySelector(".font-picker-modal")).toBeTruthy();
    });

    it("toggling override-theme-fonts persists the new value", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "false" });
        const root = renderApp();
        await flush();
        const toggle = toggleFor(root, "override-theme-fonts");
        expect(toggle).toBeTruthy();
        if (toggle) {
            input(toggle);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { overrideThemeFonts: "true" });
    });

    it("the apply-changes button reloads the frontend", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "true" });
        const root = renderApp();
        await flush();
        const applyBtn = Array.from(root.querySelectorAll("button.option-row-link"))
            .find(b => b.querySelector(".bx-refresh"));
        expect(applyBtn).toBeTruthy();
        if (applyBtn) {
            click(applyBtn as HTMLElement);
        }
        expect(reloadFrontendApp).toHaveBeenCalled();
    });

    it("font picker selects a font family (monospace system-font branch)", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "true", monospaceFontFamily: "system", monospaceFontSize: "100" });
        const root = renderApp();
        await flush();
        const fontButtons = root.querySelectorAll(".font-option-row");
        // Open the monospace picker (4th button) to exercise the isMonospace system-font branch.
        click(fontButtons[3] as HTMLElement);
        await flush();

        // Each Font renders its own portalled modal; only the opened one has its body mounted.
        const modal = Array.from(document.querySelectorAll(".font-picker-modal"))
            .find(m => m.querySelector(".dropdown-item"));
        expect(modal).toBeTruthy();
        const items = modal?.querySelectorAll(".dropdown-item") ?? [];
        expect(items.length).toBeGreaterThan(0);
        // Click a concrete font family entry.
        click(items[1] as HTMLElement);
        await flush();
        expect(server.put).toHaveBeenCalledWith("options", expect.objectContaining({ monospaceFontFamily: expect.any(String) }));
    });

    it("font picker changes the font size via the slider", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "true", mainFontFamily: "theme", mainFontSize: "100" });
        const root = renderApp();
        await flush();
        const fontButtons = root.querySelectorAll(".font-option-row");
        click(fontButtons[0] as HTMLElement); // main font (exercises the theme css-variable branch)
        await flush();

        const modal = Array.from(document.querySelectorAll(".font-picker-modal"))
            .find(m => m.querySelector("input[type='range']"));
        const slider = modal?.querySelector("input[type='range']") as HTMLInputElement | null;
        expect(slider).toBeTruthy();
        if (slider) {
            slider.value = "150";
            slider.valueAsNumber = 150;
            input(slider);
            change(slider);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { mainFontSize: "150" });
    });

    it("shows a named font's value as the preview label and opens its picker", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "true", treeFontFamily: "Arial", treeFontSize: "100" });
        const root = renderApp();
        await flush();
        const fontButtons = root.querySelectorAll(".font-option-row");
        // The tree-font preview shows the named font's value (no label entry) → covers the value branch
        // of `currentFont?.label ?? currentFont?.value ?? fontFamily`.
        expect((fontButtons[1].textContent ?? "")).toContain("Arial");
        click(fontButtons[1] as HTMLElement); // tree font (passes a sizeDescription prop)
        await flush();
        const modal = Array.from(document.querySelectorAll(".font-picker-modal"))
            .find(m => m.querySelector(".dropdown-item"));
        expect(modal).toBeTruthy();
        // The preview reflects the Arial font family.
        const preview = modal?.querySelector(".font-preview-text") as HTMLElement | null;
        expect(preview?.style.fontFamily).toContain("Arial");
    });

    it("closes the font picker modal via the bootstrap hidden event", async () => {
        setOptions({ ...DEFAULT_OPTIONS, overrideThemeFonts: "true" });
        const root = renderApp();
        await flush();
        const fontButtons = root.querySelectorAll(".font-option-row");
        click(fontButtons[0] as HTMLElement);
        await flush();
        const modalEl = Array.from(document.querySelectorAll(".font-picker-modal"))
            .find(m => m.querySelector(".dropdown-item"));
        expect(modalEl).toBeTruthy();
        if (modalEl) {
            dispatch(modalEl, new Event("hidden.bs.modal", { bubbles: true }));
            await flush();
        }
        // After onHidden runs, the modal body (with its list) is unmounted.
        const stillOpen = Array.from(document.querySelectorAll(".font-picker-modal"))
            .find(m => m.querySelector(".dropdown-item"));
        expect(stillOpen).toBeFalsy();
    });
});

// --- Electron integration -------------------------------------------------------------------------

describe("ElectronIntegration", () => {
    beforeEach(() => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it("renders the zoom factor and persists via the zoom service", async () => {
        setOptions({ ...DEFAULT_OPTIONS, zoomFactor: "1.5" });
        const root = renderApp();
        await flush();
        const zoomInput = fieldFor(root, "zoom-factor");
        expect(zoomInput).toBeTruthy();
        expect(zoomInput?.value).toBe("150");
        if (zoomInput) {
            zoomInput.value = "120";
            input(zoomInput);
            await flush();
        }
        expect(zoomService.setZoomFactorAndSave).toHaveBeenCalledWith(1.2);
    });

    it("disables background effects when native title bar is on", async () => {
        setOptions({ ...DEFAULT_OPTIONS, nativeTitleBarVisible: "true" });
        const root = renderApp();
        await flush();
        const bgToggle = toggleFor(root, "background-effects");
        expect(bgToggle?.disabled).toBe(true);
    });

    it("toggling native title bar persists and the restart button restarts the app", async () => {
        setOptions({ ...DEFAULT_OPTIONS, nativeTitleBarVisible: "false" });
        const root = renderApp();
        await flush();
        const titleToggle = toggleFor(root, "native-title-bar");
        if (titleToggle) {
            input(titleToggle);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { nativeTitleBarVisible: "true" });

        // The restart button lives in the same Electron section as the native-title-bar toggle
        // (scope to it so the Fonts "apply changes" refresh button isn't matched instead).
        const electronSection = titleToggle?.closest(".options-section");
        const restartBtn = Array.from(electronSection?.querySelectorAll("button.option-row-link") ?? [])
            .find(b => b.querySelector(".bx-refresh"));
        expect(restartBtn).toBeTruthy();
        if (restartBtn) {
            click(restartBtn as HTMLElement);
        }
        expect(restartDesktopApp).toHaveBeenCalled();
    });
});

// --- Performance ----------------------------------------------------------------------------------

describe("Performance", () => {
    it("renders motion/shadow/backdrop toggles on desktop and persists changes", async () => {
        setOptions({ ...DEFAULT_OPTIONS, motionEnabled: "true" });
        const root = renderApp();
        await flush();
        const motionToggle = toggleFor(root, "motion-enabled");
        const backdropToggle = toggleFor(root, "backdrop-effects-enabled");
        expect(motionToggle).toBeTruthy();
        expect(backdropToggle).toBeTruthy(); // present because not mobile

        if (motionToggle) {
            input(motionToggle);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { motionEnabled: "false" });
    });

    it("hides the backdrop toggle on mobile", async () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const root = renderApp();
        await flush();
        expect(toggleFor(root, "backdrop-effects-enabled")).toBeNull();
    });

    it("renders the smooth-scroll toggle only under Electron", async () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const root = renderApp();
        await flush();
        const smoothToggle = toggleFor(root, "smooth-scroll-enabled");
        expect(smoothToggle).toBeTruthy();
        if (smoothToggle) {
            input(smoothToggle);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { smoothScrollEnabled: "false" });
    });
});

// --- MaxContentWidth & Ribbon ---------------------------------------------------------------------

describe("MaxContentWidth and Ribbon", () => {
    it("persists max content width on blur and toggles center content", async () => {
        setOptions({ ...DEFAULT_OPTIONS, maxContentWidth: "1000", centerContent: "true" });
        const root = renderApp();
        await flush();
        const widthInput = fieldFor(root, "max-content-width");
        expect(widthInput).toBeTruthy();
        if (widthInput) {
            widthInput.value = "1200";
            blur(widthInput);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { maxContentWidth: "1200" });

        const centerToggle = toggleFor(root, "center-content");
        if (centerToggle) {
            input(centerToggle);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { centerContent: "false" });
    });

    it("toggles the edited-notes-open-in-ribbon option", async () => {
        setOptions({ ...DEFAULT_OPTIONS, editedNotesOpenInRibbon: "false" });
        const root = renderApp();
        await flush();
        const ribbonToggle = toggleFor(root, "edited-notes-open-in-ribbon");
        expect(ribbonToggle).toBeTruthy();
        if (ribbonToggle) {
            input(ribbonToggle);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { editedNotesOpenInRibbon: "true" });
    });
});

// --- External option changes ----------------------------------------------------------------------

describe("reacting to external option changes", () => {
    it("picks up an external theme change via entitiesReloaded", async () => {
        setOptions({ ...DEFAULT_OPTIONS, theme: "next" });
        const root = renderApp();
        await flush();
        let schemeButtons = root.querySelectorAll(".btn-group button");
        expect(schemeButtons[0].className).toContain("active"); // system active for "next"

        setOptions({ ...DEFAULT_OPTIONS, theme: "next-dark" });
        fireEvent("entitiesReloaded", { loadResults: makeLoadResults([ "theme" ]) });
        await flush();
        schemeButtons = root.querySelectorAll(".btn-group button");
        expect(schemeButtons[2].className).toContain("active"); // dark now active
    });
});

// --- Fallback / edge-case branches ----------------------------------------------------------------

describe("fallback branches", () => {
    it("falls back to the raw theme string + palette icon for an unknown theme", async () => {
        // An unknown theme that is neither a built-in family nor a known custom theme exercises the
        // `?? theme` label fallback and the `?? 'bx bx-palette'` icon fallback.
        setOptions({ ...DEFAULT_OPTIONS, theme: "totally-unknown-theme" });
        const root = renderApp();
        await flush();
        expect(root.querySelector(".bx-palette")).toBeTruthy();
        // Color scheme is treated as custom → buttons disabled.
        const schemeButtons = root.querySelectorAll(".btn-group button");
        schemeButtons.forEach(btn => expect((btn as HTMLButtonElement).disabled).toBe(true));
        // The dropdown still lists the two built-in families (no custom-theme header).
        showDropdown(root);
        expect(root.querySelectorAll(".dropdown-menu .dropdown-item").length).toBe(2);
    });

    it("tolerates an undefined theme option (null coalescing in resolveTheme)", async () => {
        const opts = { ...DEFAULT_OPTIONS } as Record<string, string>;
        delete opts.theme;
        setOptions(opts);
        const root = renderApp();
        await flush();
        // resolveTheme(null) → isCustom, so scheme buttons are disabled and palette icon shows.
        expect(root.querySelector(".bx-palette")).toBeTruthy();
    });

    it("defaults layout orientation to vertical when the option is unset", async () => {
        const opts = { ...DEFAULT_OPTIONS } as Record<string, string>;
        delete opts.layoutOrientation;
        setOptions(opts);
        const root = renderApp();
        await flush();
        const radios = root.querySelectorAll(".radio-with-illustration");
        // Second radio group is the orientation one; the "vertical" option (first li) is selected.
        const orientationItems = radios[1]?.querySelectorAll("li") ?? [];
        expect(orientationItems[0]?.className).toContain("selected");
    });

    it("defaults the zoom factor to 100% when the option is empty", async () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        setOptions({ ...DEFAULT_OPTIONS, zoomFactor: "" });
        const root = renderApp();
        await flush();
        const zoomInput = fieldFor(root, "zoom-factor");
        expect(zoomInput?.value).toBe("100");
    });
});

function makeLoadResults(optionNames: string[]) {
    return {
        getAttributeRows: () => [],
        getBranchRows: () => [],
        getOptionNames: () => optionNames,
        isNoteReloaded: () => false,
        isNoteContentReloaded: () => false,
        getEntityRow: () => undefined
    };
}

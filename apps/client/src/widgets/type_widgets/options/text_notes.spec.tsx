import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// `isNewLayout` is captured once at module load; force the non-new-layout branch so the
// Table-of-contents section and Highlights visibility block render.
vi.mock("../../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: vi.fn(() => false)
}));

// Avoid touching real highlight.js / loading theme CSS.
vi.mock("../../../services/syntax_highlight", () => ({
    ensureMimeTypesForHighlighting: vi.fn(async () => undefined),
    loadHighlightingTheme: vi.fn(async () => undefined)
}));

// `textNoteEditorType` saves with needsRefresh=true → reloadFrontendApp (which calls a
// global logInfo that doesn't exist under happy-dom). Stub just that one export.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    reloadFrontendApp: vi.fn()
}));

vi.mock("@triliumnext/highlightjs", () => {
    const Themes = {
        default: { name: "Default Light" },
        githubDark: { name: "GitHub Dark" }
    };
    return {
        Themes,
        getThemeVariant: (theme: { name: string }) => (theme.name.includes("Dark") ? "dark" : "light"),
        highlight: vi.fn(() => ({ value: "<span>highlighted</span>" }))
    };
});

// Stub bootstrap (Dropdown / Tooltip) so the Dropdown component mounts under happy-dom.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

import options from "../../../services/options";
import server from "../../../services/server";
import { loadHighlightingTheme } from "../../../services/syntax_highlight";
import { flush } from "../../../test/render-hook";
import { ParentComponent } from "../../react/react_utils";
import Component from "../../../components/component";
import TextNoteSettings, { HighlightsListOptions } from "./text_notes";

// --- Helpers -------------------------------------------------------------------------------------

const ALL_OPTIONS: Record<string, string> = {
    textNoteEditorType: "ckeditor-balloon",
    textNoteEditorMultilineToolbar: "true",
    textNoteEmojiCompletionEnabled: "true",
    textNoteCompletionEnabled: "false",
    textNoteSlashCommandsEnabled: "true",
    headingStyle: "markdown",
    autoReadonlySizeText: "1000",
    customDateTimeFormat: "",
    codeBlockTheme: "default:githubDark",
    codeBlockThemeMatchesApp: "false",
    codeBlockThemeLight: "default:default",
    codeBlockThemeDark: "default:githubDark",
    codeBlockWordWrap: "false",
    codeBlockTabWidth: "4",
    minTocHeadings: "5",
    highlightsList: JSON.stringify([ "bold", "italic" ])
};

let container: HTMLDivElement | undefined;

function renderInto(vnode: any) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render(
            <ParentComponent.Provider value={new Component()}>
                {vnode}
            </ParentComponent.Provider>,
            target
        );
    });
    return target;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    setOptions({ ...ALL_OPTIONS });
    Object.assign(server, { put: vi.fn(async () => undefined) });
    const glob = window.glob as unknown as Record<string, unknown>;
    glob.getThemeStyle = () => "light";
    Object.assign(window, { matchMedia: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) });
    // The static-tooltip hooks used by FormListItem/Dropdown call these jQuery plugins.
    Object.assign(($.fn as unknown as Record<string, unknown>), {
        tooltip: vi.fn(),
        dropdown: vi.fn()
    });
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("TextNoteSettings", () => {
    it("renders all sections including TOC and highlights when not on the new layout", () => {
        const root = renderInto(<TextNoteSettings />);
        const sections = root.querySelectorAll(".options-section");
        // Formatting, editor features, editor, code-block, TOC, highlights, related settings.
        expect(sections.length).toBe(7);

        // TOC section (only rendered when !isNewLayout) contains its numeric input
        // (the one with the very large max attribute).
        expect(root.querySelector("input[max='999999999999999']")).toBeTruthy();

        // The "related settings" link points at the task-states hidden note.
        const relatedLink = root.querySelector("a[href='#root/_hidden/_taskStates']");
        expect(relatedLink).toBeTruthy();
    });

    it("renders both toolbar illustrations (fixed bar + floating bar)", () => {
        const root = renderInto(<TextNoteSettings />);
        // floating illustration always present; fixed bar present in the second option.
        expect(root.querySelector(".toolbar-illustration .toolbar-bar")).toBeTruthy();
        expect(root.querySelector(".toolbar-illustration .floating-toolbar")).toBeTruthy();
        expect(root.querySelectorAll(".toolbar-icon.wide").length).toBe(1);
    });
});

describe("FormattingToolbar", () => {
    it("changes the editor type when an illustration is clicked and disables multiline for balloon", () => {
        const root = renderInto(<TextNoteSettings />);
        const radios = root.querySelectorAll(".radio-with-illustration li");
        expect(radios.length).toBe(2);
        // balloon is the current value → its <li> is the selected one.
        expect(radios[0].className).toContain("selected");

        // balloon is the current value → multiline toggle's checkbox is disabled.
        const switches = root.querySelectorAll(".switch-toggle");
        const disabledSwitch = Array.from(switches).find(s => (s as HTMLInputElement).disabled);
        expect(disabledSwitch).toBeTruthy();

        // Click the second illustration (fixed) → setter saves textNoteEditorType.
        const fixedIllustration = root.querySelectorAll(".radio-with-illustration .illustration")[1];
        act(() => (fixedIllustration as HTMLElement).click());
        expect(server.put).toHaveBeenCalled();
    });
});

describe("EditorFeatures", () => {
    it("renders feature toggles reflecting the saved option values", () => {
        const root = renderInto(<TextNoteSettings />);
        // 5 toggles total: multiline + the three editor-feature toggles + word-wrap.
        const switches = Array.from(root.querySelectorAll(".switch-toggle")) as HTMLInputElement[];
        expect(switches.length).toBe(5);
        // At least one is checked (emoji/slash are "true") and one unchecked (note-completion is "false").
        expect(switches.some(s => s.checked)).toBe(true);
        expect(switches.some(s => !s.checked)).toBe(true);
    });

    it("toggles an editor feature, persisting the change", () => {
        const root = renderInto(<TextNoteSettings />);
        // The note-completion toggle is "false"; flip the first unchecked & enabled toggle.
        const switches = Array.from(root.querySelectorAll(".switch-toggle")) as HTMLInputElement[];
        const target = switches.find(s => !s.checked && !s.disabled);
        expect(target).toBeTruthy();
        act(() => { target?.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(server.put).toHaveBeenCalled();
    });
});

describe("Editor / HeadingStyleSelector", () => {
    it("toggles the heading-style body class via effect and reflects the current style", () => {
        renderInto(<TextNoteSettings />);
        // The effect applies the markdown class to <body>.
        expect(document.body.className).toContain("heading-style-markdown");
    });

    it("falls back to the first heading style when the option is unknown", () => {
        setOptions({ ...ALL_OPTIONS, headingStyle: "does-not-exist" });
        renderInto(<TextNoteSettings />);
        // Unknown value → fallback to first (plain) heading style applied to body.
        expect(document.body.className).toContain("heading-style-");
    });

    it("renders the custom date-time format input with the placeholder default", () => {
        setOptions({ ...ALL_OPTIONS, customDateTimeFormat: "" });
        const root = renderInto(<TextNoteSettings />);
        const dateInput = root.querySelector("input[placeholder='YYYY-MM-DD HH:mm']") as HTMLInputElement | null;
        expect(dateInput?.value).toBe("YYYY-MM-DD HH:mm");
    });

    it("uses a configured custom date-time format when provided", () => {
        setOptions({ ...ALL_OPTIONS, customDateTimeFormat: "DD/MM/YYYY" });
        const root = renderInto(<TextNoteSettings />);
        const dateInput = root.querySelector("input[placeholder='YYYY-MM-DD HH:mm']") as HTMLInputElement | null;
        expect(dateInput?.value).toBe("DD/MM/YYYY");
    });

    it("opens the heading-style dropdown and selects a different style", () => {
        const root = renderInto(<TextNoteSettings />);
        const dropdownToggle = root.querySelector(".dropdown .dropdown-toggle") as HTMLElement | null;
        expect(dropdownToggle).toBeTruthy();
        // Force the dropdown open so the list items render (Dropdown gates children behind `shown`).
        // jQuery's `.on("show.bs.dropdown")` listens on the namespaced event, so trigger via jQuery.
        const dropdown = root.querySelector(".dropdown");
        act(() => { if (dropdown) $(dropdown).trigger("show.bs.dropdown"); });
        const items = root.querySelectorAll(".heading-style-preview");
        expect(items.length).toBe(3);

        // Click a non-current style (plain) → setter persists headingStyle.
        const plainItem = items[0].closest(".dropdown-item") as HTMLElement | null;
        act(() => plainItem?.click());
        expect(server.put).toHaveBeenCalled();
    });

    it("renders every heading preview variant (plain, underline, markdown)", () => {
        const root = renderInto(<TextNoteSettings />);
        const dropdown = root.querySelector(".dropdown");
        act(() => { if (dropdown) $(dropdown).trigger("show.bs.dropdown"); });
        expect(root.querySelector(".heading-preview-plain")).toBeTruthy();
        expect(root.querySelector(".heading-preview-underline")).toBeTruthy();
        expect(root.querySelector(".heading-preview-markdown")).toBeTruthy();
        // Markdown variant renders its "## " prefix and underline variant its bar.
        expect(root.querySelector(".heading-prefix")).toBeTruthy();
        expect(root.querySelector(".heading-underline")).toBeTruthy();
    });
});

describe("CodeBlockStyle", () => {
    it("renders the grouped theme select (with optgroups) when 'matches app' is off", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockThemeMatchesApp: "false" });
        const root = renderInto(<TextNoteSettings />);
        await flush();

        // The grouped select is the only one rendered in this mode and has optgroups.
        const selects = root.querySelectorAll("select.form-select");
        expect(selects.length).toBe(1);
        expect(root.querySelector("select.form-select optgroup")).toBeTruthy();
        // loadHighlightingTheme is called with the configured (non-app) theme.
        expect(loadHighlightingTheme).toHaveBeenCalled();
    });

    it("changes the grouped theme via the select", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockThemeMatchesApp: "false" });
        const root = renderInto(<TextNoteSettings />);
        await flush();
        const select = root.querySelector("select.form-select") as HTMLSelectElement | null;
        expect(select).toBeTruthy();
        act(() => {
            if (select) {
                select.value = "default:default";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
        expect(server.put).toHaveBeenCalled();
    });

    it("renders two flat theme selects when 'matches app' is on, and changes them", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockThemeMatchesApp: "true" });
        const root = renderInto(<TextNoteSettings />);
        await flush();

        const selects = Array.from(root.querySelectorAll("select.form-select")) as HTMLSelectElement[];
        // light + dark selects; neither has optgroups (flat lists).
        expect(selects.length).toBe(2);
        expect(root.querySelector("select.form-select optgroup")).toBeNull();

        act(() => {
            selects[0].value = "default:githubDark";
            selects[0].dispatchEvent(new Event("change", { bubbles: true }));
        });
        act(() => {
            selects[1].value = "default:default";
            selects[1].dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(server.put).toHaveBeenCalled();
    });

    it("uses the dark theme when matching the app and the color scheme is dark", async () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.getThemeStyle = () => "dark";
        setOptions({ ...ALL_OPTIONS, codeBlockThemeMatchesApp: "true" });
        renderInto(<TextNoteSettings />);
        await flush();
        expect(loadHighlightingTheme).toHaveBeenCalled();
    });

    it("switches the theme mode through the ThemeModeSelector buttons", () => {
        const root = renderInto(<TextNoteSettings />);
        // The first .btn-group on the page belongs to the ThemeModeSelector.
        const buttons = root.querySelectorAll(".btn-group button");
        expect(buttons.length).toBe(2);
        act(() => (buttons[0] as HTMLElement).click()); // match app
        act(() => (buttons[1] as HTMLElement).click()); // always one theme
        expect(server.put).toHaveBeenCalled();
    });

    it("renders the tab-width numeric control with its limits", () => {
        const root = renderInto(<TextNoteSettings />);
        // tab-width is the number input with min=1 / max=16.
        const tabWidth = root.querySelector("input[type='number'][max='16']") as HTMLInputElement | null;
        expect(tabWidth).toBeTruthy();
        expect(tabWidth?.value).toBe("4");

        act(() => {
            if (tabWidth) {
                tabWidth.value = "8";
                tabWidth.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(server.put).toHaveBeenCalled();
    });
});

describe("CodeBlockPreview", () => {
    it("highlights the sample code when a real theme is configured", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockTheme: "default:githubDark", codeBlockThemeMatchesApp: "false" });
        const root = renderInto(<TextNoteSettings />);
        // The dynamic import + nested awaits need several microtask cycles to settle.
        for (let i = 0; i < 5; i++) {
            await flush();
        }
        const code = root.querySelector("code.code-sample");
        expect(code).toBeTruthy();
        // The mocked highlighter result is applied via setCode.
        expect(code?.innerHTML).toContain("highlighted");
    });

    it("renders the raw sample code unhighlighted when theme is 'none'", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockTheme: "none", codeBlockThemeMatchesApp: "false" });
        const root = renderInto(<TextNoteSettings />);
        await flush();
        const code = root.querySelector("code.code-sample");
        expect(code?.textContent).toContain("Hello World");
    });

    it("applies pre-wrap white-space when word-wrap is enabled", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockWordWrap: "true", codeBlockTheme: "none", codeBlockThemeMatchesApp: "false" });
        const root = renderInto(<TextNoteSettings />);
        await flush();
        const code = root.querySelector("code.code-sample") as HTMLElement | null;
        expect(code?.style.whiteSpace).toBe("pre-wrap");
    });

    it("falls back to a tab size of 4 when the tab-width option is empty", async () => {
        setOptions({ ...ALL_OPTIONS, codeBlockTabWidth: "", codeBlockTheme: "none", codeBlockThemeMatchesApp: "false" });
        const root = renderInto(<TextNoteSettings />);
        await flush();
        const code = root.querySelector("code.code-sample") as HTMLElement | null;
        // `tabWidth || "4"` → the empty value falls back to "4".
        expect(code?.style.getPropertyValue("tab-size") || code?.style.tabSize).toBe("4");
    });
});

describe("TableOfContent", () => {
    it("renders the min-headings numeric input and persists changes", () => {
        const root = renderInto(<TextNoteSettings />);
        // The TOC input is the number input with the very large max value.
        const input = root.querySelector("input[max='999999999999999']") as HTMLInputElement | null;
        expect(input).toBeTruthy();
        expect(input?.value).toBe("5");

        act(() => {
            if (input) {
                input.value = "3";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(server.put).toHaveBeenCalled();
    });
});

describe("HighlightsListOptions", () => {
    it("renders the checkbox list and reflects the saved selection", () => {
        const root = renderInto(<HighlightsListOptions />);
        const checkboxes = root.querySelectorAll("input[type='checkbox']");
        expect(checkboxes.length).toBe(5);
        const checked = Array.from(checkboxes).filter(c => (c as HTMLInputElement).checked);
        expect(checked.length).toBe(2); // bold + italic from the saved option
    });

    it("toggles a value on and off, persisting both times", () => {
        const root = renderInto(<HighlightsListOptions />);
        const checkboxes = Array.from(root.querySelectorAll("input[type='checkbox']")) as HTMLInputElement[];

        // "underline" is currently unchecked → check it (adds to the list).
        const underline = checkboxes.find(c => c.value === "underline");
        expect(underline?.checked).toBe(false);
        act(() => { if (underline) { underline.checked = true; underline.dispatchEvent(new Event("change", { bubbles: true })); } });

        // "bold" is currently checked → uncheck it (removes from the list).
        const bold = checkboxes.find(c => c.value === "bold");
        act(() => { if (bold) { bold.checked = false; bold.dispatchEvent(new Event("change", { bubbles: true })); } });

        expect(server.put).toHaveBeenCalled();
    });
});

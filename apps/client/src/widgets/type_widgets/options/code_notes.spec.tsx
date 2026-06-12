import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../../test/mocks";
import { renderInto } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

// Replace the heavy CodeMirror editor (EditorView subclass) with a lightweight spy double so the
// preview useEffect can mount without pulling in @codemirror/view DOM machinery. Named exports
// (ColorThemes / getThemeById / ThemeVariant) are preserved from the real module.
interface FakeCodeMirror {
    parent: HTMLElement;
    text: string;
    mimeType: string;
    lineWrapping: boolean;
    indentSize: number;
    theme: unknown;
    destroyed: boolean;
    setText(text: string): void;
    setMimeType(mime: string): void;
    setLineWrapping(value: boolean): void;
    setIndentSize(size: number): void;
    setTheme(theme: unknown): void;
    destroy(): void;
}

const { cmInstances } = vi.hoisted(() => ({ cmInstances: [] as FakeCodeMirror[] }));

vi.mock("@triliumnext/codemirror", async (importOriginal) => {
    class FakeCodeMirrorImpl {
        parent: HTMLElement;
        text = "";
        mimeType = "";
        lineWrapping = false;
        indentSize = 4;
        theme: unknown = null;
        destroyed = false;
        constructor(config: { parent: HTMLElement }) { this.parent = config.parent; cmInstances.push(this); }
        setText(text: string) { this.text = text; }
        setMimeType(mime: string) { this.mimeType = mime; }
        setLineWrapping(value: boolean) { this.lineWrapping = value; }
        setIndentSize(size: number) { this.indentSize = size; }
        setTheme(theme: unknown) { this.theme = theme; }
        destroy() { this.destroyed = true; }
    }
    return {
        ...(await importOriginal<typeof import("@triliumnext/codemirror")>()),
        default: FakeCodeMirrorImpl
    };
});

import { Tooltip as MockTooltip } from "bootstrap";

import options from "../../../services/options";
import server from "../../../services/server";
import CodeNoteSettings, { CodeMimeTypesList } from "./code_notes";

// --- Render helper -------------------------------------------------------------------------------

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

const DEFAULT_OPTIONS: Record<string, string> = {
    codeLineWrapEnabled: "true",
    codeNoteTabWidth: "4",
    vimKeymapEnabled: "false",
    autoReadonlySizeCode: "1000",
    codeNoteTheme: "default:github-light",
    codeNoteThemeMatchesApp: "false",
    codeNoteThemeLight: "default:github-light",
    codeNoteThemeDark: "default:github-dark",
    codeNotesMimeTypes: JSON.stringify([ "text/x-csrc" ])
};

beforeEach(() => {
    cmInstances.length = 0;
    setOptions({ ...DEFAULT_OPTIONS });
    vi.clearAllMocks();

    // useColorScheme() reads window.glob.getThemeStyle() (the global inert matchMedia handles the rest).
    Object.assign(window.glob as unknown as Record<string, unknown>, { getThemeStyle: () => "light" });
});

function fireChange(el: Element) {
    el.dispatchEvent(new Event("change", { bubbles: true }));
}
function fireInput(el: Element) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

// --- Tests ---------------------------------------------------------------------------------------

describe("CodeNoteSettings (top-level)", () => {
    it("renders the three sections and mounts a preview editor", () => {
        const root = renderInto(<CodeNoteSettings />);
        const sections = root.querySelectorAll(".options-section");
        expect(sections.length).toBe(3);
        // Appearance section carries the dedicated class.
        expect(root.querySelector(".code-block-appearance")).toBeTruthy();
        // The preview container and the (mocked) editor instance.
        expect(root.querySelector(".note-detail-readonly-code-content")).toBeTruthy();
        expect(cmInstances.length).toBe(1);
        const editor = cmInstances[0];
        expect(editor?.mimeType).toBe("application/typescript");
        // wordWrapping = codeLineWrapEnabled = true was pushed into the editor.
        expect(editor?.lineWrapping).toBe(true);
        // indentSize derives from codeNoteTabWidth (4).
        expect(editor?.indentSize).toBe(4);
        // Theme starts with the default prefix, so a theme object was resolved & applied.
        expect(editor?.theme).toBeTruthy();
    });

    it("defaults indent size to 4 when tab width option is non-numeric", () => {
        setOptions({ ...DEFAULT_OPTIONS, codeNoteTabWidth: "abc" });
        renderInto(<CodeNoteSettings />);
        expect(cmInstances[0]?.indentSize).toBe(4);
    });

    it("does not apply a theme when the option lacks the default prefix", () => {
        setOptions({ ...DEFAULT_OPTIONS, codeNoteTheme: "custom-theme" });
        renderInto(<CodeNoteSettings />);
        expect(cmInstances[0]?.theme).toBeNull();
    });

    it("leaves the theme unset for an unknown default-prefixed theme id", () => {
        setOptions({ ...DEFAULT_OPTIONS, codeNoteTheme: "default:does-not-exist" });
        renderInto(<CodeNoteSettings />);
        expect(cmInstances[0]?.theme).toBeNull();
    });
});

describe("Editor section", () => {
    it("toggles word wrapping, saving the option and updating the preview", async () => {
        const root = renderInto(<CodeNoteSettings />);
        expect(cmInstances[0]?.lineWrapping).toBe(true);

        const wordWrapToggle = root.querySelector(".option-row input.switch-toggle");
        expect(wordWrapToggle).toBeTruthy();
        if (wordWrapToggle) {
            // FormToggle flips on the native `input` event (not `change`).
            await act(async () => { fireInput(wordWrapToggle); });
        }
        expect(server.put).toHaveBeenCalled();
        // The preview reacts to the new wordWrapping value (top-level state is shared via prop).
        expect(cmInstances[0]?.lineWrapping).toBe(false);
    });

    it("writes the tab width on input and re-indents the preview", async () => {
        const root = renderInto(<CodeNoteSettings />);
        const numberInputs = root.querySelectorAll("input[type='number']");
        // First number input is the tab width.
        const tabWidth = numberInputs[0] as HTMLInputElement | undefined;
        expect(tabWidth).toBeTruthy();
        if (tabWidth) {
            tabWidth.value = "8";
            await act(async () => { fireInput(tabWidth); });
        }
        // Editor owns its own codeNoteTabWidth state; the persisted write is what we verify here
        // (the preview only re-derives once an entitiesReloaded event syncs the top-level read).
        expect(server.put).toHaveBeenCalled();
    });

    it("writes the auto-readonly threshold on blur", async () => {
        const root = renderInto(<CodeNoteSettings />);
        const numberInputs = root.querySelectorAll("input[type='number']");
        const threshold = numberInputs[1] as HTMLInputElement | undefined;
        expect(threshold).toBeTruthy();
        if (threshold) {
            threshold.value = "500";
            await act(async () => { threshold.dispatchEvent(new Event("focusout", { bubbles: true })); });
        }
        expect(server.put).toHaveBeenCalled();
    });

    it("toggles the vim keymap option", async () => {
        const root = renderInto(<CodeNoteSettings />);
        const checkboxes = root.querySelectorAll(".option-row input.switch-toggle");
        // Last toggle in the Editor section is the vim keymap.
        const vimToggle = checkboxes[checkboxes.length - 1] as HTMLInputElement | undefined;
        expect(vimToggle).toBeTruthy();
        if (vimToggle) {
            await act(async () => { fireInput(vimToggle); });
        }
        expect(server.put).toHaveBeenCalled();
    });
});

describe("Appearance section - theme selection", () => {
    it("shows a single color-scheme select when not matching the app", () => {
        const root = renderInto(<CodeNoteSettings />);
        const appearance = root.querySelector(".code-block-appearance");
        const selects = appearance?.querySelectorAll("select") ?? [];
        // Theme-mode buttons + single combobox.
        expect(selects.length).toBe(1);
        // Two mode buttons present.
        const modeButtons = appearance?.querySelectorAll(".btn-secondary") ?? [];
        expect(modeButtons.length).toBe(2);
    });

    it("changing the color-scheme select saves the codeNoteTheme option and applies it to the preview", async () => {
        const root = renderInto(<CodeNoteSettings />);
        const appearance = root.querySelector(".code-block-appearance");
        const select = appearance?.querySelector("select") as HTMLSelectElement | undefined;
        expect(select).toBeTruthy();
        if (select) {
            select.value = "default:monokai";
            await act(async () => { fireChange(select); });
        }
        expect(server.put).toHaveBeenCalled();
        // Preview picks up the new theme (monokai exists -> truthy theme object).
        expect(cmInstances[0]?.theme).toBeTruthy();
    });

    it("switching to 'match app' reveals separate light and dark theme selects", async () => {
        const root = renderInto(<CodeNoteSettings />);
        const appearance = root.querySelector(".code-block-appearance");
        const modeButtons = appearance?.querySelectorAll(".btn-secondary") ?? [];
        const matchAppButton = modeButtons[0];
        expect(matchAppButton).toBeTruthy();
        if (matchAppButton) {
            await act(async () => { (matchAppButton as HTMLButtonElement).click(); });
        }
        expect(server.put).toHaveBeenCalled();
        // codeNoteThemeMatchesApp is now persisted; re-render with that value to expose both selects.
        setOptions({ ...DEFAULT_OPTIONS, codeNoteThemeMatchesApp: "true" });
        const root2 = renderInto(<CodeNoteSettings />);
        const appearance2 = root2.querySelector(".code-block-appearance");
        const selects = appearance2?.querySelectorAll("select") ?? [];
        expect(selects.length).toBe(2);
    });

    it("uses the light theme as the effective preview theme when matching a light app", () => {
        Object.assign(window.glob as unknown as Record<string, unknown>, { getThemeStyle: () => "light" });
        setOptions({ ...DEFAULT_OPTIONS, codeNoteThemeMatchesApp: "true", codeNoteThemeLight: "default:basic-light" });
        renderInto(<CodeNoteSettings />);
        // basic-light exists -> theme applied.
        expect(cmInstances[0]?.theme).toBeTruthy();
    });

    it("uses the dark theme as the effective preview theme when matching a dark app", () => {
        Object.assign(window.glob as unknown as Record<string, unknown>, { getThemeStyle: () => "dark" });
        setOptions({ ...DEFAULT_OPTIONS, codeNoteThemeMatchesApp: "true", codeNoteThemeDark: "default:basic-dark" });
        renderInto(<CodeNoteSettings />);
        expect(cmInstances[0]?.theme).toBeTruthy();
    });

    it("saves the light and dark theme options independently in match-app mode", async () => {
        setOptions({ ...DEFAULT_OPTIONS, codeNoteThemeMatchesApp: "true" });
        const root = renderInto(<CodeNoteSettings />);
        const appearance = root.querySelector(".code-block-appearance");
        const selects = appearance?.querySelectorAll("select") ?? [];
        expect(selects.length).toBe(2);

        const lightSelect = selects[0] as HTMLSelectElement;
        lightSelect.value = "default:basic-light";
        await act(async () => { fireChange(lightSelect); });

        const darkSelect = selects[1] as HTMLSelectElement;
        darkSelect.value = "default:basic-dark";
        await act(async () => { fireChange(darkSelect); });

        expect(server.put).toHaveBeenCalledTimes(2);
    });
});

describe("CodeMimeTypesList", () => {
    it("renders grouped mime-type checkboxes with text/plain disabled & checked", () => {
        const root = renderInto(<CodeMimeTypesList />);
        const list = root.querySelector("ul.options-mime-types");
        expect(list).toBeTruthy();
        // Several alphabetical group sections.
        const sections = list?.querySelectorAll("section") ?? [];
        expect(sections.length).toBeGreaterThan(1);
        // The empty-initial group (text/plain) has no <h5>; others do.
        const headers = list?.querySelectorAll("h5") ?? [];
        expect(headers.length).toBeGreaterThan(0);

        const checkboxes = list?.querySelectorAll("input[type='checkbox']") ?? [];
        expect(checkboxes.length).toBeGreaterThan(1);
        // text/plain is always locked (disabled) via the disabledProperty mapping.
        const plain = Array.from(checkboxes).find(c => (c as HTMLInputElement).value === "text/plain") as HTMLInputElement | undefined;
        expect(plain).toBeTruthy();
        expect(plain?.disabled).toBe(true);
    });

    it("reflects the persisted selection and toggles a mime type on/off", async () => {
        const root = renderInto(<CodeMimeTypesList />);
        const checkboxes = Array.from(root.querySelectorAll("ul.options-mime-types input[type='checkbox']")) as HTMLInputElement[];
        const preChecked = checkboxes.find(c => c.value === "text/x-csrc");
        // The persisted codeNotesMimeTypes contains text/x-csrc -> it should be checked.
        expect(preChecked?.checked).toBe(true);

        // Toggle an unselected, enabled mime type ON.
        const toggleOn = checkboxes.find(c => !c.checked && !c.disabled);
        expect(toggleOn).toBeTruthy();
        if (toggleOn) {
            toggleOn.checked = true;
            await act(async () => { fireChange(toggleOn); });
        }
        expect(server.put).toHaveBeenCalledTimes(1);

        // Toggle the already-selected one OFF.
        if (preChecked) {
            preChecked.checked = false;
            await act(async () => { fireChange(preChecked); });
        }
        expect(server.put).toHaveBeenCalledTimes(2);
    });

    it("builds a syntax-highlighting tooltip title for a code mime type", () => {
        const root = renderInto(<CodeMimeTypesList />);
        const ul = root.querySelector("ul.options-mime-types");
        expect(ul).toBeTruthy();

        // The static tooltip is installed on the <ul>; its title() callback is invoked by bootstrap
        // bound to the hovered element. Reach the stored config and call it ourselves.
        const titleFn = ul ? getTooltipTitleFn(ul) : undefined;
        expect(typeof titleFn).toBe("function");

        const labels = Array.from(root.querySelectorAll("ul.options-mime-types label")) as HTMLElement[];
        const codeLabel = labels.find(l => {
            const v = l.querySelector("input")?.value;
            return v && v !== "text/plain";
        });
        expect(codeLabel).toBeTruthy();

        if (titleFn && codeLabel) {
            const result = titleFn.call(codeLabel);
            // The non-empty branch produces HTML with the check/cross indicators.
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
            expect(result).toMatch(/✅|❌/);
        }

        // Invoke across every code label so both the "✅" and "❌" arms of each ternary are exercised
        // (some mimes have code-block syntax, some code-note syntax, some neither).
        const allResults = labels
            .filter(l => {
                const v = l.querySelector("input")?.value;
                return v && v !== "text/plain";
            })
            .map(l => (titleFn ? titleFn.call(l) : ""))
            .join("");
        expect(allResults).toContain("✅");
        expect(allResults).toContain("❌");
    });

    it("returns an empty tooltip title for plain-text and for elements without an input", () => {
        const root = renderInto(<CodeMimeTypesList />);
        const ul = root.querySelector("ul.options-mime-types");
        const titleFn = ul ? getTooltipTitleFn(ul) : undefined;
        expect(typeof titleFn).toBe("function");

        const plainLabel = Array.from(root.querySelectorAll("ul.options-mime-types label"))
            .find(l => l.querySelector("input")?.value === "text/plain") as HTMLElement | undefined;
        expect(plainLabel).toBeTruthy();

        if (titleFn && plainLabel) {
            // text/plain short-circuits to an empty title.
            expect(titleFn.call(plainLabel)).toBe("");
            // An element with no <input> also short-circuits.
            expect(titleFn.call(document.createElement("div"))).toBe("");
        }
    });
});

type TooltipTitleFn = (this: Element) => string;

function getTooltipTitleFn(el: Element): TooltipTitleFn | undefined {
    const instance = MockTooltip.getInstance(el) as { config?: { title?: TooltipTitleFn } } | null;
    return instance?.config?.title;
}

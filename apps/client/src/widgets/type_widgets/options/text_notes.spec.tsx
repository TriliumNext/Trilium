import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string | boolean>,
    saved: [] as [ string, string | boolean ][],
    colorScheme: "light" as "light" | "dark"
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The new layout drops the right pane's own settings; this file's page is the old-layout one.
vi.mock("../../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: () => false
}));

vi.mock("../../../services/syntax_highlight", () => ({
    ensureMimeTypesForHighlighting: async () => {},
    loadHighlightingTheme: vi.fn()
}));

vi.mock("@triliumnext/highlightjs", () => ({
    Themes: {
        "one-light": { name: "One Light" },
        "one-dark": { name: "One Dark" }
    },
    getThemeVariant: (theme: { name: string }) => (theme.name.includes("Dark") ? "dark" : "light"),
    highlight: () => ({ value: "" })
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useColorScheme: () => mocks.colorScheme,
    useTriliumOption: (name: string) => [
        String(mocks.stored[name] ?? ""),
        (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionBool: (name: string) => [
        mocks.stored[name] === true,
        (value: boolean) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionJson: () => [ [], vi.fn() ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import TextNoteSettings from "./text_notes";

let host: HTMLElement;

beforeEach(() => {
    mocks.stored = { textNoteEditorType: "ckeditor-classic", codeBlockTabWidth: "4" };
    mocks.saved = [];
    mocks.colorScheme = "light";
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

function open() {
    act(() => {
        render(null, host);
        render(<TextNoteSettings />, host);
    });
}

const cardHeadings = () =>
    [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.firstChild?.textContent);
const optionLabels = () =>
    [ ...host.querySelectorAll(".tn-card-option-label") ].map((label) => label.firstChild?.textContent);
const toggle = (name: string) => host.querySelector<HTMLInputElement>(`input.switch-toggle[id^='${name}-']`);

describe("the page's shape", () => {
    it("opens on the illustrated toolbar choice, with the multi-line setting under its own heading", () => {
        open();

        expect(cardHeadings().slice(0, 2)).toEqual([
            "editing.editor_type.toolbar_style",
            "editing.editor_type.label"
        ]);
        // A pair of pictures, given a card that stands back behind them.
        expect(host.querySelector(".thumbnail-selector-option-card .radio-with-illustration")).not.toBeNull();
    });

    it("tells what the highlights list is made of apart from where it is shown", () => {
        open();

        expect(cardHeadings()).toEqual(expect.arrayContaining([
            "highlights_list.title",
            "highlights_list.visibility_title"
        ]));
    });
});

describe("the formatting toolbar", () => {
    it("has nothing to wrap onto a second line while the toolbar follows the cursor", () => {
        open();
        expect(toggle("multiline-toolbar")?.disabled).toBe(false);

        mocks.stored = { ...mocks.stored, textNoteEditorType: "ckeditor-balloon" };
        open();
        expect(toggle("multiline-toolbar")?.disabled).toBe(true);
    });

    it("writes the chosen style back, from the picture that was pressed", () => {
        open();

        const [ floating ] = [ ...host.querySelectorAll<HTMLElement>(".radio-with-illustration .illustration") ];
        act(() => floating.click());

        expect(mocks.saved).toContainEqual([ "textNoteEditorType", "ckeditor-balloon" ]);
    });
});

describe("the code block appearance", () => {
    it("asks for one theme when it is not to follow the app, and for a pair when it is", () => {
        open();
        expect(optionLabels()).toContain("highlighting.color-scheme");

        mocks.stored = { ...mocks.stored, codeBlockThemeMatchesApp: true };
        open();
        expect(optionLabels()).not.toContain("highlighting.color-scheme");
        expect(optionLabels()).toEqual(expect.arrayContaining([ "code_theme.light_theme", "code_theme.dark_theme" ]));
    });

    it("shows a sample of what the settings amount to, in a segment of its own", () => {
        open();
        expect(host.querySelector(".code-block-preview .code-sample")).not.toBeNull();
    });
});

describe("the automatic replacements", () => {
    it("offers the same set of quotation marks for both keys, which convention rather than the marks decides", () => {
        open();

        const [ doubleQuotes, singleQuotes ] = [ ...host.querySelectorAll<HTMLSelectElement>(".text-notes-replacements select") ];
        expect(doubleQuotes.querySelectorAll("option").length).toBe(singleQuotes.querySelectorAll("option").length);
        // "Based on the note's content language" and "Disabled", ahead of the mark pairs themselves.
        expect(doubleQuotes.querySelectorAll("option").length).toBeGreaterThan(2);
    });

    it("writes a chosen pair back to the key it was chosen for", () => {
        open();

        const [ doubleQuotes ] = [ ...host.querySelectorAll<HTMLSelectElement>(".text-notes-replacements select") ];
        act(() => {
            doubleQuotes.value = "off";
            doubleQuotes.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(mocks.saved).toContainEqual([ "textNoteDoubleQuoteStyle", "off" ]);
    });
});

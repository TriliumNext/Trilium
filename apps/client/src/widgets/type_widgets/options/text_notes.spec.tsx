import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string | boolean>,
    saved: [] as [ string, string | boolean ][],
    colorScheme: "light" as "light" | "dark",
    showVimModeNotice: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

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
vi.mock("../text/vim_mode", () => ({ showVimModeNotice: mocks.showVimModeNotice }));

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

describe("the editor features", () => {
    it("offers link retrieval and sticky headers after link previews, writing them back", () => {
        open();
        const labels = optionLabels();
        const linkPreviews = labels.indexOf("editorfeatures.auto_link_previews_enabled");
        expect(linkPreviews).not.toBe(-1);
        expect(labels.slice(linkPreviews + 1, linkPreviews + 4)).toStrictEqual([
            "editorfeatures.link_title_retrieval_enabled",
            "editorfeatures.link_details_retrieval_enabled",
            "editorfeatures.sticky_table_headers_enabled"
        ]);

        const switches = [
            "link-title-retrieval-enabled",
            "link-details-retrieval-enabled",
            "sticky-table-headers-enabled"
        ].map(toggle);
        expect(switches).not.toContain(null);
        for (const toggled of switches) {
            act(() => toggled?.click());
        }
        expect(mocks.saved).toEqual(expect.arrayContaining([
            [ "textNoteLinkTitleRetrievalEnabled", true ],
            [ "textNoteLinkDetailsRetrievalEnabled", true ],
            [ "textNoteStickyTableHeadersEnabled", true ]
        ]));
    });
});

describe("Vim mode", () => {
    it("explains Vim mode the first time it is turned on, and shows its settings while on", () => {
        open();
        expect(optionLabels()).toContain("vim_mode.option");
        expect(optionLabels()).not.toContain("vim_mode.insert_keys");
        act(() => toggle("vim-mode-enabled")?.click());
        expect(mocks.saved).toEqual([
            [ "textNoteVimModeEnabled", true ], [ "textNoteVimModeNoticeShown", true ]
        ]);
        expect(mocks.showVimModeNotice).toHaveBeenCalledTimes(1);

        mocks.stored = { ...mocks.stored, textNoteVimModeNoticeShown: true };
        mocks.saved = [];
        open();
        act(() => toggle("vim-mode-enabled")?.click());
        expect(mocks.saved).toEqual([ [ "textNoteVimModeEnabled", true ] ]);
        expect(mocks.showVimModeNotice).toHaveBeenCalledTimes(1);

        mocks.stored = {
            ...mocks.stored,
            textNoteVimModeEnabled: true,
            textNoteVimStartupCommands: "imap jk <Esc>"
        };
        mocks.saved = [];
        open();
        act(() => toggle("vim-hints-enabled")?.click());
        act(() => toggle("vim-insert-keys-enabled")?.click());
        const commands = host.querySelector<HTMLTextAreaElement>("textarea.vim-startup-commands");
        expect(commands?.value).toBe("imap jk <Esc>");
        act(() => {
            if (!commands) return;
            commands.value = "nmap Y y$";
            commands.dispatchEvent(new Event("focusout", { bubbles: true }));
        });
        expect(mocks.saved).toEqual([
            [ "vimModeHintsEnabled", true ], [ "textNoteVimInsertKeysEnabled", true ],
            [ "textNoteVimStartupCommands", "nmap Y y$" ]
        ]);
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

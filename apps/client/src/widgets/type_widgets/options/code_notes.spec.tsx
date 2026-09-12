import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string | boolean>,
    saved: [] as [ string, string | boolean ][],
    colorScheme: "light" as "light" | "dark"
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The preview instantiates the real editor, which happy-dom has no layout for; the settings around
// it are what these cases read.
vi.mock("@triliumnext/codemirror", () => ({
    default: class {
        setText() {}
        setMimeType() {}
        setLineWrapping() {}
        setIndentSize() {}
        setTheme() {}
        destroy() {}
    },
    ColorThemes: [
        { id: "one-light", name: "One Light", variant: "light" },
        { id: "solarized", name: "Solarized", variant: "light" },
        { id: "one-dark", name: "One Dark", variant: "dark" }
    ],
    getThemeById: (id: string) => ({ id })
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
    // The MIME type list at the foot of the page reads its set as JSON and hangs a delegated
    // tooltip off it; neither is what these cases are about.
    useTriliumOptionJson: () => [ [], vi.fn() ],
    useStaticTooltip: vi.fn()
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import CodeNoteSettings from "./code_notes";

let host: HTMLElement;

beforeEach(() => {
    mocks.stored = { codeNoteTabWidth: "4" };
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
        render(<CodeNoteSettings />, host);
    });
}

const optionLabels = () =>
    [ ...host.querySelectorAll(".tn-card-option-label") ].map((label) => label.firstChild?.textContent);
const selects = () => [ ...host.querySelectorAll<HTMLSelectElement>("select") ];

describe("the code note theme", () => {
    it("asks for one theme when it is not to follow the app, and for a pair when it is", () => {
        open();
        expect(optionLabels()).toContain("code_theme.color-scheme");
        expect(optionLabels()).not.toContain("code_theme.light_theme");

        mocks.stored = { ...mocks.stored, codeNoteThemeMatchesApp: true };
        open();
        expect(optionLabels()).not.toContain("code_theme.color-scheme");
        expect(optionLabels()).toEqual(expect.arrayContaining([ "code_theme.light_theme", "code_theme.dark_theme" ]));
    });

    it("offers each list only the themes of its own kind, and every theme to the single choice", () => {
        open();
        // The one fixed choice: light and dark alike.
        expect(selects()[0].querySelectorAll("option")).toHaveLength(3);

        mocks.stored = { ...mocks.stored, codeNoteThemeMatchesApp: true };
        open();
        const [ light, dark ] = selects();
        expect(light.querySelectorAll("option")).toHaveLength(2);
        expect(dark.querySelectorAll("option")).toHaveLength(1);
    });

    it("writes the theme back to the option the list stands for", () => {
        open();

        act(() => {
            const select = selects()[0];
            select.value = "default:one-dark";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(mocks.saved).toContainEqual([ "codeNoteTheme", "default:one-dark" ]);
    });
});

describe("the code note editor settings", () => {
    it("shows the preview as a segment of its own, framed the way a code block is", () => {
        open();

        // A segment of its own, holding the editor rather than a control beside a label — and a
        // padded one, so the sample sits in the card the way a code block sits in a note.
        const preview = host.querySelector(".code-note-preview");
        expect(preview?.className).not.toContain("tn-no-padding");
        expect(preview?.querySelector(".note-detail-readonly-code-content")).not.toBeNull();
    });

    it("keeps word wrapping on the editor card, where it belongs with the rest of the editing settings", () => {
        open();

        const wrap = host.querySelector<HTMLInputElement>("input.switch-toggle[id^='word-wrap-']");
        expect(wrap).not.toBeNull();

        act(() => void wrap?.dispatchEvent(new Event("input", { bubbles: true })));
        expect(mocks.saved).toContainEqual([ "codeLineWrapEnabled", true ]);
    });
});

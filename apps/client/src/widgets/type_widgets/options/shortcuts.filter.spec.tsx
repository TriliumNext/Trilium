import type { KeyboardShortcut } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The shortcuts the page is handed, in the shape the server sends: separators name the categories. */
const SHORTCUTS = vi.hoisted(() => ([
    { separator: "Note navigation" },
    {
        actionName: "backInNoteHistory",
        friendlyName: "Back in note history",
        description: "Goes back to the previously visited note.",
        effectiveShortcuts: [ "Alt+Left" ],
        defaultShortcuts: [ "Alt+Left" ],
        scope: "window"
    },
    {
        actionName: "jumpToNote",
        friendlyName: "Jump to note",
        effectiveShortcuts: [ "Ctrl+J" ],
        defaultShortcuts: [ "Ctrl+J" ],
        scope: "window"
    },
    { separator: "Editing" },
    {
        actionName: "addLinkToText",
        friendlyName: "Add link",
        effectiveShortcuts: [ "Ctrl+L" ],
        defaultShortcuts: [ "Ctrl+L" ],
        scope: "text-detail"
    }
] as KeyboardShortcut[]));

vi.mock("../../../services/server", () => ({
    default: { get: vi.fn(async () => SHORTCUTS) }
}));

// i18next is never initialised here and answers `undefined` until it is, which would make every
// assertion about a placeholder true of any string at all.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// Stubbed for the note context it would otherwise need, but its second row is rendered: the filter
// box lives there, and it is what these cases drive.
vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import ShortcutSettings from "./shortcuts";

let host: HTMLElement;

beforeEach(async () => {
    host = document.body.appendChild(document.createElement("div"));
    await act(async () => {
        render(<ShortcutSettings />, host);
    });
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

/** The categories on show, each read as its heading. */
const categories = () =>
    [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.textContent);

/** The shortcuts on show, each read as the name leading its segment's label. */
const shortcuts = () =>
    [ ...host.querySelectorAll(".tn-card-option-label") ].map((label) => label.firstChild?.textContent);

/** Types into the filter box, as a keystroke rather than an assignment. */
async function filterBy(text: string) {
    const box = host.querySelector<HTMLInputElement>(".header-stub input");
    expect(box).not.toBeNull();

    await act(async () => {
        if (box) {
            box.value = text;
            box.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
}

describe("the shortcuts list", () => {
    it("gives each category a card and each shortcut a segment of it", () => {
        expect(categories()).toEqual([ "Note navigation", "Editing" ]);
        expect(shortcuts()).toEqual([ "Back in note history", "Jump to note", "Add link" ]);
    });
});

describe("filtering the shortcuts", () => {
    it("keeps what matches the typed text, and the category it was filed under", async () => {
        await filterBy("jump");

        expect(categories()).toEqual([ "Note navigation" ]);
        expect(shortcuts()).toEqual([ "Jump to note" ]);
    });

    it("matches on the key combination as well as on the name", async () => {
        await filterBy("ctrl+l");

        expect(categories()).toEqual([ "Editing" ]);
        expect(shortcuts()).toEqual([ "Add link" ]);
    });

    it("matches on the description, which is the only place some wording appears", async () => {
        await filterBy("previously visited");

        expect(shortcuts()).toEqual([ "Back in note history" ]);
    });

    it("drops a category once nothing in it matches", async () => {
        await filterBy("note");

        // "Add link" is in neither its name, its description nor its combination.
        expect(categories()).toEqual([ "Note navigation" ]);
        expect(shortcuts()).toEqual([ "Back in note history", "Jump to note" ]);
    });

    it("says so rather than showing an empty card when nothing matches at all", async () => {
        await filterBy("nothing matches this");

        expect(categories()).toEqual([]);
        expect(host.querySelector(".no-items")?.textContent).toContain("shortcuts.no_results");
    });

    it("brings everything back when the text is cleared", async () => {
        await filterBy("jump");
        await filterBy("");

        expect(categories()).toEqual([ "Note navigation", "Editing" ]);
        expect(shortcuts()).toEqual([ "Back in note history", "Jump to note", "Add link" ]);
    });
});

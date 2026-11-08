import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    mobile: false,
    stored: {} as Record<string, string | boolean>,
    userFonts: [] as { noteId: string; title: string; blobId: string }[],
    /** What `listSystemFonts()` resolves to; a pending promise holds the list back. */
    systemFonts: [] as string[] | Promise<string[]>,
    /** The stock families this device can render, or `null` to let every one of them through. */
    availableFamilies: null as string[] | null,
    /** The families that resolve but draw nothing. */
    blankFamilies: [] as string[],
    /** Every option write, as `[ name, value ]`. */
    saved: [] as [ string, string ][],
    showError: vi.fn(),
    /** How often each lookup that loads fonts was made. */
    calls: { getCustomFonts: 0, listSystemFonts: 0, filterAvailableFamilies: 0 }
}));

// Only the desktop app can be asked what fonts the device has.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron,
    isMobile: () => mocks.mobile
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The real i18n is not initialized under test, so `Trans` would render the bare key and drop what
// it wires in; the stub renders the components themselves, which is what the sample is answering for.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string, components: Record<string, preact.VNode> }) => (
        <span data-i18n-key={i18nKey}>{Object.values(components)}</span>
    )
}));

// The picker asks for the user's own fonts and registers each one it is given; only the list is of
// interest here, so the registration is stood in for.
vi.mock("../../../services/custom_fonts", () => ({
    getCustomFonts: async () => {
        mocks.calls.getCustomFonts++;
        return mocks.userFonts;
    },
    registerFontNote: async (_noteId: string, family: string) => ({ family })
}));

// happy-dom exposes no `queryLocalFonts`, so what the desktop app would find is stood in for.
vi.mock("../../../services/font", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/font")>()),
    listSystemFonts: async () => {
        mocks.calls.listSystemFonts++;
        return await mocks.systemFonts;
    },
    filterAvailableFamilies: (families: string[]) => {
        mocks.calls.filterAvailableFamilies++;
        return mocks.availableFamilies ?? families;
    },
    rendersFamily: (family: string) => !mocks.blankFamilies.includes(family)
}));

vi.mock("../../../services/toast", () => ({
    default: { showError: mocks.showError }
}));

// useNoteTitle names the font a font option points at; the listing above is what the picker lists.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteTitle: (noteId: string | undefined) => mocks.userFonts.find((font) => font.noteId === noteId)?.title,
    useTriliumOption: (name: string) => [
        String(mocks.stored[name] ?? ""),
        async (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === true, vi.fn() ]
}));

import Fonts from "./appearance_fonts";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.mobile = false;
    mocks.stored = {};
    mocks.userFonts = [];
    mocks.systemFonts = [];
    mocks.availableFamilies = null;
    mocks.blankFamilies = [];
    mocks.saved = [];
    mocks.showError.mockClear();
    mocks.calls = { getCustomFonts: 0, listSystemFonts: 0, filterAvailableFamilies: 0 };
    Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { add: vi.fn(), delete: vi.fn() }
    });
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
});

/**
 * Renders the card fresh. The tree is torn down first so that a scenario changing a setting and
 * rendering again gets a clean mount, rather than a diff against what the previous values rendered.
 */
function open() {
    act(() => {
        render(null, host);
        render(<Fonts />, host);
    });
}

const fontRows = () => [ ...host.querySelectorAll(".font-option") ];

/** Opens the picker from the first row, and waits for the lists the opening asks for. */
async function openFirstRow() {
    const row = fontRows()[0];
    if (!(row instanceof HTMLElement)) throw new Error("the card has no font row");

    await act(async () => row.click());
    await act(async () => {});
}
const listedFonts = () => [ ...document.querySelectorAll(".font-picker-list .dropdown-item") ].map((item) => item.textContent?.trim());
const listedHeaders = () => [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);

/**
 * Opens the picker of the first font on a server build, where the list is the stock one — the
 * families it holds are known, which is what a search can be checked against.
 */
async function openPicker() {
    mocks.electron = false;
    mocks.stored = { overrideThemeFonts: true };
    open();
    await act(async () => {});
    await openFirstRow();
}

/** The generic entries, which head every list and are never measured against the device. */
const GENERIC_LABELS = [ "fonts.theme_defined", "fonts.system-default", "fonts.serif", "fonts.sans-serif", "fonts.monospace" ];

/** The entry the picker shows as set, which is the one the area it is on names. */
const selectedFont = () => document.querySelector(".font-picker-list .dropdown-item.selected")?.textContent?.trim();

/** The areas the picker can be switched between, in the order they are offered. */
const pickerTargets = () => [ ...document.querySelectorAll<HTMLElement>(".font-picker-targets button") ];

/** Types into the picker's search box, as the user would. */
function searchFonts(query: string) {
    const search = document.querySelector<HTMLInputElement>(".font-picker-modal .settings-search input");
    if (!search) throw new Error("the font picker has no search box");

    search.value = query;
    search.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the font settings", () => {
    it("keeps the fonts on show with custom fonts off, greyed rather than gone", () => {
        open();

        // What turning the switch on would put in force is the whole reason for turning it on.
        expect(fontRows()).toHaveLength(4);
        expect(fontRows().every((row) => row.className.includes("disabled"))).toBe(true);
    });

    it("brings them within reach once custom fonts are on", () => {
        mocks.stored = { overrideThemeFonts: true };
        open();

        expect(fontRows()).toHaveLength(4);
        expect(fontRows().some((row) => row.className.includes("disabled"))).toBe(false);
    });

    it("nests them under the switch that governs them", () => {
        open();
        expect(fontRows().every((row) => row.className.includes("tn-card-section-nested"))).toBe(true);
    });

    it("offers the fonts the user labelled #customFont, one entry per note", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.userFonts = [
            { noteId: "fontNoteA1", title: "Iosevka", blobId: "b1" },
            { noteId: "fontNoteB2", title: "Inter", blobId: "b2" },
            // Two notes can carry the same name; each is its own entry, told apart by its note.
            { noteId: "fontNoteC3", title: "Inter", blobId: "b3" }
        ];
        open();
        await act(async () => {});

        await openFirstRow();

        const picker = document.querySelector(".font-picker-list");
        const headers = [ ...(picker?.querySelectorAll(".dropdown-header") ?? []) ].map((header) => header.textContent);
        // Ahead of the stock families, which the user has to scroll past otherwise.
        expect(headers[0]).toBe("fonts.user-fonts");

        // Each is named by its note's own title, and stands for the note rather than for a family.
        const listed = [ ...(picker?.querySelectorAll(".dropdown-item") ?? []) ].map((item) => item.textContent?.trim());
        expect(listed.filter((entry) => entry === "Inter")).toHaveLength(2);
        expect(listed).toContain("Iosevka");
    });

    it("names a set custom font by its note's title, not by the reference the option holds", async () => {
        mocks.stored = { overrideThemeFonts: true, mainFontFamily: "customFont:fontNoteA1" };
        mocks.userFonts = [ { noteId: "fontNoteA1", title: "Iosevka", blobId: "b1" } ];
        open();
        await act(async () => {});

        expect(fontRows()[0].querySelector(".font-option-specimen")?.textContent).toBe("Iosevka");
    });

    it("lists only the built-in families when the user has labelled no fonts", async () => {
        mocks.stored = { overrideThemeFonts: true };
        open();
        await act(async () => {});
        await openFirstRow();

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).not.toContain("fonts.user-fonts");
        expect(headers).toContain("fonts.generic-fonts");
    });

    it("offers the fonts installed on the device in place of the guessed families", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [ "Adwaita Mono", "Inter" ];
        open();
        await act(async () => {});
        await openFirstRow();

        // The named families are a guess at what a device has, and go once there is an answer. The
        // generics resolve wherever Trilium runs, so they stay.
        expect(listedHeaders()).toEqual([ "fonts.generic-fonts", "fonts.installed-system-fonts" ]);
        expect(listedFonts()).toEqual([ ...GENERIC_LABELS, "Adwaita Mono", "Inter" ]);
    });

    it("keeps the named families on a server build, which cannot ask what the device has", async () => {
        mocks.electron = false;
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [ "Inter" ];
        open();
        await act(async () => {});
        await openFirstRow();

        const headers = [ ...document.querySelectorAll(".font-picker-list .dropdown-header") ].map((header) => header.textContent);
        expect(headers).not.toContain("fonts.installed-system-fonts");
        expect(headers).toContain("fonts.sans-serif-system-fonts");
    });

    it("narrows the named families to the ones the device can render", async () => {
        mocks.electron = false;
        mocks.stored = { overrideThemeFonts: true };
        // Nothing from the serif or handwriting groups, so both go entirely.
        mocks.availableFamilies = [ "Arial", "Verdana", "Courier New" ];
        open();
        await act(async () => {});
        await openFirstRow();

        expect(listedFonts()).toEqual([ ...GENERIC_LABELS, "Arial", "Verdana", "Courier New" ]);
        // A group left with nothing goes, its header with it; the generics are never measured.
        expect(listedHeaders()).toEqual([
            "fonts.generic-fonts",
            "fonts.sans-serif-system-fonts",
            "fonts.monospace-system-fonts"
        ]);
    });

    it("asks for no font list until the picker is opened, and names the set font all the same", async () => {
        mocks.stored = { overrideThemeFonts: true, mainFontFamily: "theme" };
        mocks.systemFonts = [ "Inter" ];
        mocks.userFonts = [ { noteId: "fontNoteA1", title: "Iosevka", blobId: "b1" } ];
        open();
        await act(async () => {});

        // Each of these loads fonts: a family is loaded to be measured, a custom font to be registered.
        expect(mocks.calls).toEqual({ getCustomFonts: 0, listSystemFonts: 0, filterAvailableFamilies: 0 });
        expect(fontRows()[0].querySelector(".font-option-specimen")?.textContent).toBe("fonts.theme_defined");

        await openFirstRow();
        expect(mocks.calls).toEqual({ getCustomFonts: 1, listSystemFonts: 1, filterAvailableFamilies: 0 });
        expect(listedFonts()).toEqual([ "Iosevka", ...GENERIC_LABELS, "Inter" ]);

        // Opening it again reuses what the first opening found.
        await openFirstRow();
        expect(mocks.calls).toEqual({ getCustomFonts: 1, listSystemFonts: 1, filterAvailableFamilies: 0 });
    });

    it("measures none of the guessed families while the installed ones are being listed", async () => {
        let answer: (families: string[]) => void = () => {};
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = new Promise((resolve) => {
            answer = resolve;
        });
        open();
        await openFirstRow();

        expect(listedFonts()).toEqual(GENERIC_LABELS);
        expect(mocks.calls.filterAvailableFamilies).toBe(0);

        await act(async () => answer([ "Inter" ]));
        await act(async () => {});
        expect(listedFonts()).toEqual([ ...GENERIC_LABELS, "Inter" ]);
        expect(mocks.calls.filterAvailableFamilies).toBe(0);
    });

    it("falls back to the guessed families when the desktop app finds no installed ones", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.availableFamilies = [ "Arial" ];
        open();
        await openFirstRow();

        expect(listedFonts()).toEqual([ ...GENERIC_LABELS, "Arial" ]);
        expect(mocks.calls.filterAvailableFamilies).toBe(1);
    });

    it("refuses an installed family that draws nothing, and sets one that draws", async () => {
        mocks.stored = { overrideThemeFonts: true };
        mocks.systemFonts = [ "Inter", "Unifont" ];
        mocks.blankFamilies = [ "Unifont" ];
        open();
        await act(async () => {});
        await openFirstRow();

        // The family is still offered: only choosing it is refused.
        const items = [ ...document.querySelectorAll<HTMLElement>(".font-picker-list .dropdown-item") ];
        const item = (family: string) => items.find((candidate) => candidate.textContent?.trim() === family);
        expect(item("Unifont")).toBeDefined();
        expect(item("Inter")).toBeDefined();

        await act(async () => item("Unifont")?.click());
        expect(mocks.saved).toEqual([]);
        expect(mocks.showError).toHaveBeenCalledTimes(1);

        await act(async () => item("Inter")?.click());
        expect(mocks.saved).toEqual([ [ "mainFontFamily", "Inter" ] ]);
        expect(mocks.showError).toHaveBeenCalledTimes(1);
    });

    it("narrows the list to the fonts matching what is searched for", async () => {
        await openPicker();
        await act(async () => searchFonts("georgia"));

        expect(listedFonts()).toEqual([ "Georgia" ]);
        // The groups left with nothing go, their headers with them.
        expect(listedHeaders()).toEqual([ "fonts.serif-system-fonts" ]);
    });

    it("keeps a whole group whose own name is searched for", async () => {
        await openPicker();
        await act(async () => searchFonts("handwriting"));

        // The group is what was asked for, so its fonts no longer have to match on their own.
        expect(listedFonts()).toEqual([ "Bradley Hand", "Brush Script MT", "Comic Sans MS", "Luminari" ]);
    });

    it("says so when nothing matches, rather than leaving an empty list", async () => {
        await openPicker();
        await act(async () => searchFonts("Nonesuch"));

        expect(document.querySelector(".font-picker-list")).toBeNull();
        expect(document.querySelector(".font-picker-empty")?.textContent).toContain("fonts.no_fonts_found");
    });

    it("brings the whole list back when the search is cleared", async () => {
        await openPicker();
        await act(async () => searchFonts("georgia"));

        // The field is the settings' own, so it comes with the button that empties it.
        const clear = document.querySelector<HTMLElement>(".font-picker-modal .settings-search-clear");
        expect(clear).not.toBeNull();

        await act(async () => clear?.click());
        expect(listedFonts()).toContain("Arial");
        expect(listedHeaders()).toContain("fonts.generic-fonts");
    });

    it("switches between the areas without leaving the picker", async () => {
        mocks.electron = false;
        mocks.stored = { overrideThemeFonts: true, mainFontFamily: "Arial", detailFontFamily: "Georgia" };
        open();
        await act(async () => {});
        await openFirstRow();

        expect(pickerTargets().map((target) => target.textContent?.trim())).toEqual([
            "fonts.main_font_short",
            "fonts.note_tree_font_short",
            "fonts.note_detail_font_short",
            "fonts.monospace_font_short"
        ]);
        expect(selectedFont()).toBe("Arial");
        // The interface size is the one the others are measured against, so it has nothing to say.
        expect(document.querySelector(".font-picker-modal .font-size-description")).toBeNull();

        // The list the areas are set from is the expensive part of the dialog, so it stays as it is
        // — the search included, which is where the user left it.
        await act(async () => searchFonts("g"));
        await act(async () => pickerTargets()[2].click());

        expect(selectedFont()).toBe("Georgia");
        expect(document.querySelector<HTMLInputElement>(".font-picker-modal .settings-search input")?.value).toBe("g");
        // The whole dialog followed the area, not only the list.
        expect(document.querySelector(".font-picker-modal .font-size-description")?.textContent).toBe("fonts.size_relative_to_general");
    });

    it("sets the document sample's emphasis in the faces a family may not have", async () => {
        await openPicker();
        await act(async () => pickerTargets()[2].click());

        // A family missing a bold or an italic has one sheared out of its upright by the browser,
        // which is what the runs are there to show.
        const sample = document.querySelector(".font-preview-document p");
        expect(sample?.querySelector("strong")).not.toBeNull();
        expect(sample?.querySelector("em")).not.toBeNull();

        // The two halves have to name the same tags: the sentence carries them, the components map
        // above answers for them, and a tag named in one alone renders as text in the paragraph.
        const catalogue = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "translations", "en", "translation.json"), "utf-8"));
        expect(catalogue.fonts.document_preview_body).toContain("<strong>");
        expect(catalogue.fonts.document_preview_body).toContain("<em>");
    });

    it("offers the size as a number to type as well as a slider to drag", async () => {
        mocks.stored = { overrideThemeFonts: true, mainFontSize: "120" };
        open();
        await act(async () => {});
        await openFirstRow();

        const slider = document.querySelector<HTMLInputElement>(".font-picker-modal .slider");
        const box = document.querySelector<HTMLInputElement>(".font-picker-modal .font-size-value");
        expect(slider?.value).toBe("120");
        expect(box?.value).toBe("120");

        // The same bounds on both, so a size that can be typed is one the slider can reach back to.
        expect(box?.min).toBe(slider?.min);
        expect(box?.max).toBe(slider?.max);
        expect(box?.step).toBe(slider?.step);
    });

    it("shows the interface on the components the interface is made of", async () => {
        // The picker opens on the interface font, so this is what it lands on.
        await openPicker();

        // Real menu entries, a real shortcut and a real button rather than markup standing in for
        // them: what is previewed cannot then drift from what it previews.
        const preview = document.querySelector(".font-preview-interface");
        expect(preview?.querySelectorAll(".dropdown-item")).toHaveLength(3);
        expect(preview?.querySelector("kbd")).not.toBeNull();
        expect(preview?.querySelectorAll(".font-preview-interface-buttons button")).toHaveLength(2);

        // A specimen rather than a menu: one that answered to being pressed would have to be
        // worked out as not being one.
        expect(preview?.hasAttribute("inert")).toBe(true);
    });

    it("shows the code sample on a surface the ligature setting reaches", async () => {
        await openPicker();
        await act(async () => pickerTargets()[3].click());

        // `pre` is what `style.css` turns ligatures off on, so the sample answers to the setting
        // sitting under the fonts; it is also what keeps the indentation the sample is written in.
        const sample = document.querySelector(".font-preview-code");
        expect(sample?.tagName).toBe("PRE");
        // The pairs a family with programming ligatures draws as one glyph, which is what there is
        // to look at when that setting is turned off and on.
        expect(sample?.textContent).toContain("=>");
        expect(sample?.textContent).toContain("<=");
    });

    it("leaves the preview out on mobile, where the font list needs the room", async () => {
        mocks.mobile = true;
        await openPicker();

        expect(document.querySelector(".font-picker-modal .font-size-control")).not.toBeNull();
        expect(listedFonts()).toEqual(expect.arrayContaining(GENERIC_LABELS));
        expect(document.querySelector(".font-picker-modal .font-preview")).toBeNull();
    });

    it("leaves ligatures alone, since they come from the theme's own font", () => {
        open();

        // Not nested under custom fonts: the setting is needed exactly when those are off.
        const ligatures = host.querySelector("input.switch-toggle[id^='monospace-ligatures-enabled-']");
        expect(ligatures?.closest(".tn-card-option")?.className).not.toContain("tn-card-section-nested");
        expect((ligatures as HTMLInputElement | null)?.disabled).toBe(false);
    });
});

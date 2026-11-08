import { MIME_TYPES_DICT } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dialog from "../../../services/dialog";
import options from "../../../services/options";
import { renderInto } from "../../../test/render";
import type { PickerItem } from "../../dialogs/item_picker";
import { CodeMimeTypesCard } from "./code_mime_types_card";

vi.mock("../../../services/i18n", () => ({
    t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key
}));

const PLAIN = "text/plain";
const C = "text/x-csrc";
const JAVA = "text/x-java";
const FRONTEND = "application/javascript;env=frontend";
const PYTHON = "text/x-python";

// The languages each highlighter supports, which decide the badges and the picker's tooltip.
vi.mock("@triliumnext/highlightjs/src/syntax_highlighting", () => ({
    byMimeType: { "text/plain": {}, "application/javascript;env=frontend": {} }
}));

vi.mock("@triliumnext/codemirror/src/syntax_highlighting", () => ({
    default: {
        "application/javascript;env=frontend": {}, "text/x-java": {}, "text/x-python": {}
    }
}));

describe("CodeMimeTypesCard", () => {
    let originalOrder: string;
    let originalSorting: string;

    beforeEach(() => {
        originalOrder = options.get("codeNotesMimeTypes");
        originalSorting = options.get("codeNotesMimeTypesSortAlphabetically");
        options.set("codeNotesMimeTypes", JSON.stringify([ JAVA, FRONTEND, C ]));
        options.set("codeNotesMimeTypesSortAlphabetically", "true");
    });

    afterEach(() => {
        options.set("codeNotesMimeTypes", originalOrder);
        options.set("codeNotesMimeTypesSortAlphabetically", originalSorting);
        vi.restoreAllMocks();
        for (const popup of document.querySelectorAll(".tooltip")) {
            popup.remove();
        }
    });

    it("lists the languages by name after plain text, with where each is highlighted", () => {
        const container = draw();

        expect(captions(container))
            .toEqual([ "Plain text", "C", "Java", "JavaScript (Trilium frontend)" ]);
        expect(badges(container, "JavaScript (Trilium frontend)"))
            .toEqual([ "code_mime_types.badge_code_blocks", "code_mime_types.badge_code_notes" ]);
        expect(badges(container, "Java")).toEqual([ "code_mime_types.badge_code_notes" ]);
        expect(badges(container, "C")).toEqual([]);
        // Plain text is highlighted nowhere, cannot be removed, and is muted.
        expect(badges(container, "Plain text")).toEqual([]);
        expect(mutedCaptions(container)).toEqual([ "Plain text" ]);
        expect(removeButton(container, "Plain text")).toBeNull();
        expect(removeButton(container, "C")).not.toBeNull();
        // A sorted list cannot be reordered by hand.
        expect(container.querySelector(".tn-sortable-grip")).toBeNull();
    });

    it("explains each badge in a tooltip", () => {
        const container = draw();
        const [ blocks, notes ] = segment(container, "JavaScript (Trilium frontend)")
            ?.querySelectorAll(".code-mime-types-badge") ?? [];

        expect(tooltipOf(blocks)).toBe("code_mime_types.badge_code_blocks_tooltip");
        expect(tooltipOf(notes)).toBe("code_mime_types.badge_code_notes_tooltip");
    });

    it("follows the stored order once sorting is off, and stores a new one", () => {
        options.set("codeNotesMimeTypesSortAlphabetically", "false");
        const container = draw();

        expect(captions(container))
            .toEqual([ "Plain text", "Java", "JavaScript (Trilium frontend)", "C" ]);
        expect(container.querySelector(".tn-sortable-grip")).not.toBeNull();

        press(segment(container, "Java"), "ArrowDown", { ctrlKey: true });

        expect(stored()).toEqual([ PLAIN, FRONTEND, JAVA, C ]);
        expect(captions(container))
            .toEqual([ "Plain text", "JavaScript (Trilium frontend)", "Java", "C" ]);
    });

    it("switches sorting after the description, leaving the stored order alone", () => {
        const container = draw();
        const toggle = container.querySelector<HTMLInputElement>(
            ".tn-card-description .switch-toggle");
        expect(container.querySelector(`label[for="${toggle?.id}"]`)?.textContent)
            .toBe("code_mime_types.sort_alphabetically");

        act(() => { toggle?.dispatchEvent(new Event("input", { bubbles: true })); });

        expect(options.get("codeNotesMimeTypesSortAlphabetically")).toBe("false");
        expect(stored()).toEqual([ JAVA, FRONTEND, C ]);
        expect(captions(container))
            .toEqual([ "Plain text", "Java", "JavaScript (Trilium frontend)", "C" ]);
    });

    describe("adding a language", () => {
        it("offers the languages not enabled yet, by name, with the highlighting tooltip",
            async () => {
                const picking = vi.spyOn(dialog, "pickSingleItem").mockResolvedValue(null);
                const container = draw();

                await click(container.querySelector(".tn-card-adder"));

                const items = picking.mock.calls.at(-1)?.[0].items as PickerItem[];
                const keys = items.map((item) => item.key);
                expect(keys).toContain(PYTHON);
                expect(keys).not.toContain(JAVA);
                expect(keys).not.toContain(PLAIN);
                const titles = items.map((item) => item.caption);
                expect(titles).toEqual([ ...titles ].sort((a, b) => a.localeCompare(b)));
                expect(items.find((item) => item.key === PYTHON)?.tooltip).toBe([
                    "<strong>code_mime_types.tooltip_syntax_highlighting</strong>",
                    "❌ code_mime_types.tooltip_code_block_syntax",
                    "✅ code_mime_types.tooltip_code_note_syntax"
                ].join("\n"));
                // Backed out of, so nothing is stored.
                expect(stored()).toEqual([ JAVA, FRONTEND, C ]);
            });

        it("adds what was picked at the end of the stored order, while sorted", async () => {
            vi.spyOn(dialog, "pickSingleItem")
                .mockResolvedValue({ key: PYTHON, caption: "Python" });
            const container = draw();

            await click(container.querySelector(".tn-card-adder"));

            expect(stored()).toEqual([ PLAIN, JAVA, FRONTEND, C, PYTHON ]);
            expect(captions(container))
                .toEqual([ "Plain text", "C", "Java", "JavaScript (Trilium frontend)", "Python" ]);
            expect(container.querySelector(".tn-card-adder")?.textContent?.trim())
                .toBe(`code_mime_types.add_another ${MIME_TYPES_DICT.length - 5}`);
        });

        it("says how many languages are left to add", () => {
            const container = draw();

            expect(container.querySelector(".tn-card-adder")?.textContent?.trim())
                .toBe(`code_mime_types.add_another ${MIME_TYPES_DICT.length - 4}`);
        });
    });

    it("removes a language with its button or Delete, but never plain text", async () => {
        const container = draw();

        await click(removeButton(container, "Java"));
        expect(stored()).toEqual([ PLAIN, FRONTEND, C ]);

        act(() => segment(container, "C")?.focus());
        press(segment(container, "C"), "Delete");
        expect(stored()).toEqual([ PLAIN, FRONTEND ]);
        expect(document.activeElement).toBe(segment(container, "JavaScript (Trilium frontend)"));

        press(segment(container, "Plain text"), "Delete");
        expect(stored()).toEqual([ PLAIN, FRONTEND ]);
        expect(captions(container)).toEqual([ "Plain text", "JavaScript (Trilium frontend)" ]);
    });
});

function draw() {
    let container: HTMLElement | undefined;
    act(() => { container = renderInto(<CodeMimeTypesCard heading="Languages" />); });
    if (!container) throw new Error("The card did not render");
    return container;
}

function stored() {
    return JSON.parse(options.get("codeNotesMimeTypes"));
}

function segments(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(".tn-sortable-segment") ];
}

function captions(container: HTMLElement) {
    return segments(container)
        .map((element) => element.querySelector(".code-mime-types-title")?.textContent);
}

function segment(container: HTMLElement, caption: string) {
    return segments(container).find((element) =>
        element.querySelector(".code-mime-types-title")?.textContent === caption) ?? null;
}

function mutedCaptions(container: HTMLElement) {
    return [ ...container.querySelectorAll(".code-mime-types-title.code-mime-types-muted") ]
        .map((element) => element.textContent);
}

function removeButton(container: HTMLElement, caption: string) {
    return segment(container, caption)?.querySelector(".code-mime-types-remove") ?? null;
}

function badges(container: HTMLElement, caption: string) {
    return [ ...segment(container, caption)?.querySelectorAll(".code-mime-types-badge") ?? [] ]
        .map((badge) => badge.textContent);
}

/** Shows the tooltip of `element` and returns its text. */
function tooltipOf(element: Element | undefined) {
    const instance = element && Tooltip.getInstance(element);
    act(() => instance?.show());
    const text = document.querySelector(".tooltip-inner")?.textContent;
    act(() => instance?.hide());
    return text;
}

function press(target: Element | null, key: string, init: KeyboardEventInit = {}) {
    act(() => {
        target?.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    });
}

/** Clicks and waits for what the click awaits, such as the picker. */
async function click(target: Element | null) {
    await act(async () => {
        target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
}

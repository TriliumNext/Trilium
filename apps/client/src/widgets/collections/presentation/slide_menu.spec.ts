import { describe, expect, it, vi } from "vitest";

import appContext, { type CommandNames } from "../../../components/app_context";
import type { MenuCommandItem, MenuItem } from "../../../menus/context_menu";
import type { PresentationSlideBaseModel, SlideMove } from "./model";
import { buildSlideMenuItems, type SlideMenuActions, type SlideMenuTarget } from "./slide_menu";

// i18next is never initialized under test, so `t()` looks keys up in the English catalog itself.
// The code languages enabled in the code note options, in their order.
vi.mock("../../../services/mime_types", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../services/mime_types")>();
    return {
        default: {
            ...actual.default,
            loadMimeTypes: () => {},
            getEnabledMimeTypes: () => [
                { mime: "text/plain", title: "Plain text" },
                { mime: "text/x-python", title: "Python", icon: "bx bxl-python" }
            ]
        }
    };
});

vi.mock("../../../services/i18n", async () => {
    const { default: english } = await import("../../../translations/en/translation.json");
    return {
        t: (key: string) => key.split(".").reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part], english
        )
    };
});

const openNoteItem: MenuItem<CommandNames> = { title: "Open note", command: "openNoteInNewTab" };
const textSlide: PresentationSlideBaseModel = { noteId: "s", type: "text", content: { __html: "" } };
const move = (targetNoteId: string): SlideMove => ({ noteId: "s", targetNoteId, position: "before" });

function buildActions(): Required<SlideMenuActions> & { changes: Required<NonNullable<SlideMenuActions["changes"]>> } {
    return {
        onEdit: vi.fn(),
        changes: { addSlideAfter: vi.fn(), addVerticalSlide: vi.fn(), duplicate: vi.fn(), delete: vi.fn() }
    };
}

function build(target: Partial<SlideMenuTarget>, actions: SlideMenuActions = buildActions(), onMove = vi.fn()) {
    return buildSlideMenuItems({
        slide: textSlide, isVertical: false, moves: {}, isRtl: false, ...target
    }, actions, onMove, openNoteItem);
}

/** The menu as text: each item's title, `!` before a disabled one, `-` for a separator. */
function describeMenu(items: MenuItem<CommandNames>[]) {
    return items.map(item => {
        if ("kind" in item) return item.kind === "separator" ? "-" : item.kind;
        return `${item.enabled === false ? "!" : ""}${item.title}`;
    });
}

function findItem(items: MenuItem<CommandNames>[], title: string) {
    const item = items.find((candidate): candidate is MenuCommandItem<CommandNames> => (
        !("kind" in candidate) && candidate.title === title
    ));
    if (!item) throw new Error(`No item "${title}".`);
    return item;
}

describe("buildSlideMenuItems", () => {
    it("offers everything for a top-level slide, disabling the moves that have nowhere to go", () => {
        const items = build({ moves: { down: move("b"), toVertical: move("a") } });
        expect(describeMenu(items)).toEqual([
            "Edit slide", "Open note", "-",
            "New slide after", "New vertical slide", "Duplicate", "-",
            "!Move up", "Move down", "Make vertical slide", "-",
            "Delete slide..."
        ]);
        expect(findItem(items, "Move down").shortcut).toBe("Alt+Down");
        expect(findItem(items, "Make vertical slide").shortcut).toBe("Alt+Right");
    });

    it("offers a vertical slide no vertical slides of its own, and a way back to the top level", () => {
        const items = build({ isVertical: true, moves: { toTopLevel: move("b") }, isRtl: true });
        expect(describeMenu(items)).not.toContain("New vertical slide");
        expect(describeMenu(items)).not.toContain("Make vertical slide");
        // In right-to-left text, vertical slides are indented toward the left.
        expect(findItem(items, "Make top-level slide").shortcut).toBe("Alt+Right");
    });

    it("edits in place only the slides that can be, and gives a board or table no vertical slides", () => {
        expect(describeMenu(build({ slide: { ...textSlide, type: "webView" } }))[0]).toBe("!Edit slide");
        expect(describeMenu(build({ slide: { ...textSlide, isReadOnly: true } }))[0]).toBe("!Edit slide");
        expect(describeMenu(build({ slide: { ...textSlide, type: "canvas" } }))[0]).toBe("Edit slide");

        const collection = describeMenu(build({ slide: { ...textSlide, type: "book", isCollection: true } }));
        expect(collection[0]).toBe("Edit slide");
        expect(collection).not.toContain("New vertical slide");
    });

    it("keeps only what is possible in a presentation that cannot be changed", () => {
        // A search-based presentation: edits, but no new, moved or deleted slides.
        expect(describeMenu(build({ moves: undefined }, { onEdit: vi.fn() }))).toEqual([ "Edit slide", "Open note" ]);
        // A read-only presentation.
        expect(describeMenu(build({ moves: undefined }, {}))).toEqual([ "Open note" ]);
    });

    it("runs the action of an item on the slide", () => {
        const actions = buildActions();
        const onMove = vi.fn();
        const items = build({ moves: { down: move("b") } }, actions, onMove);
        const runItem = (item: MenuCommandItem<CommandNames>) => item.handler?.(item, new MouseEvent("click"));
        const run = (title: string) => runItem(findItem(items, title));
        const runSubitem = (title: string, subtitle: string) => (
            runItem(findItem(findItem(items, title).items ?? [], subtitle))
        );

        const slideTypes = [
            "Text", "Canvas", "-", "Board", "Table", "Mermaid Diagram", "Web View", "Code", "Spreadsheet"
        ];
        expect(describeMenu(findItem(items, "New slide after").items ?? [])).toEqual(slideTypes);
        expect(describeMenu(findItem(items, "New vertical slide").items ?? [])).toEqual(slideTypes);
        // Code is created in a language, which a submenu of its own offers.
        const codeItem = findItem(findItem(items, "New slide after").items ?? [], "Code");
        expect(describeMenu(codeItem.items ?? [])).toEqual([ "Plain text", "Python", "-", "Configure code notes..." ]);
        runItem(findItem(codeItem.items ?? [], "Python"));
        expect(actions.changes.addSlideAfter)
            .toHaveBeenLastCalledWith("s", expect.objectContaining({ type: "code", mime: "text/x-python" }));
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        runItem(findItem(codeItem.items ?? [], "Configure code notes..."));
        expect(triggerCommand).toHaveBeenCalledWith("showOptions", { section: "_optionsCodeNotes" });
        triggerCommand.mockRestore();

        run("Edit slide");
        runSubitem("New slide after", "Text");
        runSubitem("New vertical slide", "Canvas");
        run("Duplicate");
        run("Delete slide...");
        run("Move down");
        expect(actions.onEdit).toHaveBeenCalledWith("s");
        expect(actions.changes.addSlideAfter).toHaveBeenCalledWith("s", expect.objectContaining({ type: "text" }));
        expect(actions.changes.addVerticalSlide).toHaveBeenCalledWith("s", expect.objectContaining({ type: "canvas" }));
        expect(actions.changes.duplicate).toHaveBeenCalledWith("s");
        expect(actions.changes.delete).toHaveBeenCalledWith("s");
        expect(onMove).toHaveBeenCalledWith(move("b"));
    });
});

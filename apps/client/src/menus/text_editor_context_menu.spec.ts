import type { AiQuickAction, AiQuickActionFooter, AiQuickActionGroup } from "@triliumnext/ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const tabManager = {
        activeNote: null as { type: string } | null,
        activeContext: null as { getTextEditor: () => Promise<unknown> } | null,
        getActiveContextNote: () => tabManager.activeNote,
        getActiveContext: () => tabManager.activeContext
    };
    return { tabManager };
});

vi.mock("../components/app_context.js", () => ({ default: { tabManager: h.tabManager } }));
vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));

import type { MenuCommandItem, MenuItem } from "./context_menu.js";
import { buildAiActionsMenuItem, getTextEditorAtSelection } from "./text_editor_context_menu.js";

const { tabManager } = h;

const GROUPS: AiQuickActionGroup[] = [
    {
        id: "edit",
        label: "Edit or review",
        actions: [{ id: "fixTypos", label: "Fix typos", prompt: "…", iconClass: "bx bx-check-double" }]
    },
    {
        id: "generate",
        label: "Generate",
        actions: [{ id: "draft", label: "Draft", prompt: "…", requiresContent: false }]
    },
    {
        id: "adjust",
        label: "Adjust",
        submenu: true,
        iconClass: "bx bx-ruler",
        actions: [{ id: "makeShorter", label: "Shorter", prompt: "…" }]
    },
    {
        id: "tone",
        label: "Change tone",
        submenu: true,
        actions: [{ id: "casual", label: "Casual", prompt: "…" }],
        footer: { label: "Configure…", iconClass: "bx bx-cog", run: vi.fn() }
    }
];

/** The pieces of `AiAssistantUI` and the editor that the menu builder reads. */
function fakeEditor({
    domRoot,
    groups = GROUPS,
    menuFooter = [],
    hasContext = true,
    isStreaming = false,
    isEnabled = true,
    hasPlugin = true
}: {
    domRoot: Node | null;
    groups?: AiQuickActionGroup[];
    menuFooter?: AiQuickActionFooter[];
    hasContext?: boolean;
    isStreaming?: boolean;
    isEnabled?: boolean;
    hasPlugin?: boolean;
}) {
    // The live lists are the plugin's, which the editor config only seeded.
    const ui = { hasContext, isStreaming, quickActions: groups, menuFooter, runQuickAction: vi.fn() };
    const editor = {
        editing: { view: { getDomRoot: () => domRoot } },
        plugins: { has: () => hasPlugin, get: () => ui },
        commands: { get: () => ({ isEnabled }) },
        execute: vi.fn()
    };
    tabManager.activeNote = { type: "text" };
    tabManager.activeContext = { getTextEditor: () => Promise.resolve(editor) };
    return { editor, ui };
}

/** Points `window.getSelection()` at `anchorNode`. */
function setSelection(anchorNode: Node | null) {
    vi.spyOn(window, "getSelection").mockReturnValue({ anchorNode } as unknown as Selection);
}

function titles(items: MenuItem<string>[]) {
    return items.map((item) => ("kind" in item ? `--- ${item.kind} ---` : item.title));
}

function commandItems(items: MenuItem<string>[]) {
    return items.filter((item) => !("kind" in item)) as MenuCommandItem<string>[];
}

describe("getTextEditorAtSelection", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        tabManager.activeNote = null;
        tabManager.activeContext = null;
    });

    it("returns the editor only when the selection is inside its DOM root", async () => {
        const root = document.createElement("div");
        const inside = document.createTextNode("hello");
        root.appendChild(inside);

        const { editor } = fakeEditor({ domRoot: root });
        setSelection(inside);
        expect(await getTextEditorAtSelection()).toBe(editor);

        // Same editor, but the click landed in a dialog rather than in the note.
        setSelection(document.createTextNode("elsewhere"));
        expect(await getTextEditorAtSelection()).toBeNull();
    });

    it("returns null for a non-text note, and swallows a failing editor lookup", async () => {
        setSelection(document.createTextNode("hello"));

        tabManager.activeNote = { type: "code" };
        tabManager.activeContext = { getTextEditor: () => Promise.reject(new Error("timed out")) };
        expect(await getTextEditorAtSelection()).toBeNull();

        tabManager.activeNote = { type: "text" };
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await getTextEditorAtSelection()).toBeNull();
    });
});

describe("buildAiActionsMenuItem", () => {
    /** The editable root the selection sits in, so every editor below is the one that was clicked. */
    let root: HTMLElement;

    beforeEach(() => {
        vi.restoreAllMocks();
        root = document.createElement("div");
        const anchor = document.createTextNode("hello");
        root.appendChild(anchor);
        setSelection(anchor);
    });

    function build(overrides: Omit<Parameters<typeof fakeEditor>[0], "domRoot"> = {}) {
        return fakeEditor({ domRoot: root, ...overrides });
    }

    it("mirrors the toolbar's grouping: inlined actions, submenus, and a rule between groups except between two submenus", async () => {
        build();
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;

        expect(item.title).toBe("ai_assistant.title");
        expect(titles(item.items ?? [])).toEqual([
            "ai_assistant.action_ask",
            "--- separator ---",
            "Fix typos",
            "--- separator ---",
            "Draft",
            "--- separator ---",
            "Adjust",
            "Change tone"
        ]);

        const adjust = commandItems(item.items ?? []).find((i) => i.title === "Adjust");
        expect(adjust?.uiIcon).toBe("bx bx-ruler");
        expect(titles(adjust?.items ?? [])).toEqual(["Shorter"]);
    });

    it("disables the actions that need content — and the submenus whose actions all do", async () => {
        build({ hasContext: false });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;
        const enabled = Object.fromEntries(commandItems(item.items ?? []).map((i) => [i.title, i.enabled]));

        expect(enabled).toMatchObject({
            "ai_assistant.action_ask": undefined,
            "Fix typos": false,
            Draft: true,
            Adjust: false,
            // Its actions all need content, but the row that configures them does not, so the
            // submenu still opens.
            "Change tone": true
        });
    });

    // A group whose contents are configurable ends with the row that configures them, below a rule
    // and runnable whatever the selection is.
    it("closes a group's submenu with its footer, and leaves it runnable without content", async () => {
        build({ hasContext: false });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;
        const tone = commandItems(item.items ?? []).find((i) => i.title === "Change tone");

        expect(titles(tone?.items ?? [])).toEqual(["Casual", "--- separator ---", "Configure…"]);

        const configure = commandItems(tone?.items ?? []).find((i) => i.title === "Configure…");
        expect([configure?.enabled, configure?.uiIcon]).toEqual([true, "bx bx-cog"]);
        configure?.handler?.(configure, null as never);
        expect(GROUPS.find((g) => g.id === "tone")?.footer?.run).toHaveBeenCalled();
    });

    // The rows the menu itself ends with — what a run answers to, the model it speaks to — reached
    // through a submenu when one holds others.
    it("closes the whole menu with its footer rows", async () => {
        const run = vi.fn();
        build({
            hasContext: false,
            menuFooter: [{
                label: "Model: Sonnet 5",
                iconClass: "bx bx-chip",
                children: [{ label: "Sonnet 5", iconClass: "bx bx-check", run }]
            }]
        });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;

        expect(titles(item.items ?? []).slice(-2)).toEqual(["--- separator ---", "Model: Sonnet 5"]);

        const picker = commandItems(item.items ?? []).find((i) => i.title === "Model: Sonnet 5");
        expect([picker?.enabled, picker?.uiIcon]).toEqual([true, "bx bx-chip"]);

        const [model] = commandItems(picker?.items ?? []);
        expect([model.title, model.uiIcon]).toEqual(["Sonnet 5", "bx bx-check"]);
        model.handler?.(model, null as never);
        expect(run).toHaveBeenCalled();
    });

    it("runs the picked action, and opens the free-form prompt from the first row", async () => {
        const { editor, ui } = build();
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;
        const rows = commandItems(item.items ?? []);

        rows[0].handler?.(rows[0], null as never);
        expect(editor.execute).toHaveBeenCalledWith("aiAssistant");

        const fixTypos = rows.find((i) => i.title === "Fix typos");
        fixTypos?.handler?.(fixTypos, null as never);
        expect(ui.runQuickAction).toHaveBeenCalledWith(
            expect.objectContaining({ id: "fixTypos" }) satisfies AiQuickAction
        );
    });

    it("degrades to a plain row with no quick actions configured", async () => {
        const { editor } = build({ groups: [] });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;

        expect(item.items).toBeUndefined();
        item.handler?.(item, null as never);
        expect(editor.execute).toHaveBeenCalledWith("aiAssistant");
    });

    it("is absent while a run streams, without a provider, and where the plugin is not loaded", async () => {
        build({ isStreaming: true });
        expect(await buildAiActionsMenuItem()).toBeNull();

        build({ isEnabled: false });
        expect(await buildAiActionsMenuItem()).toBeNull();

        build({ hasPlugin: false });
        expect(await buildAiActionsMenuItem()).toBeNull();
    });
});

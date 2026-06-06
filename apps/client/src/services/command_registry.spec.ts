import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionKeyboardShortcut } from "@triliumnext/commons";

// ---- Mocks -----------------------------------------------------------------
// vi.hoisted lets these shared spies exist before the hoisted vi.mock factories.
const {
    triggerCommand,
    getComponentByEl,
    getActiveContextNotePath,
    getActiveContext,
    getActiveMainContext,
    getActions,
    isElectron
} = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    getComponentByEl: vi.fn(),
    getActiveContextNotePath: vi.fn<() => string | null | undefined>(() => "root/abc"),
    getActiveContext: vi.fn(),
    getActiveMainContext: vi.fn<() => { ntxId?: string } | undefined>(() => ({ ntxId: "ntx-main" })),
    getActions: vi.fn<() => Promise<ActionKeyboardShortcut[]>>(async () => []),
    isElectron: vi.fn(() => false)
}));

// translationsInitializedPromise must be already-resolved so the registry's
// async loadCommands() proceeds. t() is made a deterministic stub.
vi.mock("./i18n.js", () => ({
    translationsInitializedPromise: Promise.resolve(),
    t: (key: string, opts?: Record<string, unknown>) =>
        opts && "name" in opts ? `${key}:${opts.name}` : key
}));

vi.mock("../components/app_context.js", () => ({
    default: {
        triggerCommand,
        getComponentByEl,
        tabManager: {
            activeNtxId: "ntx-1",
            getActiveContextNotePath,
            getActiveContext,
            getActiveMainContext
        }
    }
}));

vi.mock("./keyboard_actions.js", () => ({
    default: { getActions }
}));

vi.mock("./utils.js", () => ({
    default: { isElectron }
}));

// Imported AFTER the mocks (vi.mock is hoisted).
import { CommandRegistry } from "./command_registry.js";

/** Build a fresh registry and wait for its async loadCommands() to settle. */
async function freshRegistry() {
    const registry = new CommandRegistry();
    // Flush the microtask/macrotask queue so the fire-and-forget constructor
    // promise chain (translations -> default commands -> keyboard actions) runs.
    await new Promise((r) => setTimeout(r, 0));
    return registry;
}

function action(overrides: Partial<Record<keyof ActionKeyboardShortcut, unknown>>): ActionKeyboardShortcut {
    return {
        actionName: "someAction",
        friendlyName: "Some Action",
        description: "Does something",
        ...overrides
    } as ActionKeyboardShortcut;
}

afterEach(() => {
    vi.clearAllMocks();
    getActions.mockImplementation(async () => []);
    isElectron.mockImplementation(() => false);
    getActiveContextNotePath.mockImplementation(() => "root/abc");
    getActiveMainContext.mockImplementation(() => ({ ntxId: "ntx-main" }));
});

describe("CommandRegistry default commands", () => {
    it("registers all default commands after translations resolve", async () => {
        const registry = await freshRegistry();
        const ids = registry.getAllCommands().map((c) => c.id);
        expect(ids).toEqual(
            expect.arrayContaining([
                "export-note",
                "show-attachments",
                "search-notes",
                "search-in-subtree",
                "show-search-history",
                "show-launch-bar"
            ])
        );
        // getAllCommands returns a name-sorted list.
        const names = registry.getAllCommands().map((c) => c.name);
        expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    });

    it("default command handlers trigger the right app commands", async () => {
        const registry = await freshRegistry();

        await registry.executeCommand("export-note");
        expect(triggerCommand).toHaveBeenCalledWith("showExportDialog", {
            notePath: "root/abc",
            defaultType: "single"
        });

        await registry.executeCommand("show-attachments");
        expect(triggerCommand).toHaveBeenCalledWith("showAttachments");

        await registry.executeCommand("search-notes");
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", {});

        await registry.executeCommand("search-in-subtree");
        expect(triggerCommand).toHaveBeenCalledWith("searchInSubtree", { notePath: "root/abc" });

        await registry.executeCommand("show-search-history");
        expect(triggerCommand).toHaveBeenCalledWith("showSearchHistory");

        await registry.executeCommand("show-launch-bar");
        expect(triggerCommand).toHaveBeenCalledWith("showLaunchBarSubtree");
    });

    it("export-note and search-in-subtree skip triggering when there is no active note path", async () => {
        const registry = await freshRegistry();
        getActiveContextNotePath.mockImplementation(() => null);

        await registry.executeCommand("export-note");
        await registry.executeCommand("search-in-subtree");
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("pin/unpin-active-tab trigger pinTab/unpinTab with the active main context ntxId", async () => {
        const registry = await freshRegistry();

        await registry.executeCommand("pin-active-tab");
        expect(triggerCommand).toHaveBeenCalledWith("pinTab", { ntxId: "ntx-main" });

        await registry.executeCommand("unpin-active-tab");
        expect(triggerCommand).toHaveBeenCalledWith("unpinTab", { ntxId: "ntx-main" });
    });

    it("pin/unpin-active-tab skip triggering when there is no active main context", async () => {
        const registry = await freshRegistry();
        getActiveMainContext.mockImplementation(() => undefined);

        await registry.executeCommand("pin-active-tab");
        await registry.executeCommand("unpin-active-tab");
        expect(triggerCommand).not.toHaveBeenCalled();
    });
});

describe("CommandRegistry keyboard actions", () => {
    it("registers eligible keyboard actions, formatting shortcuts and tree-scoped names", async () => {
        getActions.mockImplementation(async () => [
            action({
                actionName: "newAction",
                friendlyName: "New Action",
                iconClass: "bx bx-plus",
                effectiveShortcuts: ["CommandOrControl+N", "Alt+X"]
            }),
            action({
                actionName: "treeAction",
                friendlyName: "Tree Action",
                scope: "note-tree"
            })
        ]);

        const registry = await freshRegistry();

        const newCmd = registry.getCommand("newAction")!;
        expect(newCmd.source).toBe("keyboard-action");
        expect(newCmd.commandName).toBe("newAction");
        // formatShortcut: CommandOrControl -> Ctrl, + -> " + "
        expect(newCmd.shortcut).toBe("Ctrl + N");

        const treeCmd = registry.getCommand("treeAction")!;
        // note-tree scope wraps the name with the tree-action-name translation key
        expect(treeCmd.name).toBe("command_palette.tree-action-name:Tree Action");
    });

    it("skips already-registered, description-less, electron-only and ignored actions", async () => {
        getActions.mockImplementation(async () => [
            // Collides with a manually-registered default command id -> skipped.
            action({ actionName: "export-note" }),
            // No description -> skipped.
            action({ actionName: "noDesc", description: undefined }),
            // Electron-only while not in electron -> skipped.
            action({ actionName: "electronOnly", isElectronOnly: true }),
            // Explicitly ignored -> skipped.
            action({ actionName: "ignored", ignoreFromCommandPalette: true }),
            // No shortcut at all -> registered, shortcut undefined.
            action({ actionName: "noShortcut", effectiveShortcuts: [] })
        ]);

        const registry = await freshRegistry();

        // export-note stays the manually-registered command (has a handler).
        expect(registry.getCommand("export-note")!.handler).toBeTypeOf("function");
        expect(registry.getCommand("noDesc")).toBeUndefined();
        expect(registry.getCommand("electronOnly")).toBeUndefined();
        expect(registry.getCommand("ignored")).toBeUndefined();

        const noShortcut = registry.getCommand("noShortcut")!;
        expect(noShortcut.shortcut).toBeUndefined();
    });

    it("registers electron-only actions when running under electron", async () => {
        isElectron.mockImplementation(() => true);
        getActions.mockImplementation(async () => [
            action({ actionName: "electronOnly", isElectronOnly: true })
        ]);

        const registry = await freshRegistry();
        expect(registry.getCommand("electronOnly")).toBeDefined();
    });

    it("logs an error when loading keyboard actions fails", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        getActions.mockImplementation(async () => {
            throw new Error("boom");
        });

        await freshRegistry();
        expect(consoleError).toHaveBeenCalledWith("Failed to load keyboard actions:", expect.any(Error));
        consoleError.mockRestore();
    });
});

describe("CommandRegistry register & aliases", () => {
    let registry: CommandRegistry;
    beforeEach(async () => {
        registry = await freshRegistry();
    });

    it("stores commands and lowercases registered aliases", () => {
        registry.register({ id: "custom", name: "Custom", aliases: ["FooBar", "baz"] });
        expect(registry.getCommand("custom")!.name).toBe("Custom");
        // Aliases are matched case-insensitively in search.
        expect(registry.searchCommands("foobar").map((c) => c.id)).toContain("custom");
    });

    it("getCommand returns undefined for unknown ids", () => {
        expect(registry.getCommand("does-not-exist")).toBeUndefined();
    });
});

describe("CommandRegistry searchCommands scoring", () => {
    let registry: CommandRegistry;
    beforeEach(async () => {
        registry = await freshRegistry();
        registry.register({ id: "alpha", name: "Alpha", description: "first letter" });
        registry.register({ id: "alphabet", name: "Alphabet soup" });
        registry.register({ id: "zeta", name: "Zeta", description: "contains alpha word" });
        registry.register({ id: "aliased", name: "Totally unrelated", aliases: ["alphakeyword"] });
    });

    it("ranks exact > starts-with > contains, and orders ties by name", () => {
        const ids = registry.searchCommands("alpha").map((c) => c.id);
        // "Alpha" exact (100) first; "Alphabet soup" starts-with (80); then
        // description contains (40) for "first letter"? no — that doesn't match.
        // "Zeta" matches via description contains "alpha" (40); "aliased" via alias (50).
        expect(ids[0]).toBe("alpha");
        expect(ids[1]).toBe("alphabet");
        // alias match (50) ranks above description match (40)
        expect(ids.indexOf("aliased")).toBeLessThan(ids.indexOf("zeta"));
    });

    it("name-contains beats description-contains", () => {
        registry.register({ id: "mid", name: "xxAlphaxx" });
        const ids = registry.searchCommands("alpha").map((c) => c.id);
        expect(ids.indexOf("mid")).toBeLessThan(ids.indexOf("zeta"));
    });

    it("returns empty for a query that matches nothing", () => {
        expect(registry.searchCommands("zzz-no-match-zzz")).toEqual([]);
    });

    it("breaks score ties alphabetically by name", () => {
        // Both start with "tie" -> identical score (80); ordered by name.
        registry.register({ id: "tieB", name: "Tie Bravo" });
        registry.register({ id: "tieA", name: "Tie Alpha" });
        const ids = registry.searchCommands("tie").map((c) => c.id);
        const a = ids.indexOf("tieA");
        const b = ids.indexOf("tieB");
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThan(a);
    });
});

describe("CommandRegistry executeCommand", () => {
    let registry: CommandRegistry;
    beforeEach(async () => {
        registry = await freshRegistry();
    });

    it("logs an error for an unknown command", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        await registry.executeCommand("nope");
        expect(consoleError).toHaveBeenCalledWith("Command not found: nope");
        expect(triggerCommand).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("logs an error for a command with neither handler nor commandName", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        registry.register({ id: "empty", name: "Empty" });
        await registry.executeCommand("empty");
        expect(consoleError).toHaveBeenCalledWith("Command empty has no handler or commandName");
        consoleError.mockRestore();
    });

    it("triggers commandName with active ntxId when there is no keyboard action", async () => {
        registry.register({
            id: "plainCmd",
            name: "Plain",
            commandName: "showOptions" as never
        });
        await registry.executeCommand("plainCmd");
        expect(triggerCommand).toHaveBeenCalledWith("showOptions", { ntxId: "ntx-1" });
    });

    it("triggers commandName with active ntxId for a window-scoped keyboard action", async () => {
        registry.register({
            id: "winCmd",
            name: "Window",
            commandName: "showOptions" as never,
            keyboardAction: action({ scope: "window" })
        });
        await registry.executeCommand("winCmd");
        expect(triggerCommand).toHaveBeenCalledWith("showOptions", { ntxId: "ntx-1" });
    });

    it("note-tree scoped action triggers on the tree component with the active node", async () => {
        const tree = document.createElement("div");
        tree.className = "tree-wrapper";
        document.body.appendChild(tree);

        const treeTrigger = vi.fn();
        const getActiveNode = vi.fn(() => ({ key: "node-1" }));
        getComponentByEl.mockReturnValue({ getActiveNode, triggerCommand: treeTrigger });

        registry.register({
            id: "treeCmd",
            name: "Tree",
            commandName: "deleteNotes" as never,
            keyboardAction: action({ scope: "note-tree" })
        });
        await registry.executeCommand("treeCmd");

        expect(getComponentByEl).toHaveBeenCalledWith(tree);
        expect(treeTrigger).toHaveBeenCalledWith("deleteNotes", {
            ntxId: "ntx-1",
            node: { key: "node-1" }
        });
        tree.remove();
    });

    it("note-tree scoped action does nothing when the tree element is absent", async () => {
        // Ensure no .tree-wrapper element exists.
        document.querySelectorAll(".tree-wrapper").forEach((el) => el.remove());

        registry.register({
            id: "treeCmd2",
            name: "Tree2",
            commandName: "deleteNotes" as never,
            keyboardAction: action({ scope: "note-tree" })
        });
        await registry.executeCommand("treeCmd2");
        expect(getComponentByEl).not.toHaveBeenCalled();
    });

    it("text-detail scoped action triggers on the active type widget", async () => {
        const widgetTrigger = vi.fn();
        getActiveContext.mockReturnValue({
            getTypeWidget: async () => ({ triggerCommand: widgetTrigger })
        });

        registry.register({
            id: "textCmd",
            name: "Text",
            commandName: "addLinkToText" as never,
            keyboardAction: action({ scope: "text-detail" })
        });
        await registry.executeCommand("textCmd");
        // executeCommand does NOT await executeWithTextDetail (source line 248), and
        // executeWithTextDetail internally awaits getTypeWidget(). Flush the
        // microtask/macrotask queue so the fire-and-forget widgetTrigger call has
        // definitely run before we assert, rather than relying on incidental
        // microtask ordering of a single await hop.
        await new Promise((r) => setTimeout(r, 0));
        expect(widgetTrigger).toHaveBeenCalledWith("addLinkToText", { ntxId: "ntx-1" });
    });

    it("text-detail scoped action does nothing when there is no type widget", async () => {
        getActiveContext.mockReturnValue({ getTypeWidget: async () => null });

        registry.register({
            id: "textCmd2",
            name: "Text2",
            commandName: "addLinkToText" as never,
            keyboardAction: action({ scope: "text-detail" })
        });
        await registry.executeCommand("textCmd2");
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("text-detail scoped action does nothing when there is no active context", async () => {
        getActiveContext.mockReturnValue(undefined);

        registry.register({
            id: "textCmd3",
            name: "Text3",
            commandName: "addLinkToText" as never,
            keyboardAction: action({ scope: "text-detail" })
        });
        await registry.executeCommand("textCmd3");
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("prefers a custom handler over keyboardAction/commandName", async () => {
        const handler = vi.fn(async () => {});
        registry.register({
            id: "handlerCmd",
            name: "Handler",
            commandName: "showOptions" as never,
            keyboardAction: action({ scope: "window" }),
            handler
        });
        await registry.executeCommand("handlerCmd");
        expect(handler).toHaveBeenCalledTimes(1);
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("keyboardAction without a commandName falls through to the commandName fallback", async () => {
        // keyboardAction present but commandName missing -> the keyboardAction
        // block is skipped (needs both); no commandName -> error path.
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        registry.register({
            id: "kbNoName",
            name: "KbNoName",
            keyboardAction: action({ scope: "window" })
        });
        await registry.executeCommand("kbNoName");
        expect(consoleError).toHaveBeenCalledWith("Command kbNoName has no handler or commandName");
        consoleError.mockRestore();
    });
});

describe("command_registry singleton", () => {
    it("exports a default singleton instance", async () => {
        const mod = await import("./command_registry.js");
        expect(mod.default).toBeInstanceOf(CommandRegistry);
    });
});

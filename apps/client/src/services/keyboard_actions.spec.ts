import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionKeyboardShortcut } from "@triliumnext/commons";
import appContext from "../components/app_context.js";

// `appContext` pulls in a very large dependency graph (CKEditor, CodeMirror,
// Tabulator, …) and at module-load `keyboard_actions.ts` only needs
// `triggerCommand` + `tabManager.activeNtxId`. Stub it out.
vi.mock("../components/app_context.js", () => ({
    default: {
        triggerCommand: vi.fn(),
        tabManager: { activeNtxId: "ntx-active" }
    }
}));

// `updateDisplayedShortcuts` formats shortcuts via keyboard_shortcut_display, which resolves each key
// label through i18n. Stub `t` to resolve the shortcut-key labels the way the translation files do.
vi.mock("./i18n.js", () => ({
    t: (key: string) => {
        if (key.startsWith("keyboard_shortcut_keys.")) {
            const labels: Record<string, string> = {
                ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta"
            };
            return labels[key.slice("keyboard_shortcut_keys.".length)] ?? key;
        }
        return key;
    }
}));

type KbModule = typeof import("./keyboard_actions.js");
type ShortcutsModule = typeof import("./shortcuts.js");

interface LoadedModule {
    kb: KbModule;
    /** the SAME shortcuts instance the freshly-loaded keyboard_actions imports */
    shortcuts: ShortcutsModule["default"];
}

/**
 * (Re)load `keyboard_actions.ts` from scratch with a controlled set of actions
 * returned by `server.get("keyboard-actions")`. The repo is built once at
 * module-evaluation time, so we must seed the response before importing.
 *
 * Because `vi.resetModules()` produces a fresh module graph, spies must be
 * installed on the freshly imported `shortcuts` instance — that's what the
 * `beforeKbImport` hook is for (it runs before `keyboard_actions` is imported,
 * so it can also observe the module-load-time `bindGlobalShortcut` calls).
 */
async function loadModule(
    actions: ActionKeyboardShortcut[],
    beforeKbImport?: (shortcuts: ShortcutsModule["default"]) => void
): Promise<LoadedModule> {
    vi.resetModules();

    // The fresh module graph re-imports server.js (still globally mocked by
    // setup.ts); override its `get` so the keyboard-actions GET yields our data.
    const freshServer = (await import("./server.js")).default;
    freshServer.get = vi.fn(async (url: string) => {
        if (url === "keyboard-actions") {
            // clone so the module's in-place filtering doesn't mutate our input
            return actions.map((a) => ({ ...a, effectiveShortcuts: a.effectiveShortcuts ? [...a.effectiveShortcuts] : a.effectiveShortcuts }));
        }
        return [];
    }) as typeof freshServer.get;

    const shortcuts = (await import("./shortcuts.js")).default;
    beforeKbImport?.(shortcuts);

    const kb = await import("./keyboard_actions.js");
    return { kb, shortcuts };
}

function action(partial: { actionName: string; scope?: string; effectiveShortcuts?: string[] }): ActionKeyboardShortcut {
    return partial as unknown as ActionKeyboardShortcut;
}

describe("keyboard_actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("filters out separators and global: shortcuts when building the repo", async () => {
        const { kb } = await loadModule([
            action({ actionName: "" }), // separator -> dropped
            action({ actionName: "doFoo", effectiveShortcuts: ["global:ctrl+g", "ctrl+f"], scope: "text-detail" }),
            action({ actionName: "noShortcuts" }) // effectiveShortcuts undefined -> defaults to []
        ]);

        const all = await kb.default.getActions();
        // separator removed
        expect(all.map((a) => a.actionName)).toEqual(["doFoo", "noShortcuts"]);

        // global: prefixed shortcut stripped, the plain one kept
        const foo = kb.getActionSync("doFoo");
        expect(foo.effectiveShortcuts).toEqual(["ctrl+f"]);

        // undefined effectiveShortcuts normalised to []
        expect(kb.getActionSync("noShortcuts").effectiveShortcuts).toEqual([]);
    });

    it("getActionsForScope returns only matching scope", async () => {
        const { kb } = await loadModule([
            action({ actionName: "winA", scope: "window", effectiveShortcuts: [] }),
            action({ actionName: "treeA", scope: "note-tree", effectiveShortcuts: [] }),
            action({ actionName: "winB", scope: "window", effectiveShortcuts: [] })
        ]);

        const treeActions = await kb.default.getActionsForScope("note-tree");
        expect(treeActions.map((a) => a.actionName)).toEqual(["treeA"]);
    });

    it("binds window-scoped shortcuts globally at module load", async () => {
        let spy: ReturnType<typeof vi.spyOn> | undefined;
        const { kb } = await loadModule(
            [
                action({ actionName: "winA", scope: "window", effectiveShortcuts: ["ctrl+1", "ctrl+2"] }),
                action({ actionName: "winNoShortcut", scope: "window" }), // undefined effectiveShortcuts -> [] loop body skipped
                action({ actionName: "treeA", scope: "note-tree", effectiveShortcuts: ["ctrl+9"] }) // wrong scope -> ignored
            ],
            // install the spy on the fresh instance BEFORE keyboard_actions imports
            (shortcuts) => {
                spy = vi.spyOn(shortcuts, "bindGlobalShortcut");
            }
        );

        // wait for the module-load `getActionsForScope("window").then(...)` to settle
        await kb.default.getActions();
        await Promise.resolve();

        expect(spy).toHaveBeenCalledTimes(2);
        const boundShortcuts = spy!.mock.calls.map((c) => c[0]);
        expect(boundShortcuts).toEqual(["ctrl+1", "ctrl+2"]);

        // The bound handler routes to appContext.triggerCommand with the active ntx id.
        const handler = spy!.mock.calls[0][1] as () => void;
        handler();
        expect(appContext.triggerCommand).toHaveBeenCalledWith("winA", { ntxId: "ntx-active" });

        spy!.mockRestore();
    });

    it("setupActionsForElement returns [] for an empty jQuery element", async () => {
        const { kb } = await loadModule([action({ actionName: "a", scope: "text-detail", effectiveShortcuts: ["ctrl+a"] })]);
        const $empty = $(); // length 0 -> $el[0] undefined
        const bindings = await kb.default.setupActionsForElement("text-detail", $empty as any, {} as any, "ntx1");
        expect(bindings).toEqual([]);
    });

    it("setupActionsForElement binds each shortcut and wires the command", async () => {
        const { kb } = await loadModule([
            action({ actionName: "cmdA", scope: "text-detail", effectiveShortcuts: ["ctrl+a", "ctrl+b"] }),
            action({ actionName: "cmdNoShortcut", scope: "text-detail" }), // undefined -> inner loop skipped
            action({ actionName: "other", scope: "note-tree", effectiveShortcuts: ["ctrl+z"] }) // other scope ignored
        ]);

        const $el = $("<div></div>");
        const component = { triggerCommand: vi.fn() } as any;
        const bindings = await kb.default.setupActionsForElement("text-detail", $el as any, component, "ntx1");

        // two shortcuts on cmdA each produced a binding
        expect(bindings).toHaveLength(2);
        expect(bindings.map((b) => b.shortcut)).toEqual(["ctrl+a", "ctrl+b"]);

        // invoking the stored handler triggers the action command with the ntxId
        bindings[0].handler(new KeyboardEvent("keydown"));
        expect(component.triggerCommand).toHaveBeenCalledWith("cmdA", { ntxId: "ntx1" });
    });

    it("handles a repo action whose effectiveShortcuts becomes nullish (the ?? [] fallbacks)", async () => {
        // The loader normalizes effectiveShortcuts to an array, but the repo entry is
        // shared by reference (getActionSync returns it), so it can be mutated back to
        // nullish — exercising the defensive `?? []` fallbacks in the reader functions.
        const { kb } = await loadModule([
            action({ actionName: "nullable", scope: "text-detail", effectiveShortcuts: ["ctrl+a"] })
        ]);
        await kb.default.getActions();

        kb.getActionSync("nullable").effectiveShortcuts = undefined;

        // setupActionsForElement: inner `for ... of (effectiveShortcuts ?? [])` -> no bindings
        const $el = $("<div></div>");
        const bindings = await kb.default.setupActionsForElement("text-detail", $el as any, { triggerCommand: vi.fn() } as any, "n");
        expect(bindings).toEqual([]);

        // updateDisplayedShortcuts: both `(effectiveShortcuts ?? []).join(...)` fallbacks
        const $container = $(`<div>
            <kbd data-command="nullable">something</kbd>
            <span data-trigger-command="nullable"></span>
        </div>`);
        kb.default.updateDisplayedShortcuts($container as any);
        await new Promise((r) => setTimeout(r, 0));

        // empty join + text !== "not set" -> set to ""
        expect($container.find('kbd[data-command="nullable"]').text()).toBe("");
        // empty join + no title -> title becomes "" (empty shortcuts)
        expect($container.find('[data-trigger-command="nullable"]').attr("title")).toBe("");
    });

    it("setupActionsForElement skips falsy bindings (non-desktop) without pushing", async () => {
        // override the fresh bindElShortcut to return undefined -> binding falsy -> not pushed
        let bindSpy: ReturnType<typeof vi.spyOn> | undefined;
        const { kb } = await loadModule(
            [action({ actionName: "cmdA", scope: "text-detail", effectiveShortcuts: ["ctrl+a"] })],
            (shortcuts) => {
                bindSpy = vi.spyOn(shortcuts, "bindElShortcut").mockReturnValue(undefined as any);
            }
        );

        const $el = $("<div></div>");
        const component = { triggerCommand: vi.fn() } as any;
        const bindings = await kb.default.setupActionsForElement("text-detail", $el as any, component, null);

        expect(bindSpy).toHaveBeenCalledTimes(1);
        expect(bindings).toEqual([]);
        bindSpy!.mockRestore();
    });

    it("getAction throws for an unknown action by default and is silent when asked", async () => {
        const { kb } = await loadModule([action({ actionName: "known", scope: "window", effectiveShortcuts: [] })]);

        await expect(kb.default.getAction("known")).resolves.toMatchObject({ actionName: "known" });

        await expect(kb.default.getAction("missing" as never)).rejects.toThrow("Cannot find action 'missing'");

        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
        const result = await kb.default.getAction("missing" as never, true);
        expect(result).toBeUndefined();
        expect(debugSpy).toHaveBeenCalledWith("Cannot find action 'missing'");
        debugSpy.mockRestore();
    });

    it("updateDisplayedShortcuts fills kbd[data-command] text and appends to data-trigger-command title", async () => {
        const { kb } = await loadModule([
            action({ actionName: "cmdKbd", scope: "window", effectiveShortcuts: ["ctrl+a", "ctrl+b"] }),
            action({ actionName: "cmdEmpty", scope: "window", effectiveShortcuts: [] }),
            action({ actionName: "cmdTrigger", scope: "window", effectiveShortcuts: ["ctrl+t"] }),
            action({ actionName: "cmdTriggerNoTitle", scope: "window", effectiveShortcuts: ["ctrl+n"] }),
            action({ actionName: "cmdTriggerAlready", scope: "window", effectiveShortcuts: ["ctrl+x"] })
        ]);
        await kb.default.getActions();

        const $container = $(`
            <div>
                <kbd data-command="cmdKbd">not set</kbd>
                <kbd data-command="cmdEmpty">not set</kbd>
                <kbd data-command="">no name</kbd>
                <kbd data-command="cmdMissing">not set</kbd>
                <span data-trigger-command="cmdTrigger" title="My label"></span>
                <span data-trigger-command="cmdTriggerNoTitle"></span>
                <span data-trigger-command="cmdTriggerAlready" title="X (Ctrl+x)"></span>
                <span data-trigger-command=""></span>
                <span data-trigger-command="cmdMissing"></span>
            </div>
        `);

        kb.default.updateDisplayedShortcuts($container as any);

        // jQuery .each runs synchronously but the async getAction inside resolves later
        await new Promise((r) => setTimeout(r, 0));

        // Shortcuts are localized for display: the modifier token normalizes to its canonical label.
        expect($container.find('kbd[data-command="cmdKbd"]').text()).toBe("Ctrl+a, Ctrl+b");
        // empty shortcuts but text already "not set" -> condition false -> text untouched
        expect($container.find('kbd[data-command="cmdEmpty"]').text()).toBe("not set");
        // missing action -> getAction silent returns undefined -> skipped
        expect($container.find('kbd[data-command="cmdMissing"]').text()).toBe("not set");

        // title with content gets the shortcut appended in parentheses
        expect($container.find('[data-trigger-command="cmdTrigger"]').attr("title")).toBe("My label (Ctrl+t)");
        // no title -> becomes just the shortcuts
        expect($container.find('[data-trigger-command="cmdTriggerNoTitle"]').attr("title")).toBe("Ctrl+n");
        // title already includes the shortcut -> early return, unchanged
        expect($container.find('[data-trigger-command="cmdTriggerAlready"]').attr("title")).toBe("X (Ctrl+x)");
    });

    it("updateDisplayedShortcuts sets text when shortcuts empty but element text differs from 'not set'", async () => {
        const { kb } = await loadModule([
            action({ actionName: "cmdEmpty2", scope: "window", effectiveShortcuts: [] })
        ]);
        await kb.default.getActions();

        const $container = $(`<div><kbd data-command="cmdEmpty2">something</kbd></div>`);
        kb.default.updateDisplayedShortcuts($container as any);
        await new Promise((r) => setTimeout(r, 0));

        // text !== "not set" -> condition true -> text set to "" (empty joined shortcuts)
        expect($container.find('kbd[data-command="cmdEmpty2"]').text()).toBe("");
    });
});

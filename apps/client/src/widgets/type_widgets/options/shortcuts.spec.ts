import { ActionKeyboardShortcut, KeyboardShortcut } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { computeConflictGroups, computeConflicts, filterKeyboardAction, getActionNameFromOptionName, getOptionName, groupShortcuts, isRecorderCancelKey, keyboardEventToShortcut, matchesFilter, setGlobalShortcut } from "./shortcuts";

function keyEvent(init: KeyboardEventInit) {
    return new KeyboardEvent("keydown", init);
}

function action(actionName: string, friendlyName: string, effectiveShortcuts: string[], defaultShortcuts: string[] = effectiveShortcuts, scope?: ActionKeyboardShortcut["scope"]): ActionKeyboardShortcut {
    return { actionName, friendlyName, effectiveShortcuts, defaultShortcuts, scope } as ActionKeyboardShortcut;
}

describe("keyboardEventToShortcut", () => {
    it("combines modifiers with the pressed key", () => {
        expect(keyboardEventToShortcut(keyEvent({ key: "j", code: "KeyJ", ctrlKey: true }))).toBe("Ctrl+J");
        expect(keyboardEventToShortcut(keyEvent({ key: "J", code: "KeyJ", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+J");
    });

    it("always orders modifiers as Ctrl, Alt, Shift, Meta", () => {
        const shortcut = keyboardEventToShortcut(keyEvent({
            key: "k", code: "KeyK", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true
        }));

        expect(shortcut).toBe("Ctrl+Alt+Shift+Meta+K");
    });

    it("uses the physical key code so the result is keyboard-layout independent", () => {
        // On macOS, Alt produces a special character in `key`, but `code` stays stable.
        expect(keyboardEventToShortcut(keyEvent({ key: "√", code: "KeyV", altKey: true }))).toBe("Alt+V");
        expect(keyboardEventToShortcut(keyEvent({ key: "1", code: "Digit1", ctrlKey: true }))).toBe("Ctrl+1");
        expect(keyboardEventToShortcut(keyEvent({ key: "1", code: "Numpad1", ctrlKey: true }))).toBe("Ctrl+1");
    });

    it("records the plus key as the named 'Plus' token", () => {
        // On a German/QWERTZ layout "+" is its own key (code "BracketRight"); storing it verbatim as
        // "Ctrl++" collides with the separator, so it is normalized to a stable "Plus" token.
        expect(keyboardEventToShortcut(keyEvent({ key: "+", code: "BracketRight", ctrlKey: true }))).toBe("Ctrl+Plus");
        expect(keyboardEventToShortcut(keyEvent({ key: "+", code: "NumpadAdd", ctrlKey: true }))).toBe("Ctrl+Plus");
    });

    it("maps arrow and space keys to the stored names", () => {
        expect(keyboardEventToShortcut(keyEvent({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }))).toBe("Alt+Left");
        expect(keyboardEventToShortcut(keyEvent({ key: "ArrowUp", code: "ArrowUp", ctrlKey: true }))).toBe("Ctrl+Up");
        expect(keyboardEventToShortcut(keyEvent({ key: " ", code: "Space", ctrlKey: true }))).toBe("Ctrl+Space");
    });

    it("returns null for a lone modifier key", () => {
        expect(keyboardEventToShortcut(keyEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
        expect(keyboardEventToShortcut(keyEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
        expect(keyboardEventToShortcut(keyEvent({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeNull();
    });

    describe("single-key shortcuts", () => {
        it("rejects a modifier-less ordinary key", () => {
            expect(keyboardEventToShortcut(keyEvent({ key: "a", code: "KeyA" }))).toBeNull();
            expect(keyboardEventToShortcut(keyEvent({ key: "1", code: "Digit1" }))).toBeNull();
            expect(keyboardEventToShortcut(keyEvent({ key: "Escape", code: "Escape" }))).toBeNull();
        });

        it("allows modifier-less function keys, Delete and Enter", () => {
            expect(keyboardEventToShortcut(keyEvent({ key: "F5", code: "F5" }))).toBe("F5");
            expect(keyboardEventToShortcut(keyEvent({ key: "F11", code: "F11" }))).toBe("F11");
            expect(keyboardEventToShortcut(keyEvent({ key: "Delete", code: "Delete" }))).toBe("Delete");
            expect(keyboardEventToShortcut(keyEvent({ key: "Enter", code: "Enter" }))).toBe("Enter");
            expect(keyboardEventToShortcut(keyEvent({ key: "Enter", code: "NumpadEnter" }))).toBe("Enter");
        });

        it("allows a single key once a modifier is held", () => {
            expect(keyboardEventToShortcut(keyEvent({ key: "a", code: "KeyA", shiftKey: true }))).toBe("Shift+A");
        });

        it("treats Escape with a modifier as a bindable shortcut, not a bare cancel key", () => {
            // The recorder uses bare Escape to cancel, so these must still produce a shortcut.
            expect(keyboardEventToShortcut(keyEvent({ key: "Escape", code: "Escape", ctrlKey: true }))).toBe("Ctrl+Escape");
            expect(keyboardEventToShortcut(keyEvent({ key: "Escape", code: "Escape", altKey: true }))).toBe("Alt+Escape");
        });
    });
});

describe("isRecorderCancelKey", () => {
    it("cancels on a bare Escape", () => {
        expect(isRecorderCancelKey(keyEvent({ key: "Escape", code: "Escape" }))).toBe(true);
    });

    it("does not cancel when Escape is held with a modifier", () => {
        expect(isRecorderCancelKey(keyEvent({ key: "Escape", code: "Escape", ctrlKey: true }))).toBe(false);
        expect(isRecorderCancelKey(keyEvent({ key: "Escape", code: "Escape", altKey: true }))).toBe(false);
        expect(isRecorderCancelKey(keyEvent({ key: "Escape", code: "Escape", shiftKey: true }))).toBe(false);
        expect(isRecorderCancelKey(keyEvent({ key: "Escape", code: "Escape", metaKey: true }))).toBe(false);
    });

    it("does not cancel on other keys", () => {
        expect(isRecorderCancelKey(keyEvent({ key: "a", code: "KeyA" }))).toBe(false);
    });
});

describe("groupShortcuts", () => {
    it("buckets actions under the preceding separator", () => {
        const groups = groupShortcuts([
            { separator: "Navigation" } as KeyboardShortcut,
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+K" ]),
            { separator: "Editing" } as KeyboardShortcut,
            action("c", "Action C", [ "Ctrl+L" ])
        ]);

        expect(groups.map((g) => g.title)).toEqual([ "Navigation", "Editing" ]);
        expect(groups[0].actions.map((a) => a.actionName)).toEqual([ "a", "b" ]);
        expect(groups[1].actions.map((a) => a.actionName)).toEqual([ "c" ]);
    });

    it("ignores actions that precede the first separator", () => {
        const groups = groupShortcuts([
            action("orphan", "Orphan", [ "Ctrl+J" ]),
            { separator: "Group" } as KeyboardShortcut,
            action("a", "Action A", [ "Ctrl+K" ])
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0].actions.map((a) => a.actionName)).toEqual([ "a" ]);
    });
});

describe("filterKeyboardAction", () => {
    const target = {
        ...action("toggleZenMode", "Toggle Zen Mode", [ "Ctrl+Shift+Z" ], [ "Ctrl+Alt+Z" ]),
        description: "Hide the UI chrome"
    } as ActionKeyboardShortcut;

    it("matches against the action name, friendly name and description (lower-cased)", () => {
        expect(filterKeyboardAction(target, "zen")).toBeTruthy();
        expect(filterKeyboardAction(target, "togglezen")).toBeTruthy();
        expect(filterKeyboardAction(target, "chrome")).toBeTruthy();
    });

    it("matches against both effective and default shortcuts", () => {
        expect(filterKeyboardAction(target, "ctrl+shift+z")).toBeTruthy();
        expect(filterKeyboardAction(target, "ctrl+alt+z")).toBeTruthy();
    });

    it("returns falsy when nothing matches", () => {
        expect(filterKeyboardAction(target, "nonexistent")).toBeFalsy();
    });
});

describe("option name round-trip", () => {
    it("maps an action name to its option name and back", () => {
        expect(getOptionName("toggleZenMode")).toBe("keyboardShortcutsToggleZenMode");
        expect(getActionNameFromOptionName("keyboardShortcutsToggleZenMode")).toBe("toggleZenMode");
    });

    it("returns an empty string (not 'undefined') for a suffix-less option name", () => {
        expect(getActionNameFromOptionName("keyboardShortcuts")).toBe("");
    });
});

describe("setGlobalShortcut", () => {
    it("adds the global prefix and is idempotent", () => {
        expect(setGlobalShortcut("Ctrl+J", true)).toBe("global:Ctrl+J");
        expect(setGlobalShortcut("global:Ctrl+J", true)).toBe("global:Ctrl+J");
    });

    it("strips the global prefix to make a shortcut local", () => {
        expect(setGlobalShortcut("global:Ctrl+J", false)).toBe("Ctrl+J");
        expect(setGlobalShortcut("Ctrl+J", false)).toBe("Ctrl+J");
    });
});

describe("computeConflicts", () => {
    it("reports no conflicts when every shortcut is unique", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+K" ])
        ]);

        expect(conflicts.size).toBe(0);
    });

    it("flags both actions sharing a combination, keyed by the original shortcut string", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+J" ])
        ]);

        expect(conflicts.get("a")?.get("Ctrl+J")).toEqual([ "Action B" ]);
        expect(conflicts.get("b")?.get("Ctrl+J")).toEqual([ "Action A" ]);
    });

    it("detects conflicts across differing modifier order and key aliases", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "Ctrl+Shift+J" ]),
            action("b", "Action B", [ "Shift+Ctrl+J" ]),
            action("c", "Action C", [ "Ctrl+Del" ]),
            action("d", "Action D", [ "Ctrl+Delete" ])
        ]);

        expect(conflicts.get("a")?.get("Ctrl+Shift+J")).toEqual([ "Action B" ]);
        expect(conflicts.get("c")?.get("Ctrl+Del")).toEqual([ "Action D" ]);
    });

    it("treats a global shortcut as conflicting with its in-app equivalent", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "global:Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+J" ])
        ]);

        expect(conflicts.get("a")?.get("global:Ctrl+J")).toEqual([ "Action B" ]);
        expect(conflicts.get("b")?.get("Ctrl+J")).toEqual([ "Action A" ]);
    });

    it("lists every other action when more than two collide", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+J" ]),
            action("c", "Action C", [ "Ctrl+J" ])
        ]);

        expect(conflicts.get("a")?.get("Ctrl+J")).toEqual([ "Action B", "Action C" ]);
    });

    it("only marks the conflicting shortcut on an action that also has unique ones", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "Ctrl+J", "Ctrl+K" ]),
            action("b", "Action B", [ "Ctrl+K" ])
        ]);

        const perShortcut = conflicts.get("a");
        expect(perShortcut?.has("Ctrl+J")).toBe(false);
        expect(perShortcut?.get("Ctrl+K")).toEqual([ "Action B" ]);
    });

    it("does not treat an action's own duplicate shortcut as a conflict", () => {
        const conflicts = computeConflicts([
            action("a", "Action A", [ "Ctrl+J", "Ctrl+J" ])
        ]);

        expect(conflicts.size).toBe(0);
    });

    it("ignores separators", () => {
        const conflicts = computeConflicts([
            { separator: "Group" } as KeyboardShortcut,
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+J" ])
        ]);

        expect(conflicts.get("a")?.get("Ctrl+J")).toEqual([ "Action B" ]);
    });

    describe("scope awareness", () => {
        const shortcuts = (sc: string) => [ sc ];

        it("flags same-combo actions that share a scope (e.g. Ctrl+0 lastTab vs zoomReset, both window)", () => {
            const conflicts = computeConflicts([
                action("lastTab", "Switch to Last Tab", shortcuts("Ctrl+0"), undefined, "window"),
                action("zoomReset", "Reset Zoom Level", shortcuts("Ctrl+0"), undefined, "window")
            ]);

            expect(conflicts.get("lastTab")?.get("Ctrl+0")).toEqual([ "Reset Zoom Level" ]);
            expect(conflicts.get("zoomReset")?.get("Ctrl+0")).toEqual([ "Switch to Last Tab" ]);
        });

        it("does not flag same-combo actions in mutually-exclusive scopes (e.g. Ctrl+Enter text vs code)", () => {
            const conflicts = computeConflicts([
                action("followLinkUnderCursor", "Follow Link Under Cursor", shortcuts("Ctrl+Enter"), undefined, "text-detail"),
                action("runActiveNote", "Run Active Note", shortcuts("Ctrl+Enter"), undefined, "code-detail")
            ]);

            expect(conflicts.size).toBe(0);
        });

        it("treats a window-scoped shortcut as conflicting with any other scope", () => {
            const conflicts = computeConflicts([
                action("a", "Window Action", shortcuts("Ctrl+K"), undefined, "window"),
                action("b", "Tree Action", shortcuts("Ctrl+K"), undefined, "note-tree")
            ]);

            expect(conflicts.get("a")?.get("Ctrl+K")).toEqual([ "Tree Action" ]);
            expect(conflicts.get("b")?.get("Ctrl+K")).toEqual([ "Window Action" ]);
        });
    });
});

describe("computeConflictGroups", () => {
    it("groups conflicting actions by the combination they collide on, titled with the combo", () => {
        const groups = computeConflictGroups([
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+J" ]),
            action("c", "Action C", [ "Ctrl+K" ])
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0].title).toBe("Ctrl+J");
        expect(groups[0].actions.map((a) => a.actionName)).toEqual([ "a", "b" ]);
    });

    it("excludes combinations whose actions are in mutually-exclusive scopes", () => {
        const groups = computeConflictGroups([
            action("a", "Action A", [ "Ctrl+Enter" ], undefined, "text-detail"),
            action("b", "Action B", [ "Ctrl+Enter" ], undefined, "code-detail")
        ]);

        expect(groups).toHaveLength(0);
    });

    it("lists an action under each combination it conflicts on", () => {
        const groups = computeConflictGroups([
            action("multi", "Multi", [ "Ctrl+J", "Ctrl+K" ]),
            action("a", "Action A", [ "Ctrl+J" ]),
            action("b", "Action B", [ "Ctrl+K" ])
        ]);

        expect(groups.map((g) => g.title)).toEqual([ "Ctrl+J", "Ctrl+K" ]);
        expect(groups[0].actions.map((a) => a.actionName)).toEqual([ "multi", "a" ]);
        expect(groups[1].actions.map((a) => a.actionName)).toEqual([ "multi", "b" ]);
    });
});

describe("matchesFilter", () => {
    const globalAction = action("a", "Action A", [ "global:Ctrl+J" ]);
    const localAction = action("b", "Action B", [ "Ctrl+K" ]);
    const mixedAction = action("c", "Action C", [ "global:Ctrl+J", "Ctrl+K" ]);
    const noShortcuts = action("d", "Action D", []);
    // `a` and `b`/`c` collide on Ctrl+J / global:Ctrl+J; `d` and the unique Ctrl+K do not.
    const conflicts = computeConflicts([ globalAction, localAction, mixedAction, noShortcuts ]);

    it("matches everything when no filter is selected", () => {
        for (const a of [ globalAction, localAction, mixedAction, noShortcuts ]) {
            expect(matchesFilter(a, null, conflicts)).toBe(true);
        }
    });

    it("keeps only actions with a global shortcut when filtering by global", () => {
        expect(matchesFilter(globalAction, "global", conflicts)).toBe(true);
        expect(matchesFilter(mixedAction, "global", conflicts)).toBe(true);
        expect(matchesFilter(localAction, "global", conflicts)).toBe(false);
        expect(matchesFilter(noShortcuts, "global", conflicts)).toBe(false);
    });

    it("keeps only actions involved in a conflict when filtering by conflicts", () => {
        expect(matchesFilter(globalAction, "conflicts", conflicts)).toBe(true);
        expect(matchesFilter(mixedAction, "conflicts", conflicts)).toBe(true);
        expect(matchesFilter(noShortcuts, "conflicts", conflicts)).toBe(false);
    });

    it("keeps only actions changed from their default when filtering by modified", () => {
        const unchanged = action("e", "Action E", [ "Ctrl+J" ], [ "Ctrl+J" ]);
        const changed = action("f", "Action F", [ "Ctrl+J" ], [ "Ctrl+K" ]);
        const cleared = action("g", "Action G", [], [ "Ctrl+K" ]);

        expect(matchesFilter(unchanged, "modified", conflicts)).toBe(false);
        expect(matchesFilter(changed, "modified", conflicts)).toBe(true);
        expect(matchesFilter(cleared, "modified", conflicts)).toBe(true);
    });
});

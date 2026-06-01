import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core keyboard routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface KeyboardAction {
    actionName?: string;
    scope?: string;
    defaultShortcuts?: string[];
    effectiveShortcuts?: string[];
    separator?: string;
}

interface ShortcutAttribute {
    attributeId: string;
    noteId: string;
    type: string;
    name: string;
    value: string;
}

describe("Keys API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("keyboard actions", () => {
        it("returns the list of keyboard actions with their definitions", async () => {
            const res = await api.get<KeyboardAction[]>("/api/keyboard-actions");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);

            const named = res.body.find((action) => action.actionName === "jumpToNote");
            expect(named).toBeDefined();
            expect(named?.scope).toBeTruthy();
            // effectiveShortcuts is derived from defaultShortcuts when no option overrides it.
            expect(Array.isArray(named?.effectiveShortcuts)).toBe(true);
        });
    });

    describe("keyboard shortcuts for notes", () => {
        it("returns an array of keyboardShortcut label attributes", async () => {
            const res = await api.get<ShortcutAttribute[]>("/api/keyboard-shortcuts-for-notes");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);

            for (const attr of res.body) {
                expect(attr.name).toBe("keyboardShortcut");
                expect(attr.type).toBe("label");
            }
        });

        it("includes a newly added keyboardShortcut label on a note", async () => {
            const { noteId } = await createTextNote(api, { title: "Shortcut host" });

            const add = await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name: "keyboardShortcut", value: "Ctrl+Alt+Z" }
            });
            expect(add.status).toBe(204);

            const res = await api.get<ShortcutAttribute[]>("/api/keyboard-shortcuts-for-notes");
            expect(res.status).toBe(200);

            const added = res.body.find((attr) => attr.noteId === noteId);
            expect(added).toBeDefined();
            expect(added?.name).toBe("keyboardShortcut");
            expect(added?.value).toBe("Ctrl+Alt+Z");
        });
    });
});

import { describe, expect, it, vi } from "vitest";

import { splitMenuItem, submenuItem } from "./context_menu_utils";

describe("submenuItem", () => {
    it("opens its items, and is enabled while any of their commands is", () => {
        const on = { title: "On" };
        const off = { title: "Off", enabled: false };
        const separator = { kind: "separator" as const };

        expect(submenuItem({ title: "Group", uiIcon: "bx bx-folder" }, [off, separator, on]))
            .toEqual({
                title: "Group",
                uiIcon: "bx bx-folder",
                enabled: true,
                items: [off, separator, on]
            });
        expect(submenuItem({ title: "Group" }, [off, separator]).enabled).toBe(false);
    });
});

describe("splitMenuItem", () => {
    it("runs its primary item, showing its shortcut, and lists it first in the submenu", () => {
        const primary = {
            title: "Copy",
            uiIcon: "bx bx-copy",
            shortcut: "Ctrl+C",
            handler: vi.fn()
        };
        const variant = { title: "Copy as Markdown", handler: vi.fn() };

        const row = splitMenuItem(primary, [variant]);

        expect(row).toMatchObject({
            title: "Copy",
            uiIcon: "bx bx-copy",
            shortcut: "Ctrl+C",
            enabled: true
        });
        expect(row.items).toEqual([primary, variant]);
        expect(row.handler).toBe(primary.handler);

        const configurable = splitMenuItem(
            { title: "Copy", keyboardShortcut: "copyNotesToClipboard" }, [variant]);
        expect(configurable.keyboardShortcut).toBe("copyNotesToClipboard");
    });

    it("only opens its submenu while the primary item is disabled", () => {
        const primary = { title: "Copy", enabled: false, handler: vi.fn() };

        const row = splitMenuItem(primary, [{ title: "Copy as Markdown" }]);
        expect(row.enabled).toBe(true);
        expect(row.handler).toBeUndefined();

        expect(splitMenuItem(primary, [{ title: "Copy as Markdown", enabled: false }]).enabled)
            .toBe(false);
    });
});

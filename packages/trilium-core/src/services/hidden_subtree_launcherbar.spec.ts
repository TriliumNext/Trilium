import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import buildLaunchBarConfig from "./hidden_subtree_launcherbar.js";

function byId(items: HiddenSubtreeItem[], id: string): HiddenSubtreeItem {
    const item = items.find((i) => i.id === id);
    expect(item, `expected launcher ${id} to exist`).toBeDefined();
    return item!;
}

function labelValue(item: HiddenSubtreeItem, name: string): string | undefined {
    return item.attributes?.find((a) => a.type === "label" && a.name === name)?.value;
}

describe("buildLaunchBarConfig", () => {
    it("returns the four launcher groups, each non-empty and typed as launchers", () => {
        const config = buildLaunchBarConfig();

        const groups = [
            config.desktopAvailableLaunchers,
            config.desktopVisibleLaunchers,
            config.mobileAvailableLaunchers,
            config.mobileVisibleLaunchers
        ];

        for (const group of groups) {
            expect(Array.isArray(group)).toBe(true);
            expect(group.length).toBeGreaterThan(0);
            for (const launcher of group) {
                expect(launcher.type, launcher.id).toBe("launcher");
                expect(launcher.id, "every launcher has an id").toBeTruthy();
                expect(launcher.id.startsWith("_"), `${launcher.id} is a hidden-subtree id`).toBe(true);
                // Every launcher carries a title produced by the translation function.
                expect(typeof launcher.title, launcher.id).toBe("string");
            }
        }
    });

    it("assigns unique ids within each group", () => {
        const config = buildLaunchBarConfig();

        for (const group of [
            config.desktopAvailableLaunchers,
            config.desktopVisibleLaunchers,
            config.mobileAvailableLaunchers,
            config.mobileVisibleLaunchers
        ]) {
            const ids = group.map((l) => l.id);
            expect(new Set(ids).size, ids.join(",")).toBe(ids.length);
        }
    });

    it("exposes the expected desktop visible launcher ids in order", () => {
        const { desktopVisibleLaunchers } = buildLaunchBarConfig();

        expect(desktopVisibleLaunchers.map((l) => l.id)).toEqual([
            "_lbNewNote",
            "_lbSearch",
            "_lbJumpTo",
            "_lbNoteMap",
            "_lbLlmChat",
            "_lbCalendar",
            "_lbRecentChanges",
            "_lbSpacer1",
            "_lbBookmarks",
            "_lbToday",
            "_lbSpacer2",
            "_lbQuickSearch",
            "_lbProtectedSession",
            "_lbSyncStatus",
            "_lbSettings"
        ]);
    });

    it("exposes the expected mobile launcher ids", () => {
        const { mobileAvailableLaunchers, mobileVisibleLaunchers } = buildLaunchBarConfig();

        expect(mobileAvailableLaunchers.map((l) => l.id)).toEqual([
            "_lbMobileNewNote",
            "_lbMobileSearchNotes",
            "_lbMobileToday",
            "_lbMobileRecentChanges",
            "_lbMobileBookmarks",
            "_lbMobileSyncStatus"
        ]);
        expect(mobileVisibleLaunchers.map((l) => l.id)).toEqual([
            "_lbMobileBackInHistory",
            "_lbMobileForwardInHistory",
            "_lbMobileJumpTo",
            "_lbMobileCalendar",
            "_lbMobileTabSwitcher"
        ]);
    });

    it("wires command-driven launchers to their commands", () => {
        const config = buildLaunchBarConfig();

        expect(byId(config.desktopVisibleLaunchers, "_lbNewNote").command).toBe("createNoteIntoInbox");
        expect(byId(config.desktopVisibleLaunchers, "_lbSearch").command).toBe("searchNotes");
        expect(byId(config.desktopVisibleLaunchers, "_lbJumpTo").command).toBe("jumpToNote");
        expect(byId(config.desktopVisibleLaunchers, "_lbRecentChanges").command).toBe("showRecentChanges");
        expect(byId(config.desktopVisibleLaunchers, "_lbSettings").command).toBe("showOptions");
        expect(byId(config.desktopAvailableLaunchers, "_commandPalette").command).toBe("commandPalette");
        expect(byId(config.desktopAvailableLaunchers, "_zenMode").command).toBe("toggleZenMode");
    });

    it("wires builtin-widget launchers to their widgets", () => {
        const config = buildLaunchBarConfig();

        expect(byId(config.desktopVisibleLaunchers, "_lbCalendar").builtinWidget).toBe("calendar");
        expect(byId(config.desktopVisibleLaunchers, "_lbBookmarks").builtinWidget).toBe("bookmarks");
        expect(byId(config.desktopVisibleLaunchers, "_lbToday").builtinWidget).toBe("todayInJournal");
        expect(byId(config.desktopVisibleLaunchers, "_lbSyncStatus").builtinWidget).toBe("syncStatus");
        expect(byId(config.desktopVisibleLaunchers, "_lbQuickSearch").builtinWidget).toBe("quickSearch");
        expect(byId(config.desktopVisibleLaunchers, "_lbProtectedSession").builtinWidget).toBe("protectedSession");
        expect(byId(config.desktopAvailableLaunchers, "_lbSidebarChat").builtinWidget).toBe("sidebarChat");
        expect(byId(config.desktopAvailableLaunchers, "_lbBackInHistory").builtinWidget).toBe("backInHistoryButton");
        expect(byId(config.desktopAvailableLaunchers, "_lbForwardInHistory").builtinWidget).toBe("forwardInHistoryButton");
    });

    it("points target-note launchers at the right hidden notes", () => {
        const config = buildLaunchBarConfig();

        expect(byId(config.desktopAvailableLaunchers, "_lbBackendLog").targetNoteId).toBe("_backendLog");
        expect(byId(config.desktopVisibleLaunchers, "_lbNoteMap").targetNoteId).toBe("_globalNoteMap");
    });

    it("configures both spacers with distinct sizing", () => {
        const { desktopVisibleLaunchers } = buildLaunchBarConfig();

        const spacer1 = byId(desktopVisibleLaunchers, "_lbSpacer1");
        const spacer2 = byId(desktopVisibleLaunchers, "_lbSpacer2");

        expect(spacer1.builtinWidget).toBe("spacer");
        expect(spacer2.builtinWidget).toBe("spacer");
        expect(spacer1.baseSize).toBe("50");
        expect(spacer1.growthFactor).toBe("0");
        expect(spacer2.baseSize).toBe("0");
        expect(spacer2.growthFactor).toBe("1");
    });

    it("flags the deprecated LLM chat launcher as enforceDeleted with no widget", () => {
        const llmChat = byId(buildLaunchBarConfig().desktopVisibleLaunchers, "_lbLlmChat");

        expect(llmChat.enforceDeleted).toBe(true);
        expect(llmChat.command).toBeUndefined();
        expect(llmChat.builtinWidget).toBeUndefined();
        expect(llmChat.targetNoteId).toBeUndefined();
    });

    it("carries the docName / desktopOnly labels on the launchers that need them", () => {
        const config = buildLaunchBarConfig();

        expect(labelValue(byId(config.desktopAvailableLaunchers, "_lbBackInHistory"), "docName"))
            .toBe("launchbar_history_navigation");
        expect(labelValue(byId(config.desktopAvailableLaunchers, "_lbForwardInHistory"), "docName"))
            .toBe("launchbar_history_navigation");
        expect(labelValue(byId(config.desktopVisibleLaunchers, "_lbQuickSearch"), "docName"))
            .toBe("launchbar_quick_search");

        const jumpTo = byId(config.desktopVisibleLaunchers, "_lbJumpTo");
        expect(jumpTo.attributes?.some((a) => a.type === "label" && a.name === "desktopOnly")).toBe(true);
    });

    it("reuses the shared launcher definitions across desktop and mobile entries", () => {
        const config = buildLaunchBarConfig();

        const desktopNewNote = byId(config.desktopVisibleLaunchers, "_lbNewNote");
        const mobileNewNote = byId(config.mobileAvailableLaunchers, "_lbMobileNewNote");
        // Same shared definition (command + widget + icon), only the id differs.
        expect(mobileNewNote.command).toBe(desktopNewNote.command);
        expect(mobileNewNote.builtinWidget).toBe(desktopNewNote.builtinWidget);
        expect(mobileNewNote.icon).toBe(desktopNewNote.icon);

        const desktopSync = byId(config.desktopVisibleLaunchers, "_lbSyncStatus");
        const mobileSync = byId(config.mobileAvailableLaunchers, "_lbMobileSyncStatus");
        expect(mobileSync.builtinWidget).toBe(desktopSync.builtinWidget);
    });

    it("returns a fresh independent structure on each invocation", () => {
        const first = buildLaunchBarConfig();
        const second = buildLaunchBarConfig();

        expect(first).not.toBe(second);
        expect(first.desktopVisibleLaunchers).not.toBe(second.desktopVisibleLaunchers);
        expect(first.desktopVisibleLaunchers.map((l) => l.id))
            .toEqual(second.desktopVisibleLaunchers.map((l) => l.id));
    });
});

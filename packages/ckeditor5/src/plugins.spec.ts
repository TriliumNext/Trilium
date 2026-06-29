import { BlockToolbar } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { Admonition } from "@triliumnext/ckeditor5-admonition";
import { COMMON_PLUGINS, CORE_PLUGINS, loadPremiumPlugins, POPUP_EDITOR_PLUGINS } from "./plugins.js";
import CutToNotePlugin from "./plugins/cuttonote.js";
import Uploadfileplugin from "./plugins/file_upload/uploadfileplugin.js";
import IncludeNote from "./plugins/includenote.js";
import InternalLinkPlugin from "./plugins/internallink.js";
import LinkEmbed from "./plugins/linkembed.js";
import MentionCustomization from "./plugins/mention_customization.js";
import ReferenceLink from "./plugins/referencelink.js";

describe("plugin lists", () => {
    it("CORE_PLUGINS is a non-empty array", () => {
        expect(Array.isArray(CORE_PLUGINS)).toBe(true);
        expect(CORE_PLUGINS.length).toBeGreaterThan(0);
    });

    it("COMMON_PLUGINS is a non-empty array", () => {
        expect(Array.isArray(COMMON_PLUGINS)).toBe(true);
        expect(COMMON_PLUGINS.length).toBeGreaterThan(0);
    });

    it("POPUP_EDITOR_PLUGINS is a non-empty array", () => {
        expect(Array.isArray(POPUP_EDITOR_PLUGINS)).toBe(true);
        expect(POPUP_EDITOR_PLUGINS.length).toBeGreaterThan(0);
    });

    it("COMMON_PLUGINS includes all CORE_PLUGINS", () => {
        for (const plugin of CORE_PLUGINS) {
            expect(COMMON_PLUGINS).toContain(plugin);
        }
    });

    it("POPUP_EDITOR_PLUGINS includes all COMMON_PLUGINS", () => {
        for (const plugin of COMMON_PLUGINS) {
            expect(POPUP_EDITOR_PLUGINS).toContain(plugin);
        }
    });

    it("all entries in CORE_PLUGINS are functions (plugin constructors)", () => {
        for (const plugin of CORE_PLUGINS) {
            expect(typeof plugin).toBe("function");
        }
    });

    it("all entries in COMMON_PLUGINS are functions (plugin constructors)", () => {
        for (const plugin of COMMON_PLUGINS) {
            expect(typeof plugin).toBe("function");
        }
    });

    it("all entries in POPUP_EDITOR_PLUGINS are functions (plugin constructors)", () => {
        for (const plugin of POPUP_EDITOR_PLUGINS) {
            expect(typeof plugin).toBe("function");
        }
    });

    // The shape checks above are tautological for catching a *dropped* registration: because
    // COMMON_PLUGINS is built by spreading CORE_PLUGINS (and POPUP by spreading COMMON), removing
    // a plugin shrinks both lists and the superset loops still pass. These presence assertions pin
    // specific load-bearing plugins so deleting a registration line in plugins.ts turns the suite red.

    it("CORE_PLUGINS includes the Trilium-specific core plugins", () => {
        expect(CORE_PLUGINS).toContain(MentionCustomization);
        expect(CORE_PLUGINS).toContain(ReferenceLink);
    });

    it("COMMON_PLUGINS includes the in-tree Trilium feature plugins", () => {
        expect(COMMON_PLUGINS).toContain(CutToNotePlugin);
        expect(COMMON_PLUGINS).toContain(InternalLinkPlugin);
        expect(COMMON_PLUGINS).toContain(IncludeNote);
        expect(COMMON_PLUGINS).toContain(LinkEmbed);
        expect(COMMON_PLUGINS).toContain(Uploadfileplugin);
    });

    it("COMMON_PLUGINS includes the external widget plugins", () => {
        expect(COMMON_PLUGINS).toContain(Admonition);
    });

    it("POPUP_EDITOR_PLUGINS adds BlockToolbar on top of COMMON_PLUGINS", () => {
        expect(POPUP_EDITOR_PLUGINS).toContain(BlockToolbar);
        expect(COMMON_PLUGINS).not.toContain(BlockToolbar);
    });
});

describe("loadPremiumPlugins", () => {
    it("returns a non-empty array of plugin constructors", async () => {
        const plugins = await loadPremiumPlugins();
        expect(Array.isArray(plugins)).toBe(true);
        expect(plugins.length).toBeGreaterThan(0);
        for (const plugin of plugins) {
            expect(typeof plugin).toBe("function");
        }
    });

    it("includes SlashCommand, Template, and FormatPainter", async () => {
        const { SlashCommand, Template, FormatPainter } = await import("ckeditor5-premium-features");
        const plugins = await loadPremiumPlugins();
        expect(plugins).toContain(SlashCommand);
        expect(plugins).toContain(Template);
        expect(plugins).toContain(FormatPainter);
    });
});

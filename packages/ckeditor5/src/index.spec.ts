import { describe, expect, it } from "vitest";

// Import the aggregate module as a side-effect — this sets the global flag and registers
// everything, which is exactly what we want to exercise.
import "./index.js";
import { AttributeEditor, ClassicEditor, PopupEditor } from "./index.js";
import { CORE_PLUGINS, COMMON_PLUGINS, POPUP_EDITOR_PLUGINS } from "./plugins.js";

describe("index (aggregate entry point)", () => {
    it("sets the CKEditor distribution marker on the window object", () => {
        expect(window[Symbol.for("cke distribution")]).toBe("trilium");
    });

    it("AttributeEditor.builtinPlugins returns CORE_PLUGINS", () => {
        expect(AttributeEditor.builtinPlugins).toBe(CORE_PLUGINS);
    });

    it("ClassicEditor.builtinPlugins returns COMMON_PLUGINS", () => {
        expect(ClassicEditor.builtinPlugins).toBe(COMMON_PLUGINS);
    });

    it("PopupEditor.builtinPlugins returns POPUP_EDITOR_PLUGINS", () => {
        expect(PopupEditor.builtinPlugins).toBe(POPUP_EDITOR_PLUGINS);
    });

    it("AttributeEditor.builtinPlugins is a non-empty array", () => {
        const plugins = AttributeEditor.builtinPlugins;
        expect(Array.isArray(plugins)).toBe(true);
        expect(plugins.length).toBeGreaterThan(0);
    });

    it("ClassicEditor.builtinPlugins is a superset of AttributeEditor.builtinPlugins", () => {
        const corePlugins = AttributeEditor.builtinPlugins;
        const commonPlugins = ClassicEditor.builtinPlugins;
        for (const plugin of corePlugins) {
            expect(commonPlugins).toContain(plugin);
        }
    });

    it("PopupEditor.builtinPlugins is a superset of ClassicEditor.builtinPlugins", () => {
        const commonPlugins = ClassicEditor.builtinPlugins;
        const popupPlugins = PopupEditor.builtinPlugins;
        for (const plugin of commonPlugins) {
            expect(popupPlugins).toContain(plugin);
        }
    });
});

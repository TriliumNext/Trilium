import { afterEach, describe, expect, it, vi } from "vitest";

import { applyNotePreset, getNotePresetItems, notePresetOptions } from "./note_presets.js";
import server from "./server.js";

vi.mock("./i18n.js", () => ({
    t: (key: string) => key
}));

afterEach(() => {
    vi.restoreAllMocks();
});

const BACKEND_MIME = "application/javascript;env=backend";

describe("notePresetOptions", () => {
    it("gives each preset its language and an owned label, and a widget its skeleton", () => {
        expect(notePresetOptions(undefined)).toEqual({});
        expect(notePresetOptions("appCss")).toEqual({
            type: "code",
            mime: "text/css",
            content: "",
            attributes: [ { type: "label", name: "appCss", value: "" } ]
        });
        expect(notePresetOptions("backendScript")).toEqual({
            type: "code", mime: BACKEND_MIME, content: "", attributes: []
        });

        const widget = notePresetOptions("widget");
        expect(widget).toMatchObject({
            type: "code",
            mime: "text/jsx",
            attributes: [ { type: "label", name: "widget", value: "" } ]
        });
        expect(widget.content).toContain(`import { defineWidget } from "trilium:preact";`);
        expect(widget.content).toContain(`parent: "center-pane"`);
        expect(widget.content).toContain("<span>note_types.widget-preset-sample</span>");
    });
});

describe("getNotePresetItems", () => {
    it("offers one row per preset, carrying the command and what the row creates", () => {
        const row = (notePreset: string, title: string, uiIcon: string, mime: string) =>
            ({ title, uiIcon, command: "insertChildNote", type: "code", mime, notePreset });

        expect(getNotePresetItems("insertChildNote")).toEqual([
            row("appCss", "active_content_badges.type_app_css", "bx bxs-file-css", "text/css"),
            row("widget", "active_content_badges.type_widget", "bx bxs-widget", "text/jsx"),
            row("backendScript", "active_content_badges.type_backend_script", "bx bx-server",
                BACKEND_MIME)
        ]);
    });
});

describe("applyNotePreset", () => {
    it("switches the type, then writes the content and the label, if any", async () => {
        const put = vi.spyOn(server, "put").mockResolvedValue({});

        await applyNotePreset("someNote", "widget");
        expect(put.mock.calls.map(([ url ]) => url)).toEqual([
            "notes/someNote/type", "notes/someNote/data", "notes/someNote/set-attribute"
        ]);
        expect(put.mock.calls[0][1]).toEqual({ type: "code", mime: "text/jsx" });
        expect(put.mock.calls[1][1]).toEqual({ content: expect.stringContaining("defineWidget") });
        expect(put.mock.calls[2][1]).toMatchObject({ type: "label", name: "widget", value: "" });

        put.mockClear();
        await applyNotePreset("someNote", "backendScript");
        expect(put).toHaveBeenCalledExactlyOnceWith(
            "notes/someNote/type", { type: "code", mime: BACKEND_MIME });
    });
});

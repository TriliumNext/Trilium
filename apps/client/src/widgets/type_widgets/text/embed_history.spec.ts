import { AttributeEditor, EmbedHistory } from "@triliumnext/ckeditor5";
import { describe, expect, it, vi } from "vitest";

import EmbedHistories from "./embed_history";

describe("EmbedHistories", () => {
    it("gives one history to each note, attachment or inline source", () => {
        const histories = new EmbedHistories(() => null);
        const write = vi.fn();
        const source = {};

        const note = histories.get("note1", write);
        expect(histories.get("note1", vi.fn())).toBe(note);
        expect(note.write).toBe(write);
        expect(histories.get("note2", write)).not.toBe(note);
        expect(histories.get(source, write)).toBe(histories.get(source, vi.fn()));
        expect(histories.get(source, write)).not.toBe(note);
    });

    it("keeps the steps on the undo stack of the text editor, once there is one", async () => {
        let editor: AttributeEditor | null = null;
        const { host } = new EmbedHistories(() => editor).get("note1", vi.fn());
        const step = { undo: vi.fn(() => true), redo: vi.fn(() => true) };
        const listener = vi.fn();

        expect(host.push(step).isLatest()).toBe(false);
        host.undo();
        host.redo();
        expect(step.undo).not.toHaveBeenCalled();
        expect(host.isEnabled("undo")).toBe(false);
        host.subscribe(listener)();

        const element = document.createElement("div");
        document.body.append(element);
        editor = await AttributeEditor.create(element, {
            licenseKey: "GPL", extraPlugins: [ EmbedHistory ]
        });
        const unsubscribe = host.subscribe(listener);
        expect(host.push(step).isLatest()).toBe(true);
        expect(host.isEnabled("undo")).toBe(true);
        expect(listener).toHaveBeenCalled();
        host.undo();
        expect(step.undo).toHaveBeenCalledOnce();
        expect(host.isEnabled("redo")).toBe(true);
        unsubscribe();
        listener.mockClear();
        host.redo();
        expect(step.redo).toHaveBeenCalledOnce();
        expect(listener).not.toHaveBeenCalled();

        await editor.destroy();
        element.remove();
    });
});

import {
    _getModelData as getModelData,
    type ClassicEditor,
    Essentials,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import EmbedHistory, { type EmbedHistoryStep } from "./embed_history.js";

describe("EmbedHistory", () => {
    let editor: ClassicEditor;
    let history: EmbedHistory;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, EmbedHistory ]);
        history = editor.plugins.get(EmbedHistory);
        // Starts with an empty undo stack.
        editor.setData("<p></p>");
    });

    function createStep(isApplied = true) {
        return {
            undo: vi.fn<EmbedHistoryStep["undo"]>(() => isApplied),
            redo: vi.fn<EmbedHistoryStep["redo"]>(() => isApplied)
        };
    }

    function type(text: string) {
        editor.execute("insertText", { text });
    }

    function getText() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    it("keeps a step on the undo stack without changing the data", () => {
        editor.setData("<p>a</p>");
        const step = createStep();
        const onDataChange = vi.fn();
        editor.model.document.on("change:data", onDataChange);

        history.push(step);
        expect(editor.getData()).toBe("<p>a</p>");
        expect(onDataChange).not.toHaveBeenCalled();

        for (let i = 1; i <= 2; i++) {
            editor.execute("undo");
            expect(step.undo).toHaveBeenCalledTimes(i);
            editor.execute("redo");
            expect(step.redo).toHaveBeenCalledTimes(i);
        }
        expect(editor.getData()).toBe("<p>a</p>");
        expect(onDataChange).not.toHaveBeenCalled();
    });

    it("keeps the order of the steps and the typing around them", () => {
        const step = createStep();
        type("a");
        history.push(step);
        type("b");

        editor.execute("undo");
        expect(getText()).toBe("<paragraph>a</paragraph>");
        expect(step.undo).not.toHaveBeenCalled();
        editor.execute("undo");
        expect(step.undo).toHaveBeenCalledOnce();
        expect(getText()).toBe("<paragraph>a</paragraph>");
        editor.execute("undo");
        expect(getText()).toBe("<paragraph></paragraph>");

        editor.execute("redo");
        editor.execute("redo");
        expect(step.redo).toHaveBeenCalledOnce();
        editor.execute("redo");
        expect(getText()).toBe("<paragraph>ab</paragraph>");

        // A new step clears the redo stack.
        editor.execute("undo");
        history.push(createStep());
        expect(editor.commands.get("redo")?.isEnabled).toBe(false);
    });

    it("tells whether a step is still the last change of the undo stack", () => {
        const first = history.push(createStep());
        expect(first.isLatest()).toBe(true);
        type("a");
        expect(first.isLatest()).toBe(false);

        const second = history.push(createStep());
        editor.execute("undo");
        expect(second.isLatest()).toBe(false);

        const third = history.push(createStep());
        editor.setData("<p>b</p>");
        expect(third.isLatest()).toBe(false);
    });

    it("skips a step that no longer applies, on to the next change", () => {
        const step = createStep(false);
        type("a");
        history.push(step);

        editor.execute("undo");
        expect(step.undo).toHaveBeenCalledOnce();
        expect(getText()).toBe("<paragraph></paragraph>");

        editor.execute("redo");
        expect(getText()).toBe("<paragraph>a</paragraph>");
        editor.execute("redo");
        expect(step.redo).toHaveBeenCalledOnce();
        expect(editor.commands.get("redo")?.isEnabled).toBe(false);
    });

    it("focuses the text editor when an embed undoes or redoes a change of the text", () => {
        const focus = vi.spyOn(editor.editing.view, "focus");
        const step = createStep();
        type("a");
        history.push(step);

        history.undo();
        expect(step.undo).toHaveBeenCalledOnce();
        expect(focus).not.toHaveBeenCalled();
        history.undo();
        expect(getText()).toBe("<paragraph></paragraph>");
        expect(focus).toHaveBeenCalledOnce();
        // Nothing left to undo.
        history.undo();
        expect(focus).toHaveBeenCalledOnce();

        history.redo();
        expect(getText()).toBe("<paragraph>a</paragraph>");
        expect(focus).toHaveBeenCalledTimes(2);
        history.redo();
        expect(step.redo).toHaveBeenCalledOnce();
        expect(focus).toHaveBeenCalledTimes(2);
    });
});

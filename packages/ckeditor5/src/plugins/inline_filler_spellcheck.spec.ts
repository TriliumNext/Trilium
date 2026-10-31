import {
    _setModelData as setModelData, _VIEW_INLINE_FILLER as INLINE_FILLER, Bold, ClassicEditor, env,
    Essentials, Paragraph
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import InlineFillerSpellcheck from "./inline_filler_spellcheck.js";

describe("InlineFillerSpellcheck", () => {
    // The renderer checks the filler before it writes the new text, so the filler goes on the
    // render after the one that typed past it.
    it("removes the inline filler once text is typed after it", async () => {
        const editor = await createEditor();

        endBoldRun(editor);
        expect(paragraphText(editor)).toBe(`words${INLINE_FILLER}`);

        editor.execute("insertText", { text: " " });
        expect(paragraphText(editor)).toBe(`words${INLINE_FILLER} `);

        editor.execute("insertText", { text: "here" });
        expect(paragraphText(editor)).toBe("words here");
        expect(editor.getData()).toBe("<p><strong>words</strong> here</p>");
    });

    it("keeps the inline filler while nothing follows it", async () => {
        const editor = await createEditor();

        endBoldRun(editor);
        editor.editing.view.forceRender();
        expect(paragraphText(editor)).toBe(`words${INLINE_FILLER}`);
    });

    it("leaves the renderer's own behavior on Android", async () => {
        const { isAndroid } = env;
        Object.defineProperty(env, "isAndroid", { value: true });
        try {
            const editor = await createEditor();
            //@ts-expect-error: We are accessing a private field.
            const renderer = editor.editing.view._renderer;
            expect(Object.hasOwn(renderer, "_isSelectionInInlineFiller")).toBe(false);
        } finally {
            Object.defineProperty(env, "isAndroid", { value: isAndroid });
        }
    });
});

function createEditor() {
    return createTestEditor([Essentials, Paragraph, Bold, InlineFillerSpellcheck]);
}

/** Puts the caret after a bold word with Bold switched off, where the renderer adds the filler. */
function endBoldRun(editor: ClassicEditor) {
    editor.editing.view.focus();
    setModelData(editor.model, `<paragraph><$text bold="true">words</$text>[]</paragraph>`);
    editor.model.change((writer) => writer.removeSelectionAttribute("bold"));
}

function paragraphText(editor: ClassicEditor) {
    return editor.editing.view.getDomRoot()?.querySelector("p")?.textContent;
}

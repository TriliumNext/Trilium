import { Essentials, FindAndReplaceEditing, Paragraph } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import FindReveal from "./find_reveal.js";

describe("FindReveal", () => {
    it("follows the highlighted find result", async () => {
        const editor = await createTestEditor([
            Essentials, Paragraph, FindAndReplaceEditing, FindReveal
        ]);
        const findReveal = editor.plugins.get(FindReveal);
        editor.setData("<p>one needle</p><p>two needle</p>");

        editor.execute("find", "needle");
        expect(findReveal.position?.path).toEqual([ 0, 4 ]);

        editor.execute("findNext");
        expect(findReveal.position?.path).toEqual([ 1, 4 ]);

        editor.plugins.get(FindAndReplaceEditing).stop();
        expect(findReveal.position).toBeNull();
    });

    it("reveals a shown position while no result is highlighted", async () => {
        const editor = await createTestEditor([
            Essentials, Paragraph, FindAndReplaceEditing, FindReveal
        ]);
        const findReveal = editor.plugins.get(FindReveal);
        const state = editor.plugins.get(FindAndReplaceEditing).state;
        editor.setData("<p>one needle</p><p>two</p>");
        const root = editor.model.document.getRoot();
        if (!root || !state) throw new Error("The editor has no root or no find state.");
        const shown = editor.model.createPositionAt(root.getChild(1) ?? root, 0);

        findReveal.show(shown);
        expect(findReveal.position).toBe(shown);

        editor.execute("find", "needle");
        expect(findReveal.position?.path).toEqual([ 0, 4 ]);

        state.highlightedResult = null;
        expect(findReveal.position).toBe(shown);

        findReveal.show(null);
        expect(findReveal.position).toBeNull();
    });

    it("reveals only shown positions in an editor without the find plugin", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, FindReveal ]);
        const findReveal = editor.plugins.get(FindReveal);
        const root = editor.model.document.getRoot();
        if (!root) throw new Error("The editor has no root.");
        const shown = editor.model.createPositionAt(root, 0);

        expect(findReveal.position).toBeNull();
        findReveal.show(shown);
        expect(findReveal.position).toBe(shown);
    });
});

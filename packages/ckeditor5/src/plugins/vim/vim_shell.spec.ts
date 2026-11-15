import { Essentials, Paragraph } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumVim from "./vim.js";

/** The modules of this folder that the page has fetched so far. */
function getLoadedVimModules() {
    return performance.getEntriesByType("resource")
        .map(({ name }) => /\/plugins\/vim\/(vim[a-z_]*)\.ts/.exec(name)?.[1])
        .filter((name) => name !== undefined);
}

describe("TriliumVim", () => {
    it("loads the modules of Vim mode only once it is turned on", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, TriliumVim ]);
        expect(getLoadedVimModules()).toEqual([ "vim" ]);

        await editor.plugins.get(TriliumVim).setEnabled(true);
        expect(getLoadedVimModules()).toEqual(expect.arrayContaining([ "vim_session", "vim_adapter", "vim_commands" ]));
        expect(editor.plugins.get(TriliumVim).isActive).toBe(true);
    });
});

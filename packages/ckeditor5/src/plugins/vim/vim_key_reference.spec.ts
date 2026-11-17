import type { Editor } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createVimEditor, getStatus, paragraphs, press } from "../../../test/vim-kit.js";
import TriliumVim from "./vim.js";

/** The key list of `editor`, as `title: first hint, …` per section. */
function getReference(editor: Editor) {
    return editor.plugins.get(TriliumVim).getKeyReference().map(({ title, hints }) =>
        `${title}: ${hints.map(({ keys, description }) => `${keys.join(" ")} ${description}`)
            .join(", ")}`);
}

function getTitles(editor: Editor) {
    return editor.plugins.get(TriliumVim).getKeyReference().map(({ title }) => title);
}

describe("the full key list", () => {
    it("lists the keys of the state of the editor by topic", async () => {
        let areInsertKeysEnabled = false;
        const editor = await createVimEditor(paragraphs("[]ab"),
            { isInsertKeysEnabled: () => areInsertKeysEnabled });
        expect(getTitles(editor)).toEqual([
            "Moving", "Editing", "Typing", "Selecting", "Searching", "Sections and links",
            "Command line", "Available, but not guaranteed"
        ]);
        expect(getReference(editor)[1]).toContain(">> << indent, outdent this line");

        press(editor, "d");
        expect(getReference(editor)).toEqual([
            "Keys that can follow: d this line, w to next word, $ to line end, i inside…, "
            + "a around…, Esc cancel"
        ]);
        press(editor, "<Esc>g");
        const [ following ] = editor.plugins.get(TriliumVim).getKeyReference();
        expect(following.hints).toHaveLength(11);
        expect(following.hints.at(-1)?.description).toBe("cancel");

        press(editor, "<Esc>v");
        expect(getTitles(editor)).toEqual([ "Acting on the selection", "Extending the selection" ]);

        press(editor, "<Esc>i");
        expect(getTitles(editor)).toEqual([ "Insert mode keys" ]);
        areInsertKeysEnabled = true;
        expect(getTitles(editor)).toEqual([ "Insert mode keys", "With Vim keys in Insert mode" ]);

        press(editor, "<Esc>:");
        expect(getTitles(editor)).toEqual(
            [ "Prompt keys", "Commands", "Available, but not guaranteed" ]);
        const [ , commands, others ] = editor.plugins.get(TriliumVim).getKeyReference();
        expect(commands.hints[0]).toMatchObject(
            { keys: [ "s[ubstitute]" ], isLiteral: true, description: "replace text in lines" });
        expect(others.hints.map(({ keys }) => keys[0])).toContain("g[lobal]");
        expect(commands.hints.map(({ keys }) => keys[0])).not.toContain("g[lobal]");

        press(editor, "<Esc>/");
        expect(getReference(editor)[0]).toMatch(/^Prompt keys: Enter go to the match/u);
        press(editor, "<Esc>");

        press(editor, ":s/a/b/c<CR>");
        expect(getReference(editor)).toEqual([
            "Prompt keys: y replace, n skip, a all the rest, q stop here, l this one, then stop"
        ]);
        press(editor, "q");

        await editor.plugins.get(TriliumVim).setEnabled(false);
        expect(editor.plugins.get(TriliumVim).getKeyReference()).toEqual([]);
    });

    it("lets Esc close the open key list before anything else", async () => {
        let isOpen = true;
        const closeKeyReference = vi.fn(() => {
            const wasOpen = isOpen;
            isOpen = false;
            return wasOpen;
        });
        const editor = await createVimEditor(paragraphs("[]ab"), { host: { closeKeyReference } });
        press(editor, "d<Esc>");
        expect(closeKeyReference).toHaveBeenCalledTimes(1);
        expect(getStatus(editor).pendingKeys).toBe("d");
        press(editor, "<Esc>");
        expect(getStatus(editor).pendingKeys).toBe("");
    });
});

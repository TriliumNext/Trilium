import { ContextualBalloon, type ClassicEditor, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor, installLinkEmbedComponentMock, LINK_EMBED_TEST_PLUGINS } from "../../../test/link-embed-kit.js";
import { LINK_EMBED_COMMAND } from "./link_embed_commands.js";
import LinkEmbedFormView from "./link_embed_form.js";

describe("LinkEmbedUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        installLinkEmbedComponentMock();
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS);
    });

    it("binds the button to the insert command and opens the balloon form on click", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const view = editor.ui.componentFactory.create("linkEmbed") as unknown as {
            isEnabled: boolean;
            fire(name: string): void;
        };
        const command = editor.commands.get(LINK_EMBED_COMMAND);
        expect(view.isEnabled).toBe(command?.isEnabled);

        const balloon = editor.plugins.get(ContextualBalloon);
        expect(balloon.visibleView).toBeNull();

        // The insert flow now happens in the editor's own balloon, not in a Trilium modal.
        view.fire("execute");
        expect(balloon.visibleView).toBeInstanceOf(LinkEmbedFormView);
    });
});

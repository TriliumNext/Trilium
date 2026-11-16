import {
    _setModelData as setModelData, ContextualBalloon, Essentials, Link, type ModelElement,
    Paragraph, type ToolbarView, View
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { createLinkEmbedHost } from "../../test/link-embed-kit.js";
import Aside from "./aside/aside.js";
import KeepBalloonPositions from "./keep_balloon_positions.js";
import LinkEmbed from "./link_embed/link_embed.js";
import LinkEmbedToolbar from "./link_embed/link_embed_toolbar.js";
import Multicolumn from "./multicolumn/multicolumn.js";

describe("KeepBalloonPositions", () => {
    it("ignores a position without a target", async () => {
        const editor = await createTestEditor([ Paragraph, KeepBalloonPositions ]);
        const balloon = editor.plugins.get(ContextualBalloon);
        const target = editor.editing.view.getDomRoot();
        const view = new View();
        view.setTemplate({ tag: "div" });
        balloon.add({ view, position: { target } });

        balloon.updatePosition({ target: undefined });
        balloon.updatePosition();
        expect(balloon.getPositionOptions()?.target).toBe(target);

        balloon.updatePosition({ target: document.body });
        expect(balloon.getPositionOptions()?.target).toBe(document.body);
    });

    it("moves the selection out of a link preview in an aside in a column", async () => {
        // The link preview toolbar registers before the aside toolbar, as in `plugins.ts`.
        const editor = await createTestEditor([
            Essentials, Paragraph, Link, Multicolumn, LinkEmbed, LinkEmbedToolbar, Aside,
            KeepBalloonPositions
        ], { linkEmbed: createLinkEmbedHost() });
        editor.ui.focusTracker.isFocused = true;
        setModelData(editor.model, "<multicolumnLayout columnRatios=\"1-1\">"
            + "<multicolumnColumn><paragraph>a[]</paragraph>"
            + "<asideBlock position=\"wrap-right\"><asideContent><paragraph>"
            + "b<linkMention url=\"https://e.com/\" title=\"T\"></linkMention>"
            + "</paragraph></asideContent></asideBlock></multicolumnColumn>"
            + "<multicolumnColumn><paragraph>c</paragraph></multicolumnColumn>"
            + "</multicolumnLayout>");
        const root = editor.model.document.getRoot() as ModelElement;
        const column = root.getNodeByPath([ 0, 0 ]) as ModelElement;
        const asideParagraph = root.getNodeByPath([ 0, 0, 1, 0, 0 ]) as ModelElement;
        const mention = root.getNodeByPath([ 0, 0, 1, 0, 0, 1 ]) as ModelElement;
        const balloon = editor.plugins.get(ContextualBalloon);

        editor.model.change((writer) => writer.setSelection(asideParagraph, 0));
        editor.model.change((writer) => writer.setSelection(mention, "on"));
        expect(balloon.view.class).toContain("link-embed-toolbar");

        const columnParagraph = column.getChild(0) as ModelElement;
        expect(() => editor.model.change((writer) => writer.setSelection(columnParagraph, 1)))
            .not.toThrow();
        expect((balloon.visibleView as ToolbarView).ariaLabel).toBe("Multicolumn layout toolbar");
    });
});

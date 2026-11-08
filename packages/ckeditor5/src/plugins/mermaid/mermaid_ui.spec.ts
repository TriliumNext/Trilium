import { NEW_MERMAID_CONTENT } from "@triliumnext/commons";
import {
    ButtonView,
    ClassicEditor,
    DropdownView,
    Essentials,
    type ListItemView,
    Paragraph,
    _setModelData as setModelData,
    SplitButtonView,
    Widget
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import ContentEmbed from "../content_embed/content_embed.js";
import Mermaid from "./mermaid.js";

const SAMPLES = [
    { name: "Flowchart", content: "graph LR; A --> B" },
    { name: "Pie", content: "pie title Pets" }
];

describe("MermaidUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, Widget, ContentEmbed, Mermaid ], {
            contentEmbed: { inlineLanguages: [ "mermaid" ] },
            mermaid: { samples: SAMPLES }
        });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    });

    function createDropdown() {
        const dropdown = editor.ui.componentFactory.create("mermaid");
        if (!(dropdown instanceof DropdownView)) throw new Error("Expected a dropdown.");
        dropdown.render();
        return dropdown;
    }

    function getSampleButtons(dropdown: DropdownView) {
        dropdown.isOpen = true;
        return Array.from(dropdown.listView?.items ?? [])
            .map((item) => (item as ListItemView).children.first)
            .filter((button): button is ButtonView => button instanceof ButtonView);
    }

    function getInsertedDiagram() {
        const embed = editor.model.document.selection.getSelectedElement();
        expect(embed?.getAttribute("language")).toBe("mermaid");
        return embed?.getAttribute("source");
    }

    it("inserts a new diagram from the main action, and a template from the list", () => {
        const dropdown = createDropdown();
        const button = dropdown.buttonView;
        expect(button).toBeInstanceOf(SplitButtonView);
        expect(button.label).toBe("Mermaid diagram");

        button.fire("execute");
        expect(getInsertedDiagram()).toBe(NEW_MERMAID_CONTENT);

        const samples = getSampleButtons(dropdown);
        expect(samples.map(({ label }) => label)).toEqual([ "Flowchart", "Pie" ]);
        samples[1]?.fire("execute");
        expect(getInsertedDiagram()).toBe("pie title Pets");
    });

    it("is disabled while a diagram cannot be inserted", () => {
        const dropdown = createDropdown();
        expect(dropdown.isEnabled).toBe(true);

        editor.enableReadOnlyMode("spec");
        expect(dropdown.isEnabled).toBe(false);
        expect(dropdown.buttonView.isEnabled).toBe(false);
    });

    it("lists no templates without any, and stays enabled without the embed command", async () => {
        const bare = await createTestEditor([ Essentials, Paragraph, Mermaid ]);
        const dropdown = bare.ui.componentFactory.create("mermaid");
        if (!(dropdown instanceof DropdownView)) throw new Error("Expected a dropdown.");
        dropdown.render();
        dropdown.isOpen = true;

        expect(dropdown.listView?.items.length).toBe(0);
        expect(dropdown.isEnabled).toBe(true);
    });
});

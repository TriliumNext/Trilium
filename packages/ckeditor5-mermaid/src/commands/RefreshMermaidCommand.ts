import { checkIsOn } from "../utils.js";
import { Command, ModelElement } from "ckeditor5";

export default class RefreshMermaidCommand extends Command {

    override refresh() {
        const editor = this.editor;
        const documentSelection = editor.model.document.selection;
        const selectedElement = documentSelection.getSelectedElement();
        const isSelectedElementMermaid = selectedElement && selectedElement.name === "mermaid";

        if (isSelectedElementMermaid || documentSelection.getLastPosition()?.findAncestor("mermaid")) {
            this.isEnabled = !!selectedElement;
        } else {
            this.isEnabled = false;
        }

        this.value = checkIsOn(editor, "refresh");
    }

    override execute() {
        const editor = this.editor;
        const model = editor.model;
        const documentSelection = editor.model.document.selection;
        const mermaidItem = (documentSelection.getSelectedElement()
            || documentSelection.getLastPosition()?.parent) as ModelElement;

        if (!mermaidItem) return;

        const source = mermaidItem.getAttribute("source") as string;

        model.change(writer => {
            writer.setAttribute("source", source + " ", mermaidItem);
        });

        model.change(writer => {
            writer.setAttribute("source", source.trimEnd(), mermaidItem);
        });
    }
}

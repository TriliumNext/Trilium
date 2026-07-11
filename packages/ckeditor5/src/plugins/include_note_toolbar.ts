import { Plugin, WidgetToolbarRepository, isWidget, type ViewElement } from "ckeditor5";
import IncludeNote from "./includenote.js";
import IncludeNoteBoxSizeDropdown from "./include_note_box_size_dropdown.js";

export default class IncludeNoteToolbar extends Plugin {

    static get requires() {
        return [WidgetToolbarRepository, IncludeNote, IncludeNoteBoxSizeDropdown] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("includeNote", {
            items: [
                "includeNoteBoxSizeDropdown"
            ],
            balloonClassName: "ck-toolbar-container include-note-toolbar",
            getRelatedElement(selection) {
                const selectedElement = selection.getSelectedElement();

                if (selectedElement && isIncludeNoteWidget(selectedElement)) {
                    return selectedElement;
                }

                return null;
            }
        });
    }

}

function isIncludeNoteWidget(element: ViewElement): boolean {
    if (!isWidget(element)) {
        return false;
    }

    if (!element.is("element", "section")) {
        return false;
    }

    /* v8 ignore next -- isWidget() only matches toWidget()-wrapped elements, which always carry the ck-widget class, so getAttribute("class") is never falsy here */
    const classes = element.getAttribute("class") || "";
    return typeof classes === "string" && classes.includes("include-note");
}

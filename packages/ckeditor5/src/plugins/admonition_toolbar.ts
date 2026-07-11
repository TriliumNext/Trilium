import { Plugin, ViewDocumentFragment, WidgetToolbarRepository, type ViewNode } from "ckeditor5";
import { Admonition } from "@triliumnext/ckeditor5-admonition";
import AdmonitionTypeDropdown from "./admonition_type_dropdown";

export default class AdmonitionToolbar extends Plugin {

    static get requires() {
        return [WidgetToolbarRepository, Admonition, AdmonitionTypeDropdown] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("admonition", {
            items: [
                "admonitionTypeDropdown"
            ],
            balloonClassName: "ck-toolbar-container admonition-type-list",
            getRelatedElement(selection) {
                const selectionPosition = selection.getFirstPosition();
                if (!selectionPosition) {
                    return null;
                }

                let parent: ViewNode | ViewDocumentFragment | null = selectionPosition.parent;
                while (parent) {
                    if (parent.is("element", "aside") || parent.is("element", "div")) {
                        // Check if it's an admonition by looking for the admonition class
                        const classes = (parent as any).getAttribute?.("class") || "";
                        if (typeof classes === "string" && classes.includes("admonition")) {
                            return parent;
                        }
                    }
                    parent = parent.parent;
                }

                return null;
            }
        });
    }

}

/**
 * Derived from `BlockQuoteEditing` in `@ckeditor/ckeditor5-block-quote`.
 * Copyright (c) 2003-2026, CKSource Holding sp. z o.o. All rights reserved.
 * Used under the GPL-2.0-or-later arm of CKEditor 5's dual license; see
 * https://ckeditor.com/legal/ckeditor-licensing-options.
 *
 * Modified by the Trilium Notes contributors: the schema registers `<aside>` with an
 * `admonitionType` attribute, and the plain `elementToElement` conversion is replaced by an upcast
 * that reads the type from the element's class list and a downcast that writes
 * `class="admonition <type>"`. Upstream's post-fixer and Enter/Backspace break-out handlers are
 * kept, minus one branch that is unreachable here (see the comment on the post-fixer).
 */

import { Delete, Enter, Plugin, ViewDocumentDeleteEvent, ViewDocumentEnterEvent } from "ckeditor5";

import AdmonitionCommand, { ADMONITION_TYPE_ATTRIBUTE, ADMONITION_TYPE_NAMES, AdmonitionType, DEFAULT_ADMONITION_TYPE } from "./admonition_command.js";

/**
 * The admonition editing feature.
 *
 * Introduces the `'admonition'` command and the `'aside'` model element.
 */
export default class AdmonitionEditing extends Plugin {

    /**
     * @inheritDoc
     */
    public static get pluginName() {
        return "AdmonitionEditing" as const;
    }

    /**
     * @inheritDoc
     */
    public static get requires() {
        return [Enter, Delete] as const;
    }

    /**
     * @inheritDoc
     */
    public init(): void {
        const editor = this.editor;
        const schema = editor.model.schema;

        const admonitionCommand = new AdmonitionCommand(editor);
        editor.commands.add("admonition", admonitionCommand);

        schema.register("aside", {
            inheritAllFrom: "$container",
            allowAttributes: ADMONITION_TYPE_ATTRIBUTE
        });

        editor.conversion.for("upcast").elementToElement({
            view: {
                name: "aside",
                classes: "admonition"
            },
            model: (viewElement, { writer }) => {
                let type: AdmonitionType = DEFAULT_ADMONITION_TYPE;
                for (const className of viewElement.getClassNames()) {
                    if (className !== "admonition" && (ADMONITION_TYPE_NAMES as readonly string[]).includes(className)) {
                        type = className as AdmonitionType;
                    }
                }

                const attributes: Record<string, unknown> = {};
                attributes[ADMONITION_TYPE_ATTRIBUTE] = type;
                return writer.createElement("aside", attributes);
            }
        });

        editor.conversion.for("downcast")
            .elementToElement({
                model: "aside",
                view: "aside"
            })
            .attributeToAttribute({
                model: ADMONITION_TYPE_ATTRIBUTE,
                view: (value) => ({
                    key: "class",
                    value: ["admonition", value as string]
                })
            });

        // Postfixer which cleans incorrect model states connected with admonitions.
        editor.model.document.registerPostFixer((writer) => {
            const changes = editor.model.document.differ.getChanges();

            for (const entry of changes) {
                if (entry.type == "insert") {
                    const element = entry.position.nodeAfter;

                    if (!element) {
                        // We are inside a text node.
                        continue;
                    }

                    if (element.is("element", "aside") && element.isEmpty) {
                        // Added an empty aside - remove it.
                        writer.remove(element);

                        return true;
                    } else if (element.is("element")) {
                        // Just added an element. Check that all children meet the scheme rules.
                        //
                        // Upstream's block-quote post-fixer also checks the inserted element itself
                        // against the schema here. That case is unreachable: `writer.insert()` and
                        // `writer.move()` both normalise an <aside> out of a parent that does not
                        // allow it, so the differ never reports one at an illegal position. A
                        // misplaced <aside> only ever arrives nested inside some other inserted
                        // element, which the scan below handles.
                        const range = writer.createRangeIn(element);

                        for (const child of range.getItems()) {
                            if (
                                child.is("element", "aside") &&
                                !schema.checkChild(writer.createPositionBefore(child), child)
                            ) {
                                writer.unwrap(child);

                                return true;
                            }
                        }
                    }
                } else if (entry.type == "remove") {
                    const parent = entry.position.parent;

                    if (parent.is("element", "aside") && parent.isEmpty) {
                        // Something got removed and now aside is empty. Remove the aside as well.
                        writer.remove(parent);

                        return true;
                    }
                }
            }

            return false;
        });

        const viewDocument = this.editor.editing.view.document;
        const selection = editor.model.document.selection;

        // Overwrite default Enter key behavior.
        // If Enter key is pressed with selection collapsed in an empty block inside an admonition,
        // break out of the admonition.
        this.listenTo<ViewDocumentEnterEvent>(viewDocument, "enter", (evt, data) => {
            if (!selection.isCollapsed || !admonitionCommand.value) {
                return;
            }

            const positionParent = selection.getLastPosition()?.parent;

            if (positionParent?.isEmpty) {
                editor.execute("admonition");
                editor.editing.view.scrollToTheSelection();

                data.preventDefault();
                evt.stop();
            }
        }, { context: "aside" });

        // Overwrite default Backspace key behavior.
        // If Backspace key is pressed with selection collapsed in the first empty block inside an
        // admonition, break out of the admonition.
        this.listenTo<ViewDocumentDeleteEvent>(viewDocument, "delete", (evt, data) => {
            if (data.direction != "backward" || !selection.isCollapsed || !admonitionCommand.value) {
                return;
            }

            const positionParent = selection.getLastPosition()?.parent;

            if (positionParent?.isEmpty && !positionParent.previousSibling) {
                editor.execute("admonition");
                editor.editing.view.scrollToTheSelection();

                data.preventDefault();
                evt.stop();
            }
        }, { context: "aside" });
    }

}

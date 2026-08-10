import { Autoformat, type Batch, ModelElement, type ModelRootElement, type ModelWriter, Plugin, viewToModelPositionOutsideModelElement, Widget } from "ckeditor5";

import { addFootnoteAutoformatting } from "./auto_formatting.js";
import { ATTRIBUTES, COMMANDS, ELEMENTS } from "./constants.js";
import { defineConverters } from "./converters.js";
import InsertFootnoteCommand from "./insert_footnote_command.js";
import { defineSchema } from "./schema.js";
import { modelQueryElement, modelQueryElementsAll } from "./utils.js";

/**
 * Owns the footnote model: schema, conversion, the insert command, and the bookkeeping that keeps
 * footnote items and their inline references numbered consistently as the document changes.
 */
export default class FootnoteEditing extends Plugin {

    public static get pluginName() {
        return "FootnotesEditing" as const;
    }

    public static get requires() {
        return [Widget, Autoformat] as const;
    }

    /**
     * The root element of the document.
     */
    public get rootElement(): ModelRootElement {
        const rootElement = this.editor.model.document.getRoot();
        if (!rootElement) {
            throw new Error("Document has no rootElement element.");
        }
        return rootElement;
    }

    public init(): void {
        defineSchema(this.editor.model.schema);
        defineConverters(this.editor);

        this.editor.commands.add(COMMANDS.insertFootnote, new InsertFootnoteCommand(this.editor));

        addFootnoteAutoformatting(this.editor, this.rootElement);

        this.editor.model.document.on("change:data", (_evt, batch) => {
            const differ = this.editor.model.document.differ;
            const diffItems = [...differ.getChanges()];

            // If a footnote reference is inserted, ensure that footnote references remain ordered.
            if (diffItems.some((diffItem) => diffItem.type === "insert" && diffItem.name === ELEMENTS.footnoteReference)) {
                this._orderFootnotes(batch);
            }

            // For each change to a footnote item's index attribute, update the matching references.
            diffItems.forEach((diffItem) => {
                if (diffItem.type !== "attribute" || diffItem.attributeKey !== ATTRIBUTES.footnoteIndex) {
                    return;
                }

                const { attributeNewValue: newFootnoteIndex } = diffItem;
                const footnote = [...diffItem.range.getItems()].find((item) => item.is("element", ELEMENTS.footnoteItem));
                const footnoteId = footnote instanceof ModelElement && footnote.getAttribute(ATTRIBUTES.footnoteId);
                if (!footnoteId) {
                    return;
                }

                this._updateReferenceIndices(batch, `${footnoteId}`, `${newFootnoteIndex}`);
            });
        }, { priority: "high" });

        this._handleDelete();

        // The following callback is needed to map nonempty view elements to empty model elements.
        // See https://ckeditor.com/docs/ckeditor5/latest/api/module_widget_utils.html#function-viewToModelPositionOutsideModelElement
        this.editor.editing.mapper.on(
            "viewToModelPosition",
            viewToModelPositionOutsideModelElement(this.editor.model, (viewElement) =>
                viewElement.hasAttribute(ATTRIBUTES.footnoteReference)
            )
        );
    }

    /**
     * Deals with deletion of text and elements, and updating the model accordingly. In particular:
     * 1. If the footnote section gets deleted, all footnote references are removed.
     * 2. If a delete operation happens in an empty footnote, the footnote is deleted.
     */
    private _handleDelete() {
        const viewDocument = this.editor.editing.view.document;
        const editor = this.editor;

        this.listenTo(viewDocument, "delete", (evt, data) => {
            const doc = editor.model.document;
            const deletedElement = doc.selection.getSelectedElement();
            const selectionEndPos = doc.selection.getLastPosition();
            const selectionStartPos = doc.selection.getFirstPosition();
            if (!selectionEndPos || !selectionStartPos) {
                throw new Error("Selection must have at least one range to perform delete operation.");
            }

            this.editor.model.change((modelWriter) => {
                // Delete all footnote references if the footnote section gets deleted.
                if (deletedElement && deletedElement.is("element", ELEMENTS.footnoteSection)) {
                    this._removeReferences(modelWriter);
                }

                const deletingFootnote = Boolean(deletedElement && deletedElement.is("element", ELEMENTS.footnoteItem));

                const currentFootnote = deletingFootnote && deletedElement ?
                    deletedElement :
                    selectionEndPos.findAncestor(ELEMENTS.footnoteItem);
                if (!currentFootnote) {
                    return;
                }

                const endParagraph = selectionEndPos.findAncestor("paragraph");
                const startParagraph = selectionStartPos.findAncestor("paragraph");
                const currentFootnoteContent = selectionEndPos.findAncestor(ELEMENTS.footnoteContent);
                if (!currentFootnoteContent || !startParagraph || !endParagraph) {
                    return;
                }

                const footnoteIsEmpty = startParagraph.maxOffset === 0 && currentFootnoteContent.childCount === 1;

                if (deletingFootnote || footnoteIsEmpty) {
                    this._removeFootnote(modelWriter, currentFootnote);
                    data.preventDefault();
                    evt.stop();
                }
            });
        }, { priority: "high" });
    }

    /**
     * Removes a footnote and its references, and renumbers subsequent footnotes. When a footnote's
     * id attribute changes, its references automatically update from a dispatcher event in
     * converters.ts, which triggers `_updateReferenceIndices`. `modelWriter` is passed in to batch
     * these changes with the ones that instantiated them, so the set undoes as a single action.
     */
    private _removeFootnote(modelWriter: ModelWriter, footnote: ModelElement) {
        const footnoteSection = footnote.findAncestor(ELEMENTS.footnoteSection);

        /* v8 ignore next 4 -- defensive: the schema only allows a footnote item inside a section,
           so a sectionless footnote cannot be reached through the editor */
        if (!footnoteSection) {
            modelWriter.remove(footnote);
            return;
        }

        /* v8 ignore next -- defensive: findAncestor() returned this section, so the footnote is
           one of its children */
        const index = footnoteSection.getChildIndex(footnote) ?? 0;

        const id = footnote.getAttribute(ATTRIBUTES.footnoteId);
        this._removeReferences(modelWriter, `${id}`);

        modelWriter.remove(footnote);

        // If no footnotes remain, remove the footnote section.
        if (footnoteSection.childCount === 0) {
            modelWriter.remove(footnoteSection);
            this._removeReferences(modelWriter);
        } else {
            // After footnote deletion the selection winds up surrounding the previous footnote (or
            // the following one if no previous footnote exists). Typing in that state immediately
            // deletes the footnote, so the selection is deliberately moved to avoid that.
            // The section is non-empty, so this child always exists: either the footnote that
            // shifted into the removed one's slot, or the one before it.
            const neighborFootnote = footnoteSection.getChild(index === 0 ? index : index - 1);

            /* v8 ignore next -- defensive: the branch above guarantees a remaining sibling */
            if (neighborFootnote instanceof ModelElement) {
                const neighborEndParagraph = modelQueryElementsAll(this.editor, neighborFootnote, (element) =>
                    element.is("element", "paragraph")
                ).pop();

                if (neighborEndParagraph) {
                    modelWriter.setSelection(neighborEndParagraph, "end");
                }
            }
        }

        // Renumber subsequent footnotes.
        const subsequentFootnotes = [...footnoteSection.getChildren()].slice(index);
        for (const [i, child] of subsequentFootnotes.entries()) {
            modelWriter.setAttribute(ATTRIBUTES.footnoteIndex, `${index + i + 1}`, child);
        }
    }

    /**
     * Deletes all references to the footnote with the given id. If no id is provided, all
     * references are deleted. `modelWriter` is passed in to batch these changes with the ones that
     * instantiated them, so the set undoes as a single action.
     */
    private _removeReferences(modelWriter: ModelWriter, footnoteId: string | undefined = undefined) {
        const footnoteReferences = modelQueryElementsAll(this.editor, this.rootElement, (element) =>
            element.is("element", ELEMENTS.footnoteReference)
        );

        for (const footnoteReference of footnoteReferences) {
            const id = footnoteReference.getAttribute(ATTRIBUTES.footnoteId);
            if (!footnoteId || id === footnoteId) {
                modelWriter.remove(footnoteReference);
            }
        }
    }

    /**
     * Updates all references for a single footnote. Called when the index attribute of an existing
     * footnote changes, which happens when a footnote with a lower index is deleted. `batch` is
     * passed in to group these changes with the ones that instantiated them.
     */
    private _updateReferenceIndices(batch: Batch, footnoteId: string, newFootnoteIndex: string) {
        const footnoteReferences = modelQueryElementsAll(
            this.editor,
            this.rootElement,
            (element) => element.is("element", ELEMENTS.footnoteReference) &&
                element.getAttribute(ATTRIBUTES.footnoteId) === footnoteId
        );

        this.editor.model.enqueueChange(batch, (writer) => {
            footnoteReferences.forEach((footnoteReference) => {
                writer.setAttribute(ATTRIBUTES.footnoteIndex, newFootnoteIndex, footnoteReference);
            });
        });
    }

    /**
     * Reindexes footnotes such that footnote references occur in order, and reorders footnote items
     * in the footer section accordingly. `batch` is passed in to group changes with the ones that
     * instantiated them.
     */
    private _orderFootnotes(batch: Batch) {
        const footnoteReferences = modelQueryElementsAll(this.editor, this.rootElement, (element) =>
            element.is("element", ELEMENTS.footnoteReference)
        );
        const uniqueIds = new Set(footnoteReferences.map((element) => element.getAttribute(ATTRIBUTES.footnoteId)));
        const orderedFootnotes = [...uniqueIds].map((id) =>
            modelQueryElement(
                this.editor,
                this.rootElement,
                (element) => element.is("element", ELEMENTS.footnoteItem) &&
                    element.getAttribute(ATTRIBUTES.footnoteId) === id
            )
        );

        this.editor.model.enqueueChange(batch, (writer) => {
            const footnoteSection = modelQueryElement(this.editor, this.rootElement, (element) =>
                element.is("element", ELEMENTS.footnoteSection)
            );
            /* v8 ignore next 3 -- defensive: this only runs after a reference was inserted,
               which implies the section exists */
            if (!footnoteSection) {
                return;
            }

            /**
             * In order to keep footnotes with no existing references at the end of the list, the
             * loop below reverses the list of footnotes with references and inserts each at the
             * beginning.
             */
            for (const footnote of orderedFootnotes.reverse()) {
                if (footnote) {
                    writer.move(writer.createRangeOn(footnote), footnoteSection, 0);
                }
            }

            // Once the list is sorted, make one final pass to update footnote indices.
            for (const footnote of modelQueryElementsAll(this.editor, footnoteSection, (element) =>
                element.is("element", ELEMENTS.footnoteItem)
            )) {
                /* v8 ignore next -- defensive: the footnote was just queried out of this section */
                const index = `${(footnoteSection.getChildIndex(footnote) ?? -1) + 1}`;
                writer.setAttribute(ATTRIBUTES.footnoteIndex, index, footnote);

                const id = footnote.getAttribute(ATTRIBUTES.footnoteId);

                /**
                 * Unfortunately the following call seems to be necessary, even though
                 * `_updateReferenceIndices` should fire from the attribute change immediately
                 * above: events initiated by a `change:data` event do not themselves fire another
                 * `change:data` event.
                 */
                /* v8 ignore next -- defensive: an item without an id cannot be downcast, so it
                   never reaches the document */
                if (id) {
                    this._updateReferenceIndices(batch, `${id}`, index);
                }
            }
        });
    }

}

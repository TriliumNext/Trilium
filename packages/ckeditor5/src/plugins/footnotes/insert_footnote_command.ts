import { Command, type ModelElement, type ModelRootElement, type ModelWriter } from "ckeditor5";

import { ATTRIBUTES, ELEMENTS } from "./constants.js";
import { modelQueryElement } from "./utils.js";

/**
 * Inserts a footnote reference at the selection, creating the footnote item (and the footnote
 * section that holds it) when the reference is a new one.
 */
export default class InsertFootnoteCommand extends Command {

    /**
     * Creates a footnote reference with the given index, and creates a matching footnote if one
     * doesn't already exist. Also creates the footnote section if it doesn't exist. If
     * `footnoteIndex` is 0 (or not provided), the added footnote is given the next unused index —
     * e.g. 7, if 6 footnotes exist so far.
     */
    public override execute({ footnoteIndex }: { footnoteIndex?: number } = { footnoteIndex: 0 }): void {
        this.editor.model.enqueueChange((modelWriter) => {
            const doc = this.editor.model.document;
            const rootElement = doc.getRoot();
            if (!rootElement) {
                return;
            }

            const footnoteSection = this._getFootnoteSection(modelWriter, rootElement);
            let index: string;
            let id: string | undefined;

            if (footnoteIndex === 0) {
                index = `${footnoteSection.maxOffset + 1}`;
                id = newFootnoteId();
            } else {
                index = `${footnoteIndex}`;
                const matchingFootnote = modelQueryElement(
                    this.editor,
                    footnoteSection,
                    (element) => element.is("element", ELEMENTS.footnoteItem) &&
                        element.getAttribute(ATTRIBUTES.footnoteIndex) === index
                );
                if (matchingFootnote) {
                    id = matchingFootnote.getAttribute(ATTRIBUTES.footnoteId) as string;
                }
            }

            if (!id) {
                return;
            }

            modelWriter.setSelection(doc.selection.getLastPosition());
            const footnoteReference = modelWriter.createElement(ELEMENTS.footnoteReference, {
                [ATTRIBUTES.footnoteId]: id,
                [ATTRIBUTES.footnoteIndex]: index
            });
            this.editor.model.insertContent(footnoteReference);
            modelWriter.setSelection(footnoteReference, "after");

            // If referencing an existing footnote, the item below already exists.
            if (footnoteIndex !== 0) {
                return;
            }

            const footnoteContent = modelWriter.createElement(ELEMENTS.footnoteContent);
            const footnoteItem = modelWriter.createElement(ELEMENTS.footnoteItem, {
                [ATTRIBUTES.footnoteId]: id,
                [ATTRIBUTES.footnoteIndex]: index
            });
            const footnoteBackLink = modelWriter.createElement(ELEMENTS.footnoteBackLink, {
                [ATTRIBUTES.footnoteId]: id
            });
            const paragraph = modelWriter.createElement("paragraph");
            modelWriter.append(paragraph, footnoteContent);
            modelWriter.append(footnoteContent, footnoteItem);
            modelWriter.insert(footnoteBackLink, footnoteItem, 0);

            this.editor.model.insertContent(
                footnoteItem,
                modelWriter.createPositionAt(footnoteSection, footnoteSection.maxOffset)
            );
        });
    }

    /**
     * Called automatically when changes are applied to the document. Sets `isEnabled` to determine
     * whether footnote creation is allowed at the current location.
     */
    public override refresh(): void {
        const model = this.editor.model;
        const lastPosition = model.document.selection.getLastPosition();
        const allowedIn = lastPosition && model.schema.findAllowedParent(lastPosition, ELEMENTS.footnoteReference);
        this.isEnabled = allowedIn !== null;
    }

    /**
     * Returns the footnote section if it exists, or creates one if it doesn't.
     */
    private _getFootnoteSection(writer: ModelWriter, rootElement: ModelRootElement): ModelElement {
        const footnoteSection = modelQueryElement(this.editor, rootElement, (element) =>
            element.is("element", ELEMENTS.footnoteSection)
        );
        if (footnoteSection) {
            return footnoteSection;
        }

        const newFootnoteSection = writer.createElement(ELEMENTS.footnoteSection);
        this.editor.model.insertContent(
            newFootnoteSection,
            writer.createPositionAt(rootElement, rootElement.maxOffset)
        );
        return newFootnoteSection;
    }

}

/**
 * A short opaque id used to pair a footnote item with its references. Not security-sensitive — it
 * only has to be unique within one document — so `Math.random()` is fine, and it keeps the plugin
 * usable over plain HTTP where `crypto.randomUUID()` is unavailable.
 */
function newFootnoteId(): string {
    return Math.random().toString(36).slice(2);
}

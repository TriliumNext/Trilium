import {
    Command, type DowncastConversionApi, type Editor, Enter, type EnterCommand, type ModelElement,
    type ModelItem, type ModelPosition, type ModelRange, Plugin, priorities, type ViewElement
} from "ckeditor5";

import { BLOCK_ID } from "../block_reference/block_reference_editing.js";
import HiddenBlocks from "../hidden_blocks.js";
import { CLASSES, COLLAPSED_DATA_ATTRIBUTE, HEADING_COLLAPSED } from "./constants.js";
import {
    getCollapsedSections, getSection, getSectionLevel, hasSection
} from "./heading_sections.js";

/**
 * Headings that hide their section: the blocks after them up to the next heading of the same or
 * a higher level. The state is saved as `data-trilium-collapsed="true"` on the heading element, and
 * `HiddenBlocks` hides the section.
 */
export default class CollapsibleHeadingsEditing extends Plugin {

    static get pluginName() {
        return "CollapsibleHeadingsEditing" as const;
    }

    static get requires() {
        return [ HiddenBlocks, Enter ] as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.model.schema.extend("$block", { allowAttributes: HEADING_COLLAPSED });
        this.registerConversion();
        editor.plugins.get(HiddenBlocks).register({
            attribute: HEADING_COLLAPSED,
            canCollapse: hasSection,
            getCollapsedSections,
            expand: (writer, owner) => writer.removeAttribute(HEADING_COLLAPSED, owner)
        });

        const command = new ToggleHeadingCollapseCommand(editor);
        editor.commands.add("toggleHeadingCollapse", command);
        // List items share the keystroke: each handler acts only while its command is enabled.
        editor.keystrokes.set("Ctrl+Alt+Enter", (_data, cancel) => {
            if (command.isEnabled) {
                editor.execute("toggleHeadingCollapse");
                cancel();
            }
        });
        editor.accessibility.addKeystrokeInfos({
            keystrokes: [ {
                label: t("Collapse or expand the section of a heading"),
                keystroke: "Ctrl+Alt+Enter"
            } ]
        });

        this.registerEnterAfterCollapsedHeading();
    }

    /**
     * Collapses or expands `heading`, which has blocks under it, and announces the new state. A
     * toggle is not an undo step. A section that shows for the moment, as for Search in note,
     * counts as expanded, and a toggle hides it again.
     */
    toggle(heading: ModelElement) {
        const editor = this.editor;
        const t = editor.t;
        const isCollapsing = !isShownCollapsed(editor, heading);
        const hiddenBlocks = editor.plugins.get(HiddenBlocks);
        if (hiddenBlocks.isRevealed(heading)) {
            hiddenBlocks.conceal(heading);
        } else {
            const hidesSelection = isCollapsing && isSelectionIn(editor, getSection(heading));
            editor.model.enqueueChange({ isUndoable: false }, (writer) => {
                if (isCollapsing) {
                    writer.setAttribute(HEADING_COLLAPSED, true, heading);
                } else {
                    writer.removeAttribute(HEADING_COLLAPSED, heading);
                }
                if (hidesSelection) {
                    writer.setSelection(heading, "end");
                }
            });
        }
        editor.ui.ariaLiveAnnouncer.announce(
            isCollapsing ? t("Section collapsed") : t("Section expanded"));
    }

    private registerConversion() {
        const conversion = this.editor.conversion;

        conversion.for("downcast").attributeToAttribute({
            model: HEADING_COLLAPSED,
            view: () => ({ key: COLLAPSED_DATA_ATTRIBUTE, value: "true" })
        });

        // Consumes the attribute with any value, so that General HTML Support does not keep it.
        conversion.for("upcast").add((dispatcher) => {
            dispatcher.on("element", (_evt, data, { consumable, writer }) => {
                const viewElement = data.viewItem;
                const isConsumed = /^h[1-6]$/.test(viewElement.name)
                    && consumable.consume(viewElement, { attributes: COLLAPSED_DATA_ATTRIBUTE });
                if (!isConsumed || viewElement.getAttribute(COLLAPSED_DATA_ATTRIBUTE) !== "true") {
                    return;
                }
                for (const item of (data.modelRange as ModelRange).getItems({ shallow: true })) {
                    writer.setAttribute(HEADING_COLLAPSED, true, item);
                }
            }, { priority: priorities.get("low") + 1 });
        });

        // The headings that can collapse keep room for their arrow.
        conversion.for("editingDowncast").add((dispatcher) => {
            const markSectionHeading = (
                _evt: unknown, data: { item: ModelItem }, conversionApi: DowncastConversionApi
            ) => {
                const item = data.item;
                if (!item.is("element") || !/^heading[1-6]$/.test(item.name)) {
                    return;
                }
                const viewElement = conversionApi.mapper.toViewElement(item) as ViewElement;
                if (getSectionLevel(item) === null) {
                    conversionApi.writer.removeClass(CLASSES.sectionHeading, viewElement);
                } else {
                    conversionApi.writer.addClass(CLASSES.sectionHeading, viewElement);
                }
            };
            dispatcher.on("insert", markSectionHeading, { priority: "low" });
            dispatcher.on("attribute:listItemId", markSectionHeading, { priority: "low" });
        });
    }

    /**
     * Makes Enter at the end of a collapsed heading add an empty heading of the same level after
     * its section, which stays collapsed. Stopping the command keeps `Heading` from turning the
     * new block into a paragraph.
     */
    private registerEnterAfterCollapsedHeading() {
        const editor = this.editor;
        const model = editor.model;
        this.listenTo(editor.commands.get("enter") as EnterCommand, "execute", (evt) => {
            const heading = this.getCollapsedHeadingAtSelectionEnd();
            if (!heading) {
                return;
            }

            evt.stop();
            model.change((writer) => {
                model.deleteContent(model.document.selection);
                const attributes = new Map(heading.getAttributes());
                attributes.delete(HEADING_COLLAPSED);
                attributes.delete(BLOCK_ID);
                const blank = writer.createElement(heading.name, attributes);
                const sectionEnd = getSection(heading).at(-1) as ModelElement;
                writer.insert(blank, writer.createPositionAfter(sectionEnd));
                writer.setSelection(blank, 0);
            });
        }, { priority: "high" });
    }

    /** The collapsed heading around the whole selection, when the selection reaches its end. */
    private getCollapsedHeadingAtSelectionEnd(): ModelElement | null {
        const selection = this.editor.model.document.selection;
        const end = selection.getLastPosition() as ModelPosition;
        const heading = end.parent as ModelElement;
        const isAtHeadingEnd = end.isAtEnd
            && (selection.getFirstPosition() as ModelPosition).parent === heading;
        return isAtHeadingEnd && isShownCollapsed(this.editor, heading) ? heading : null;
    }

}

/** Collapses or expands the section of the heading at the selection. */
export class ToggleHeadingCollapseCommand extends Command {

    /** Whether the heading shows collapsed. */
    declare public value: boolean;

    override refresh() {
        const heading = getSelectedHeading(this.editor);
        this.isEnabled = hasSection(heading);
        this.value = isShownCollapsed(this.editor, heading);
    }

    override execute() {
        this.editor.plugins.get(CollapsibleHeadingsEditing).toggle(getSelectedHeading(this.editor));
    }

}

/** The block at the selection, where a heading is looked for. */
function getSelectedHeading(editor: Editor) {
    const position = editor.model.document.selection.getFirstPosition() as ModelPosition;
    return position.parent as ModelElement;
}

/** Whether `heading` is collapsed and its section does not show for the moment. */
function isShownCollapsed(editor: Editor, heading: ModelElement) {
    return heading.hasAttribute(HEADING_COLLAPSED)
        && !editor.plugins.get(HiddenBlocks).isRevealed(heading);
}

/** Whether an end of the selection, or the element it selects, is in one of `blocks`. */
function isSelectionIn(editor: Editor, blocks: ModelElement[]) {
    const selection = editor.model.document.selection;
    const nodes = [
        (selection.getFirstPosition() as ModelPosition).parent as ModelElement,
        (selection.getLastPosition() as ModelPosition).parent as ModelElement,
        selection.getSelectedElement()
    ];
    const blockSet = new Set<unknown>(blocks);
    return nodes.some((node) => node?.getAncestors({ includeSelf: true })
        .some((ancestor) => blockSet.has(ancestor)));
}

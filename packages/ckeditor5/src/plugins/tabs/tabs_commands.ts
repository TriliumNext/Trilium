import { Command, type Editor, type ModelElement, type ModelWriter } from "ckeditor5";

import { BLOCK_ID, type BlockReferenceTarget, generateBlockId } from "../block_reference/block_reference_editing.js";
import {
    getSelectedChildren, getSibling, moveSelectedChildren, moveToSibling, type SiblingTarget
} from "../containers/container_content.js";
import {
    ALIGNMENT_ATTRIBUTE, DEFAULT_TAB_ALIGNMENT, ELEMENTS, parseTabAlignment, type TabAlignment
} from "./constants.js";

/**
 * Inserts a tabs block with two numbered tabs at the selection and selects the first tab's title,
 * so typing replaces it. Selected content moves into the first tab's panel.
 */
export class InsertTabsCommand extends Command {

    public override refresh(): void {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();
        this.isEnabled = !!position && !!model.schema.findAllowedParent(position, ELEMENTS.tabs);
    }

    public override execute(): void {
        const model = this.editor.model;
        const selection = model.document.selection;

        model.change(writer => {
            const content = selection.isCollapsed ? null : model.getSelectedContent(selection);
            const tabs = writer.createElement(ELEMENTS.tabs);
            const firstTab = createTab(writer, getDefaultTitle(this.editor, 0));
            writer.append(firstTab, tabs);
            writer.append(createTab(writer, getDefaultTitle(this.editor, 1)), tabs);
            model.insertObject(tabs, null, null, { setSelection: "on" });
            if (content) {
                model.insertContent(content, writer.createRangeIn(getPanel(firstTab)));
            }
            selectTitle(writer, firstTab);
        });
    }
}

/**
 * Adds a tab after or before the one holding the selection, numbered by its position, and selects
 * its title. With the whole block selected, the tab goes at the end or at the start.
 */
export class InsertTabCommand extends Command {

    public override refresh(): void {
        this.isEnabled = !!getSelectedTabs(this.editor);
    }

    public override execute({ position = "after" }: { position?: "before" | "after" } = {}): void {
        const editor = this.editor;
        const model = editor.model;
        const tabs = getSelectedTabs(editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!tabs) {
            return;
        }
        const currentTab = getSelectedTab(editor);
        // A tabs block holds only elements, so the offset of the new tab is its index.
        const at = currentTab
            ? model.createPositionAt(currentTab, position)
            : model.createPositionAt(tabs, position === "after" ? "end" : 0);

        model.change(writer => {
            const tab = createTab(writer, getDefaultTitle(editor, at.offset));
            writer.insert(tab, at);
            selectTitle(writer, tab);
        });
    }
}

/**
 * Removes the tab holding the selection and moves the caret to the title of a neighboring tab.
 * Removing the last tab removes the whole block.
 */
export class RemoveTabCommand extends Command {

    public override refresh(): void {
        this.isEnabled = !!getSelectedTab(this.editor);
    }

    public override execute(): void {
        const editor = this.editor;
        const tab = getSelectedTab(editor);
        const tabs = tab?.parent;
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!tab || !tabs?.is("element", ELEMENTS.tabs)) {
            return;
        }

        editor.model.change(writer => {
            if (tabs.childCount === 1) {
                const paragraph = writer.createElement("paragraph");
                writer.insert(paragraph, tabs, "after");
                writer.remove(tabs);
                writer.setSelection(paragraph, 0);
                return;
            }

            const neighbor = (tab.nextSibling ?? tab.previousSibling) as ModelElement;
            writer.remove(tab);
            writer.setSelection(getTitle(neighbor), "end");
        });
    }
}

/**
 * Moves the blocks of the current tab's panel that the selection touches to the panel of another
 * tab, which then shows. Content moved toward the first tab goes to the end of the target panel,
 * and content moved toward the last tab goes to its start, so it keeps its place in the reading
 * order.
 */
export class MoveToTabCommand extends Command {

    public override refresh(): void {
        this.isEnabled = !!getSelectedTabContent(this.editor);
    }

    public override execute({ target }: { target: SiblingTarget }): void {
        const content = getSelectedTabContent(this.editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!content) {
            return;
        }
        const tab = getSibling(content.parent.parent as ModelElement, target);
        if (tab) {
            moveSelectedChildren(this.editor, content, getPanel(tab));
        }
    }
}

/**
 * Moves the tab holding the selection to the place of another tab. A command made with a
 * `target`, such as `moveTabLeft`, is disabled when there is no such tab; one made without takes
 * the target in `execute()`.
 */
export class MoveTabCommand extends Command {

    private readonly target: SiblingTarget | undefined;

    public constructor(editor: Editor, target?: SiblingTarget) {
        super(editor);
        this.target = target;
    }

    public override refresh(): void {
        const tab = getSelectedTab(this.editor);
        this.isEnabled = !!tab && (!this.target || !!getSibling(tab, this.target));
    }

    public override execute({ target = this.target }: { target?: SiblingTarget } = {}): void {
        const tab = getSelectedTab(this.editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!tab) {
            return;
        }
        const sibling = target && getSibling(tab, target);
        if (sibling) {
            this.editor.model.change(writer => moveToSibling(writer, tab, sibling));
        }
    }
}

/**
 * Gives the tab holding the selection a block id, unless it has one, and returns it as the target
 * of a block reference, so that a link to the tab resolves like a link to a block.
 */
export class AssignTabReferenceCommand extends Command {

    public override refresh(): void {
        const tab = getSelectedTab(this.editor);
        this.isEnabled = !!tab && this.editor.model.schema.checkAttribute(tab, BLOCK_ID);
    }

    public override execute(): BlockReferenceTarget | null {
        const tab = getSelectedTab(this.editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!tab) {
            return null;
        }

        if (!tab.hasAttribute(BLOCK_ID)) {
            this.editor.model.change(writer => writer.setAttribute(BLOCK_ID, generateBlockId(), tab));
        }
        const id = tab.getAttribute(BLOCK_ID) as string;
        return { startId: id, endId: id, count: 1 };
    }
}

/**
 * Sets the side of the panels that the titles of the selected tabs block sit on. The default side
 * removes the attribute, so the saved HTML of a block on the default side does not change.
 */
export class TabAlignmentCommand extends Command {

    declare public value: TabAlignment | undefined;

    public override refresh(): void {
        const tabs = getSelectedTabs(this.editor);
        this.isEnabled = !!tabs;
        this.value = tabs ? getTabAlignment(tabs) : undefined;
    }

    public override execute({ value }: { value: TabAlignment }): void {
        const tabs = getSelectedTabs(this.editor);
        if (!tabs || !parseTabAlignment(value)) {
            return;
        }

        this.editor.model.change(writer => {
            if (value === DEFAULT_TAB_ALIGNMENT) {
                writer.removeAttribute(ALIGNMENT_ATTRIBUTE, tabs);
            } else {
                writer.setAttribute(ALIGNMENT_ATTRIBUTE, value, tabs);
            }
        });
    }
}

/** Returns the side of the panels that the titles of `tabs` sit on. */
export function getTabAlignment(tabs: ModelElement): TabAlignment {
    return parseTabAlignment(tabs.getAttribute(ALIGNMENT_ATTRIBUTE)) ?? DEFAULT_TAB_ALIGNMENT;
}

/** Creates a tab with the given title and a panel holding one empty paragraph. */
export function createTab(writer: ModelWriter, titleText: string): ModelElement {
    const tab = writer.createElement(ELEMENTS.tab);
    const title = writer.createElement(ELEMENTS.tabTitle);
    writer.appendText(titleText, title);
    writer.append(title, tab);
    const panel = writer.createElement(ELEMENTS.tabPanel);
    writer.append(writer.createElement("paragraph"), panel);
    writer.append(panel, tab);
    return tab;
}

/**
 * Returns the innermost tab that contains the selection, or `null` while a tabs block is selected
 * as a whole, since the tab around it belongs to an outer block.
 */
export function getSelectedTab(editor: Editor): ModelElement | null {
    const selection = editor.model.document.selection;
    if (selection.getSelectedElement()?.is("element", ELEMENTS.tabs)) {
        return null;
    }
    const position = selection.getFirstPosition();
    return (position?.findAncestor(ELEMENTS.tab) as ModelElement | null) ?? null;
}

/**
 * Returns the innermost tabs block that contains the selection, or the block itself when it is
 * the selected object.
 */
export function getSelectedTabs(editor: Editor): ModelElement | null {
    const selection = editor.model.document.selection;
    const selected = selection.getSelectedElement();
    if (selected?.is("element", ELEMENTS.tabs)) {
        return selected;
    }
    const position = selection.getFirstPosition();
    return (position?.findAncestor(ELEMENTS.tabs) as ModelElement | null) ?? null;
}

/**
 * Returns the panel that holds a non-collapsed selection, with the first and last of its blocks
 * that the selection touches, or `null` for a selection in a title.
 */
function getSelectedTabContent(editor: Editor) {
    const content = getSelectedChildren(editor, ELEMENTS.tabPanel);
    const tab = editor.model.document.selection.getFirstPosition()?.findAncestor(ELEMENTS.tab);
    return content && content.parent.parent === tab ? content : null;
}

/** Returns the title of `tab`, which the post-fixer keeps as its first child. */
function getTitle(tab: ModelElement): ModelElement {
    return tab.getChild(0) as ModelElement;
}

/** Returns the panel of `tab`, which the post-fixer keeps as its second child. */
function getPanel(tab: ModelElement): ModelElement {
    return tab.getChild(1) as ModelElement;
}

/** Returns "Tab N" for the tab at the zero-based `index`. */
function getDefaultTitle(editor: Editor, index: number): string {
    const t = editor.t;
    return t("Tab %0", index + 1);
}

function selectTitle(writer: ModelWriter, tab: ModelElement) {
    writer.setSelection(writer.createRangeIn(getTitle(tab)));
}

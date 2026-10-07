import { Command, type Editor, type ModelElement, type ModelWriter } from "ckeditor5";

import { ELEMENTS } from "./constants.js";

/**
 * Inserts a tabs block with two numbered tabs at the selection and selects the first tab's title,
 * so typing replaces it.
 */
export class InsertTabsCommand extends Command {

    public override refresh(): void {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();
        this.isEnabled = !!position && !!model.schema.findAllowedParent(position, ELEMENTS.tabs);
    }

    public override execute(): void {
        const model = this.editor.model;

        model.change(writer => {
            const tabs = writer.createElement(ELEMENTS.tabs);
            const firstTab = createTab(writer, getDefaultTitle(this.editor, 0));
            writer.append(firstTab, tabs);
            writer.append(createTab(writer, getDefaultTitle(this.editor, 1)), tabs);
            model.insertObject(tabs, null, null, { setSelection: "on" });
            selectTitle(writer, firstTab);
        });
    }
}

/**
 * Adds a tab after the one holding the selection, numbered by its position, and selects its
 * title. With the whole block selected, the tab goes at the end.
 */
export class InsertTabCommand extends Command {

    public override refresh(): void {
        this.isEnabled = !!getSelectedTabs(this.editor);
    }

    public override execute(): void {
        const editor = this.editor;
        const tabs = getSelectedTabs(editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!tabs) {
            return;
        }
        // With a nested block selected as a whole, the selection's tab belongs to the outer block.
        const selectedTab = getSelectedTab(editor);
        const currentTab = selectedTab?.parent === tabs ? selectedTab : null;
        // A tabs block holds only elements, so the offset after a tab is its index plus one.
        const index = currentTab ? editor.model.createPositionAfter(currentTab).offset : tabs.childCount;

        editor.model.change(writer => {
            const tab = createTab(writer, getDefaultTitle(editor, index));
            if (currentTab) {
                writer.insert(tab, currentTab, "after");
            } else {
                writer.insert(tab, tabs, "end");
            }
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

/** Swaps the tab holding the selection with its left or right neighbor. */
export class MoveTabCommand extends Command {

    private readonly direction: "left" | "right";

    public constructor(editor: Editor, direction: "left" | "right") {
        super(editor);
        this.direction = direction;
    }

    public override refresh(): void {
        const tab = getSelectedTab(this.editor);
        this.isEnabled = !!this.getNeighbor(tab);
    }

    public override execute(): void {
        const editor = this.editor;
        const tab = getSelectedTab(editor);
        const neighbor = this.getNeighbor(tab);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!tab || !neighbor) {
            return;
        }

        editor.model.change(writer => {
            const target = this.direction === "left"
                ? writer.createPositionBefore(neighbor)
                : writer.createPositionAfter(neighbor);
            writer.move(writer.createRangeOn(tab), target);
        });
    }

    private getNeighbor(tab: ModelElement | null) {
        const neighbor = this.direction === "left" ? tab?.previousSibling : tab?.nextSibling;
        return neighbor?.is("element", ELEMENTS.tab) ? neighbor : null;
    }
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

/** Returns the innermost tab that contains the selection. */
export function getSelectedTab(editor: Editor): ModelElement | null {
    const position = editor.model.document.selection.getFirstPosition();
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

/** Returns the title of `tab`, which the post-fixer keeps as its first child. */
function getTitle(tab: ModelElement): ModelElement {
    return tab.getChild(0) as ModelElement;
}

/** Returns "Tab N" for the tab at the zero-based `index`. */
function getDefaultTitle(editor: Editor, index: number): string {
    const t = editor.t;
    return t("Tab %0", index + 1);
}

function selectTitle(writer: ModelWriter, tab: ModelElement) {
    writer.setSelection(writer.createRangeIn(getTitle(tab)));
}

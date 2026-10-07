import { Command, type Editor, type ModelElement, type ModelWriter } from "ckeditor5";

import { ELEMENTS } from "./constants.js";

/**
 * Inserts a tabs block with two empty tabs at the selection and places the caret in the first
 * tab's title.
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
            writer.append(createTab(writer), tabs);
            writer.append(createTab(writer), tabs);
            model.insertObject(tabs, null, null, { setSelection: "on" });

            const firstTitle = getTitle(tabs.getChild(0) as ModelElement);
            if (firstTitle) {
                writer.setSelection(firstTitle, 0);
            }
        });
    }
}

/**
 * Adds a tab next to the one holding the selection and places the caret in its title. With
 * the whole block selected, the tab goes at the end.
 */
export class InsertTabCommand extends Command {

    public override refresh(): void {
        this.isEnabled = !!getSelectedTabs(this.editor);
    }

    public override execute({ position = "after" }: { position?: "before" | "after" } = {}): void {
        const editor = this.editor;
        const tabs = getSelectedTabs(editor);
        if (!tabs) {
            return;
        }
        const currentTab = getSelectedTab(editor);

        editor.model.change(writer => {
            const tab = createTab(writer);
            if (currentTab) {
                writer.insert(tab, currentTab, position);
            } else {
                writer.insert(tab, tabs, "end");
            }

            const title = getTitle(tab);
            if (title) {
                writer.setSelection(title, 0);
            }
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

            const title = getTitle(neighbor);
            if (title) {
                writer.setSelection(title, "end");
            }
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

/** Creates a tab with an empty title and a panel holding one empty paragraph. */
export function createTab(writer: ModelWriter): ModelElement {
    const tab = writer.createElement(ELEMENTS.tab);
    writer.append(writer.createElement(ELEMENTS.tabTitle), tab);
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

function getTitle(tab: ModelElement): ModelElement | null {
    const title = tab.getChild(0);
    return title?.is("element", ELEMENTS.tabTitle) ? title : null;
}

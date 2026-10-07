import {
    enableViewPlaceholder,
    type ModelElement,
    type ModelNode,
    type ModelPosition,
    type ModelWriter,
    type PlaceholderableViewElement,
    Plugin,
    toWidget,
    toWidgetEditable,
    type ViewDocumentEnterEvent,
    type ViewEditableElement,
    Widget
} from "ckeditor5";

import { CLASSES, ELEMENTS, TABS_WIDGET_PROPERTY } from "./constants.js";
import { InsertTabCommand, InsertTabsCommand, MoveTabCommand, RemoveTabCommand } from "./tabs_commands.js";

/**
 * Schema, conversion, commands and key handling for tabs blocks.
 *
 * Model:        <tabs><tab><tabTitle>…</tabTitle><tabPanel>…blocks…</tabPanel></tab>…</tabs>
 * Data view:    <div class="trilium-tabs">
 *                   <section class="trilium-tab">
 *                       <p class="trilium-tab-title">…</p>
 *                       <div class="trilium-tab-panel">…blocks…</div>
 *                   </section>
 *               </div>
 * Editing view: a widget whose titles form the tab strip and whose active panel shows below it.
 *
 * The active tab is editing-view state only: it follows the selection, so clicking a title or
 * moving the caret into a tab shows that tab. The saved HTML lists every tab in order, which
 * reads as a sequence of titled sections wherever no script turns it into tabs.
 */
export default class TabsEditing extends Plugin {

    public static get pluginName() {
        return "TabsEditing" as const;
    }

    public static get requires() {
        return [Widget] as const;
    }

    /** The tab each tabs block shows, keyed by the `tabs` model element. */
    private readonly activeTabs = new WeakMap<ModelElement, ModelElement>();

    public init(): void {
        const editor = this.editor;
        editor.commands.add("tabs", new InsertTabsCommand(editor));
        editor.commands.add("insertTab", new InsertTabCommand(editor));
        editor.commands.add("removeTab", new RemoveTabCommand(editor));
        editor.commands.add("moveTabLeft", new MoveTabCommand(editor, "left"));
        editor.commands.add("moveTabRight", new MoveTabCommand(editor, "right"));

        this.registerSchema();
        this.registerConversion();
        this.registerPostFixer();
        this.registerActiveTabTracking();
        this.registerEnterInTitle();
    }

    /**
     * Returns the tab that `tabs` shows: the one last activated, or the first tab when that one
     * was removed or none was activated yet.
     */
    public getActiveTab(tabs: ModelElement): ModelElement | null {
        const active = this.activeTabs.get(tabs);
        if (active?.parent === tabs) {
            return active;
        }
        const first = tabs.getChild(0);
        return first?.is("element", ELEMENTS.tab) ? first : null;
    }

    private registerSchema() {
        const schema = this.editor.model.schema;
        schema.register(ELEMENTS.tabs, {
            inheritAllFrom: "$blockObject"
        });
        schema.register(ELEMENTS.tab, {
            allowIn: ELEMENTS.tabs,
            isLimit: true
        });
        schema.register(ELEMENTS.tabTitle, {
            allowIn: ELEMENTS.tab,
            allowContentOf: "$block",
            isLimit: true
        });
        schema.register(ELEMENTS.tabPanel, {
            allowIn: ELEMENTS.tab,
            allowContentOf: "$root",
            isLimit: true
        });
    }

    private registerConversion() {
        const editor = this.editor;
        const conversion = editor.conversion;
        const t = editor.t;

        // The upcasts match on class and run ahead of the paragraph and General HTML Support
        // converters, which would otherwise claim the plain `<div>`, `<section>` and `<p>`.
        conversion.for("upcast").elementToElement({
            view: { name: "div", classes: CLASSES.tabs },
            model: ELEMENTS.tabs,
            converterPriority: "high"
        });
        conversion.for("upcast").elementToElement({
            view: { name: "section", classes: CLASSES.tab },
            model: ELEMENTS.tab,
            converterPriority: "high"
        });
        conversion.for("upcast").elementToElement({
            view: { name: "p", classes: CLASSES.tabTitle },
            model: ELEMENTS.tabTitle,
            converterPriority: "high"
        });
        conversion.for("upcast").elementToElement({
            view: { name: "div", classes: CLASSES.tabPanel },
            model: ELEMENTS.tabPanel,
            converterPriority: "high"
        });

        conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.tabs,
            view: (_model, { writer }) => writer.createContainerElement("div", { class: CLASSES.tabs })
        });
        conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.tab,
            view: (_model, { writer }) => writer.createContainerElement("section", { class: CLASSES.tab })
        });
        conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.tabTitle,
            view: (_model, { writer }) => writer.createContainerElement("p", { class: CLASSES.tabTitle })
        });
        conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.tabPanel,
            view: (_model, { writer }) => writer.createContainerElement("div", { class: CLASSES.tabPanel })
        });

        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.tabs,
            view: (_model, { writer }) => {
                const div = writer.createContainerElement("div", { class: CLASSES.tabs });
                writer.setCustomProperty(TABS_WIDGET_PROPERTY, true, div);
                return toWidget(div, writer, { label: t("Tabs"), hasSelectionHandle: true });
            }
        });
        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.tab,
            view: (model, { writer }) => {
                const tabs = model.parent;
                const isActive = !!tabs?.is("element", ELEMENTS.tabs) && this.getActiveTab(tabs) === model;
                const classes = isActive ? [CLASSES.tab, CLASSES.activeTab] : [CLASSES.tab];
                return writer.createContainerElement("section", { class: classes.join(" ") });
            }
        });
        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.tabTitle,
            view: (_model, { writer }) => {
                const title: ViewEditableElement & PlaceholderableViewElement =
                    writer.createEditableElement("div", { class: CLASSES.tabTitle });
                title.placeholder = t("Tab title");
                enableViewPlaceholder({
                    view: editor.editing.view,
                    element: title,
                    keepOnFocus: true
                });
                return toWidgetEditable(title, writer, { label: t("Tab title") });
            }
        });
        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.tabPanel,
            view: (_model, { writer }) => {
                const panel = writer.createEditableElement("div", { class: CLASSES.tabPanel });
                return toWidgetEditable(panel, writer, { label: t("Tab content") });
            }
        });
    }

    /**
     * Keeps every tabs block well formed however it was produced (paste, import, undo): a block
     * has at least one tab, and every tab starts with a title and holds one non-empty panel.
     */
    private registerPostFixer() {
        const model = this.editor.model;

        model.document.registerPostFixer(writer => {
            const blocks = new Set<ModelElement>();
            for (const change of model.document.differ.getChanges()) {
                if (change.type === "attribute") {
                    continue;
                }
                collectTabsAround(change.position, blocks);
                if (change.type === "insert") {
                    collectTabsWithin(change.position.nodeAfter, blocks);
                }
            }

            let changed = false;
            for (const tabs of blocks) {
                changed = fixTabs(writer, tabs) || changed;
            }
            return changed;
        });
    }

    /**
     * Shows the tab that holds the selection and re-applies the active class wherever a tab was
     * added, removed or moved. Runs after the editing downcast, so every tab has its view element.
     */
    private registerActiveTabTracking() {
        const editor = this.editor;
        const model = editor.model;

        this.listenTo(model.document, "change", () => {
            const blocks = new Set<ModelElement>();

            const position = model.document.selection.getFirstPosition();
            for (const ancestor of position?.getAncestors() ?? []) {
                if (ancestor.is("element", ELEMENTS.tab) && ancestor.parent?.is("element", ELEMENTS.tabs)) {
                    this.activeTabs.set(ancestor.parent, ancestor);
                    blocks.add(ancestor.parent);
                }
            }

            for (const change of model.document.differ.getChanges()) {
                if (change.type !== "attribute" && change.position.parent.is("element", ELEMENTS.tabs)) {
                    blocks.add(change.position.parent);
                }
            }

            if (blocks.size) {
                this.updateActiveClasses(blocks);
            }
        }, { priority: "lowest" });
    }

    private updateActiveClasses(blocks: Set<ModelElement>) {
        const editing = this.editor.editing;
        editing.view.change(writer => {
            for (const tabs of blocks) {
                if (tabs.root.rootName === "$graveyard") {
                    continue;
                }
                const active = this.getActiveTab(tabs);
                for (const tab of tabs.getChildren()) {
                    const view = editing.mapper.toViewElement(tab as ModelElement);
                    if (!view) {
                        continue;
                    }
                    if (tab === active) {
                        writer.addClass(CLASSES.activeTab, view);
                    } else {
                        writer.removeClass(CLASSES.activeTab, view);
                    }
                }
            }
        });
    }

    /** A title holds a single line, so Enter moves the caret to the start of the tab's panel. */
    private registerEnterInTitle() {
        const editor = this.editor;
        const model = editor.model;

        this.listenTo<ViewDocumentEnterEvent>(editor.editing.view.document, "enter", (evt, data) => {
            const position = model.document.selection.getFirstPosition();
            const title = position?.findAncestor(ELEMENTS.tabTitle);
            const panel = title?.nextSibling;
            if (!panel?.is("element", ELEMENTS.tabPanel)) {
                return;
            }

            model.change(writer => {
                writer.setSelection(writer.createPositionAt(panel, 0));
            });
            data.preventDefault();
            evt.stop();
        }, { priority: "high" });
    }
}

/** Adds every tabs block that encloses `position`. */
function collectTabsAround(position: ModelPosition, blocks: Set<ModelElement>) {
    for (const ancestor of position.getAncestors()) {
        if (ancestor.is("element", ELEMENTS.tabs)) {
            blocks.add(ancestor);
        }
    }
}

/** Adds `node` and every tabs block inside it. */
function collectTabsWithin(node: ModelNode | null, blocks: Set<ModelElement>) {
    if (!node?.is("element")) {
        return;
    }
    if (node.is("element", ELEMENTS.tabs)) {
        blocks.add(node);
    }
    for (const child of node.getChildren()) {
        collectTabsWithin(child, blocks);
    }
}

function fixTabs(writer: ModelWriter, tabs: ModelElement): boolean {
    if (tabs.root.rootName === "$graveyard") {
        return false;
    }

    if (tabs.isEmpty) {
        writer.remove(tabs);
        return true;
    }

    let changed = false;
    for (const tab of [...tabs.getChildren()]) {
        if (!tab.is("element", ELEMENTS.tab)) {
            continue;
        }
        const children = [...tab.getChildren()];
        const title = children.find(child => child.is("element", ELEMENTS.tabTitle));
        const panel = children.find(child => child.is("element", ELEMENTS.tabPanel)) as ModelElement | undefined;

        if (!title) {
            writer.insertElement(ELEMENTS.tabTitle, tab, 0);
            changed = true;
        } else if (title.index !== 0) {
            writer.move(writer.createRangeOn(title), tab, 0);
            changed = true;
        }

        if (!panel) {
            const newPanel = writer.createElement(ELEMENTS.tabPanel);
            writer.appendElement("paragraph", newPanel);
            writer.append(newPanel, tab);
            changed = true;
        } else if (panel.isEmpty) {
            writer.appendElement("paragraph", panel);
            changed = true;
        }
    }
    return changed;
}

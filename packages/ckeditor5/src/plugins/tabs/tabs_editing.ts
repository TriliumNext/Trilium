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
    uid,
    Widget
} from "ckeditor5";

import { CLASSES, ELEMENTS, TABS_WIDGET_PROPERTY } from "./constants.js";
import { InsertTabCommand, InsertTabsCommand, MoveTabCommand, RemoveTabCommand } from "./tabs_commands.js";

/**
 * Schema, conversion, commands and key handling for tabs blocks. The active tab is editing-view
 * state only and follows the selection; the saved HTML lists every tab as a titled section.
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

    /** The editing-view ID prefix of each tab's title and panel, keyed by the `tab` model element. */
    private readonly tabIds = new WeakMap<ModelElement, string>();

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
        this.registerFindReveal();
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
        return tabs.getChild(0) as ModelElement | null;
    }

    /** Shows every tab that encloses `position`, without moving the selection. */
    public showTabsAround(position: ModelPosition | null | undefined) {
        const blocks = new Set<ModelElement>();
        this.activateTabsAround(position, blocks);
        if (blocks.size) {
            this.updateActiveClasses(blocks);
        }
    }

    /**
     * Shows every tab that encloses `domNode`, a node of the editing view such as a link target,
     * without moving the selection.
     */
    public showTabsAroundDomNode(domNode: Node) {
        const editing = this.editor.editing;
        const viewPosition = editing.view.domConverter.domPositionToView(domNode, 0);
        this.showTabsAround(viewPosition ? editing.mapper.toModelPosition(viewPosition) : null);
    }

    private isActiveTab(tab: ModelElement) {
        const tabs = tab.parent;
        return !!tabs?.is("element", ELEMENTS.tabs) && this.getActiveTab(tabs) === tab;
    }

    private getTabId(tab: ModelElement) {
        let id = this.tabIds.get(tab);
        if (!id) {
            id = `trilium-tab-${uid()}`;
            this.tabIds.set(tab, id);
        }
        return id;
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
                const classes = this.isActiveTab(model) ? [CLASSES.tab, CLASSES.activeTab] : [CLASSES.tab];
                return writer.createContainerElement("section", { class: classes.join(" ") });
            }
        });
        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.tabTitle,
            view: (model, { writer }) => {
                // The title keeps its textbox role so that screen readers offer to edit it; the
                // global `aria-current` and `aria-controls` attributes carry the tab semantics.
                const tab = model.parent as ModelElement;
                const id = this.getTabId(tab);
                const title: ViewEditableElement & PlaceholderableViewElement =
                    writer.createEditableElement("div", {
                        class: CLASSES.tabTitle,
                        id: `${id}-title`,
                        "aria-controls": `${id}-panel`,
                        ...(this.isActiveTab(tab) ? { "aria-current": "true" } : {})
                    });
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
            view: (model, { writer }) => {
                // `aria-labelledby` names the panel after its title; an empty title falls back to
                // the `aria-label`.
                const id = this.getTabId(model.parent as ModelElement);
                const panel = writer.createEditableElement("div", {
                    class: CLASSES.tabPanel,
                    id: `${id}-panel`,
                    "aria-labelledby": `${id}-title`
                });
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

        // A change that leaves the selection where it was, such as a find marker moving, keeps
        // the tab that is showing.
        let selectionMoved = true;
        this.listenTo(model.document.selection, "change:range", () => {
            selectionMoved = true;
        });

        this.listenTo(model.document, "change", () => {
            const blocks = new Set<ModelElement>();

            if (selectionMoved) {
                this.activateTabsAround(model.document.selection.getFirstPosition(), blocks);
                selectionMoved = false;
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

    /** Shows the tab that holds the highlighted find-in-note result, without moving the caret. */
    private registerFindReveal() {
        const plugins = this.editor.plugins;
        const state = plugins.has("FindAndReplaceEditing") ? plugins.get("FindAndReplaceEditing").state : undefined;
        if (!state) {
            return;
        }

        this.listenTo(state, "change:highlightedResult", (_evt, _name, highlighted) => {
            this.showTabsAround(highlighted?.marker?.getStart());
        });
    }

    /** Makes every tab that encloses `position` the active one of its block and adds the block to `blocks`. */
    private activateTabsAround(position: ModelPosition | null | undefined, blocks: Set<ModelElement>) {
        for (const ancestor of position?.getAncestors() ?? []) {
            if (ancestor.is("element", ELEMENTS.tab) && ancestor.parent?.is("element", ELEMENTS.tabs)) {
                this.activeTabs.set(ancestor.parent, ancestor);
                blocks.add(ancestor.parent);
            }
        }
    }

    private updateActiveClasses(blocks: Set<ModelElement>) {
        const editing = this.editor.editing;
        editing.view.change(writer => {
            for (const tabs of blocks) {
                const active = this.getActiveTab(tabs);
                for (const tab of tabs.getChildren() as IterableIterator<ModelElement>) {
                    const view = editing.mapper.toViewElement(tab);
                    const title = editing.mapper.toViewElement(tab.getChild(0) as ModelElement);
                    /* v8 ignore next 3 -- only a tab outside the document, which no caller passes, has no view */
                    if (!view || !title) {
                        continue;
                    }
                    if (tab === active) {
                        writer.addClass(CLASSES.activeTab, view);
                        writer.setAttribute("aria-current", "true", title);
                    } else {
                        writer.removeClass(CLASSES.activeTab, view);
                        writer.removeAttribute("aria-current", title);
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
    /* v8 ignore next 3 -- the differ reports no change inside a removed element */
    if (tabs.root.rootName === "$graveyard") {
        return false;
    }

    if (tabs.isEmpty) {
        writer.remove(tabs);
        return true;
    }

    let changed = false;
    for (const tab of [...tabs.getChildren()]) {
        /* v8 ignore next 3 -- the schema allows only tabs in a tabs block */
        if (!tab.is("element", ELEMENTS.tab)) {
            continue;
        }
        const children = [...tab.getChildren()] as ModelElement[];
        const title = children.find(child => child.is("element", ELEMENTS.tabTitle));
        let panel: ModelElement | undefined = children.find(child => child.is("element", ELEMENTS.tabPanel));

        if (!title) {
            writer.insertElement(ELEMENTS.tabTitle, tab, 0);
            changed = true;
        } else if (title.index !== 0) {
            writer.move(writer.createRangeOn(title), tab, 0);
            changed = true;
        }

        if (!panel) {
            panel = writer.createElement(ELEMENTS.tabPanel);
            writer.append(panel, tab);
            changed = true;
        }

        if (mergeIntoPanel(writer, children, title, panel)) {
            changed = true;
        }

        if (panel.isEmpty) {
            writer.appendElement("paragraph", panel);
            changed = true;
        }
    }
    return changed;
}

/**
 * Moves the content of every title and panel of a tab other than `title` and `panel` into
 * `panel`, keeping document order: what precedes `panel` goes before its content, what follows it
 * goes after. An extra title becomes a paragraph.
 */
function mergeIntoPanel(writer: ModelWriter, children: ModelElement[], title: ModelElement | undefined, panel: ModelElement) {
    let offset: number | "end" = 0;
    let changed = false;
    for (const child of children) {
        if (child === title) {
            continue;
        }
        if (child === panel) {
            offset = "end";
            continue;
        }

        const target = writer.createPositionAt(panel, offset);
        let count = 1;
        if (child.is("element", ELEMENTS.tabPanel)) {
            count = child.childCount;
            writer.move(writer.createRangeIn(child), target);
            writer.remove(child);
        } else {
            writer.rename(child, "paragraph");
            writer.move(writer.createRangeOn(child), target);
        }
        if (offset !== "end") {
            offset += count;
        }
        changed = true;
    }
    return changed;
}

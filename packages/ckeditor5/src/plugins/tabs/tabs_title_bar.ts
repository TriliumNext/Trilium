import {
    type DowncastConversionApi,
    type DowncastInsertEvent,
    type DowncastRemoveEvent,
    type MapperModelToViewPositionEvent,
    type MapperViewToModelPositionEvent,
    type ModelElement,
    Plugin,
    type ViewDowncastWriter,
    type ViewElement,
    type ViewNode,
    type ViewPosition
} from "ckeditor5";

import {
    attachScrollableBar, createScrollableBarEdge, SCROLLABLE_BAR_CLASSES, type ScrollableBar,
    type ScrollableBarEdge
} from "../scrollable_bar.js";
import { CLASSES, ELEMENTS } from "./constants.js";

/**
 * The title bar of tabs blocks in the editing view: a scrollable bar that holds the title of every
 * tab, above or below the panels. The model and the saved HTML keep each title inside its tab, so
 * the plugin maps the positions of a tab between the title in the bar and the panel in the tab's
 * section.
 */
export default class TabsTitleBar extends Plugin {

    public static get pluginName() {
        return "TabsTitleBar" as const;
    }

    /** The viewport of the title bar, keyed by the view element of the tabs block. */
    private readonly viewports = new WeakMap<ViewElement, ViewElement>();

    /** The view title of each tab, keyed by the view section of the tab. */
    private readonly titles = new WeakMap<ViewElement, ViewElement>();

    /**
     * The title bars that scroll, keyed by their view element. The renderer can bind a DOM bar to
     * a new view bar and reset its classes, so a scrolling bar belongs to both elements together.
     */
    private readonly bars = new Map<ViewElement, AttachedBar>();

    /** The view title bars to attach to their DOM element after the next render. */
    private readonly newBars = new Set<ViewElement>();

    /** The view titles to scroll into view after the next render. */
    private readonly pendingReveals = new Set<ViewElement>();

    public init(): void {
        this.registerPositionMapping();
        this.registerTitleConversion();
        this.listenTo(this.editor.editing.view, "render", () => {
            this.updateBars();
            this.revealPendingTitles();
        }, { priority: "low" });
    }

    public override destroy(): void {
        for (const { scrollableBar } of this.bars.values()) {
            scrollableBar.disconnect();
        }
        this.bars.clear();
        super.destroy();
    }

    /** Adds an empty title bar to `tabs`, the editing-view element of a tabs block. */
    public addBar(writer: ViewDowncastWriter, tabs: ViewElement) {
        const t = this.editor.t;
        const bar = writer.createContainerElement("div", {
            class: `${SCROLLABLE_BAR_CLASSES.bar} ${CLASSES.titleBar}`
        });
        const viewport = writer.createContainerElement("div", {
            class: SCROLLABLE_BAR_CLASSES.viewport
        });
        writer.insert(writer.createPositionAt(bar, 0), [
            createEdge(writer, "start", t("Scroll to the previous tabs")),
            viewport,
            createEdge(writer, "end", t("Scroll to the next tabs"))
        ]);
        writer.insert(writer.createPositionAt(tabs, "end"), bar);
        this.viewports.set(tabs, viewport);
        this.newBars.add(bar);
    }

    /**
     * Scrolls the title bar of `title`, the editing-view element of a title, to show the whole
     * title after the next render. Rendering waits for the end of a model change block, so a
     * title that the change converts has no DOM element before.
     */
    public revealTitleAfterRender(title: ViewElement) {
        this.pendingReveals.add(title);
    }

    /**
     * Maps the positions in a tab: offset 0 is in the title bar, before the tab's title, and the
     * other offsets are in the tab's section. In a tabs block, only the sections count.
     */
    private registerPositionMapping() {
        const editing = this.editor.editing;
        const view = editing.view;
        const model = this.editor.model;

        // A tabs block and a tab convert before the positions inside them are mapped.
        editing.mapper.on<MapperModelToViewPositionEvent>("modelToViewPosition", (_evt, data) => {
            const { parent, offset } = data.modelPosition;
            if (parent.is("element", ELEMENTS.tabs)) {
                const tabs = data.mapper.toViewElement(parent) as ViewElement;
                data.viewPosition = this.getSectionPosition(tabs, offset);
            } else if (parent.is("element", ELEMENTS.tab)) {
                const section = data.mapper.toViewElement(parent) as ViewElement;
                data.viewPosition = offset === 0
                    ? this.getTitlePosition(section)
                    : view.createPositionAt(section, offset - 1);
            }
        });

        editing.mapper.on<MapperViewToModelPositionEvent>("viewToModelPosition", (_evt, data) => {
            const { parent, offset } = data.viewPosition;
            if (!parent.is("element")) {
                return;
            }
            const modelParent = data.mapper.toModelElement(parent);
            if (modelParent?.is("element", ELEMENTS.tabs)) {
                const sections = [ ...parent.getChildren() ].slice(0, offset).filter(isSection);
                data.modelPosition = model.createPositionAt(modelParent, sections.length);
            } else if (modelParent?.is("element", ELEMENTS.tab)) {
                const modelOffset = Math.min(offset + 1, modelParent.maxOffset);
                data.modelPosition = model.createPositionAt(modelParent, modelOffset);
            }
        });
    }

    /**
     * Keeps the view title of each tab known by its section, and removes it from the title bar
     * together with the title or the tab.
     */
    private registerTitleConversion() {
        const dispatcher = this.editor.editing.downcastDispatcher;

        // The section of a tab converts before its title, which converts at the normal priority.
        dispatcher.on<DowncastInsertEvent<ModelElement>>(`insert:${ELEMENTS.tabTitle}`,
            (_evt, data, { mapper }) => {
                const tab = data.item.parent as ModelElement;
                const section = mapper.toViewElement(tab) as ViewElement;
                this.titles.set(section, mapper.toViewElement(data.item) as ViewElement);
            }, { priority: "low" });

        dispatcher.on<DowncastRemoveEvent>(`remove:${ELEMENTS.tab}`, (_evt, data, api) => {
            const { mapper, writer } = api;
            const start = mapper.toViewPosition(data.position);
            const end = mapper.toViewPosition(data.position.getShiftedBy(data.length), {
                isPhantom: true
            });
            for (const section of writer.createRange(start, end).getItems({ shallow: true })) {
                this.removeTitle(section as ViewElement, api);
            }
        }, { priority: "high" });

        // A title is outside the section of its tab, so this converter replaces the default one.
        dispatcher.on<DowncastRemoveEvent>(`remove:${ELEMENTS.tabTitle}`, (evt, data, api) => {
            const section = api.mapper.toViewElement(data.position.parent as ModelElement);
            this.removeTitle(section as ViewElement, api);
            evt.stop();
        }, { priority: "high" });
    }

    /**
     * The position before the section at `offset` among the sections of `tabs`, or after the last
     * section or the title bar.
     */
    private getSectionPosition(tabs: ViewElement, offset: number): ViewPosition {
        const view = this.editor.editing.view;
        const sections = [ ...tabs.getChildren() ].filter(isSection);
        if (offset < sections.length) {
            return view.createPositionBefore(sections[offset]);
        }
        const viewport = this.viewports.get(tabs) as ViewElement;
        return view.createPositionAfter(sections.at(-1) ?? viewport.parent as ViewElement);
    }

    /** The position for the title of the tab of `section`: after the title of the previous tab. */
    private getTitlePosition(section: ViewElement): ViewPosition {
        const view = this.editor.editing.view;
        for (let node = section.previousSibling; node; node = node.previousSibling) {
            const title = this.titles.get(node as ViewElement);
            if (title) {
                return view.createPositionAfter(title);
            }
        }
        const viewport = this.viewports.get(section.parent as ViewElement) as ViewElement;
        return view.createPositionAt(viewport, 0);
    }

    private removeTitle(section: ViewElement, { mapper, writer }: DowncastConversionApi) {
        const title = this.titles.get(section);
        /* v8 ignore next 3 -- every converted tab has its title in the title bar */
        if (!title) {
            return;
        }
        this.titles.delete(section);
        const removed = writer.remove(writer.createRangeOn(title));
        for (const item of writer.createRangeIn(removed).getItems()) {
            if (item.is("element")) {
                mapper.unbindViewElement(item, { defer: true });
            }
        }
    }

    /**
     * Starts scrolling the title bars that rendered, and stops those whose view element left the
     * view or now renders to another DOM element.
     */
    private updateBars() {
        const domConverter = this.editor.editing.view.domConverter;
        for (const [ viewBar, { element, scrollableBar } ] of this.bars) {
            if (domConverter.mapViewToDom(viewBar) !== element) {
                scrollableBar.disconnect();
                this.bars.delete(viewBar);
                this.newBars.add(viewBar);
            }
        }

        for (const viewBar of this.newBars) {
            const element = domConverter.mapViewToDom(viewBar);
            if (element) {
                const viewport = element.querySelector(
                    `:scope > .${SCROLLABLE_BAR_CLASSES.viewport}`) as HTMLElement;
                const scrollableBar = attachScrollableBar(element, viewport);
                this.bars.set(viewBar, { element, scrollableBar });
            }
        }
        this.newBars.clear();
    }

    private revealPendingTitles() {
        const domConverter = this.editor.editing.view.domConverter;
        for (const title of this.pendingReveals) {
            const domTitle = domConverter.mapViewToDom(title);
            const bar = this.bars.get(title.parent?.parent as ViewElement);
            /* v8 ignore next 3 -- only a title that left the view before the render has neither */
            if (domTitle && bar) {
                bar.scrollableBar.reveal(domTitle);
            }
        }
        this.pendingReveals.clear();
    }

}

interface AttachedBar {
    /** The DOM element that the view bar rendered to when it started scrolling. */
    element: HTMLElement;
    scrollableBar: ScrollableBar;
}

/** An edge of the title bar with its scroll button, drawn by the scrollable bar module. */
function createEdge(writer: ViewDowncastWriter, edge: ScrollableBarEdge, label: string) {
    return writer.createUIElement("div", undefined, domDocument =>
        createScrollableBarEdge(domDocument, edge, label));
}

function isSection(node: ViewNode): node is ViewElement {
    return node.is("element", "section") && node.hasClass(CLASSES.tab);
}

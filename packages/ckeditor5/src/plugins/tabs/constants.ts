/** Model element names of the tabs block. */
export const ELEMENTS = {
    tabs: "tabs",
    tab: "tab",
    tabTitle: "tabTitle",
    tabPanel: "tabPanel"
} as const;

/** CSS classes of the saved HTML and of the editing and read-only views. */
export const CLASSES = {
    tabs: "trilium-tabs",
    tab: "trilium-tab",
    tabTitle: "trilium-tab-title",
    tabPanel: "trilium-tab-panel",
    activeTab: "trilium-tab--active",
    activeTitle: "trilium-tab-title--active",
    titleBar: "trilium-tabs-bar"
} as const;

/** Custom property that marks the editing-view widget element of a tabs block. */
export const TABS_WIDGET_PROPERTY = "tabsWidget";

/** Model attribute with the side of the panels that the titles of a tabs block sit on. */
export const ALIGNMENT_ATTRIBUTE = "tabAlignment";
export const ALIGNMENT_DATA_ATTRIBUTE = "data-trilium-tab-alignment";

/** The sides the titles can sit on. A block without the attribute uses the first one. */
export const TAB_ALIGNMENTS = ["top", "bottom"] as const;
export type TabAlignment = typeof TAB_ALIGNMENTS[number];
export const DEFAULT_TAB_ALIGNMENT: TabAlignment = TAB_ALIGNMENTS[0];

/** Returns `value` when it names a tab alignment, or `null` otherwise. */
export function parseTabAlignment(value: unknown): TabAlignment | null {
    return TAB_ALIGNMENTS.find(alignment => alignment === value) ?? null;
}

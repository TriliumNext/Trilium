/** Model element names of the tabs block. */
export const ELEMENTS = {
    tabs: "tabs",
    tab: "tab",
    tabTitle: "tabTitle",
    tabPanel: "tabPanel"
} as const;

/** CSS classes of the saved HTML and the editing view. */
export const CLASSES = {
    tabs: "trilium-tabs",
    tab: "trilium-tab",
    tabTitle: "trilium-tab-title",
    tabPanel: "trilium-tab-panel",
    activeTab: "trilium-tab--active"
} as const;

/** Custom property that marks the editing-view widget element of a tabs block. */
export const TABS_WIDGET_PROPERTY = "tabsWidget";

/** The model attribute of a collapsed heading. */
export const HEADING_COLLAPSED = "headingCollapsed";

/** The attribute that saves the collapsed state on the heading element. */
export const COLLAPSED_DATA_ATTRIBUTE = "data-trilium-collapsed";

export const CLASSES = {
    /** A heading that can hide the blocks after it. It keeps room for its arrow at its end. */
    sectionHeading: "trilium-section-heading",
    /** A section heading under the pointer, which shows its arrow. */
    hovered: "trilium-heading-hovered",
    /** A section heading with the caret in it, which shows its arrow. */
    selected: "trilium-heading-selected",
    /** A section heading whose arrow is under the pointer. */
    arrowHovered: "trilium-heading-arrow-hovered",
    /** A collapsed heading in content shown outside an editor. */
    collapsed: "trilium-heading-collapsed",
    /** A block hidden by a collapsed heading in content shown outside an editor. */
    hidden: "trilium-heading-section-hidden"
};

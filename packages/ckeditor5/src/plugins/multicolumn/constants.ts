/** Model element names of the multicolumn layout. */
export const ELEMENTS = {
    layout: "multicolumnLayout",
    column: "multicolumnColumn"
} as const;

/** Model attribute with the column weights of a layout, such as `1-3`. */
export const RATIOS_ATTRIBUTE = "columnRatios";

export const LAYOUT_CLASS = "trilium-multicolumn-layout";
export const RATIOS_DATA_ATTRIBUTE = "data-trilium-column-ratios";

/** Custom property that marks the editing-view widget element of a layout. */
export const LAYOUT_WIDGET_PROPERTY = "multicolumnLayoutWidget";

/** The column weights a layout can use. The first entry of each column count is its default. */
export const COLUMN_RATIOS: readonly string[] = ["1-1", "1-3", "3-1", "1-1-1", "1-2-1", "1-1-1-1"];

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

/** Returns the number of columns that `ratios` describes. */
export function getColumnCount(ratios: string): number {
    return ratios.split("-").length;
}

/** Returns the default weights for `count` columns, or the first entry for an unsupported count. */
export function getDefaultRatios(count: number): string {
    return COLUMN_RATIOS.find(ratios => getColumnCount(ratios) === count) ?? COLUMN_RATIOS[0];
}

import FNote from "../../entities/fnote";

export const allViewTypes = ["list", "grid", "calendar", "table", "geoMap", "board", "presentation"] as const;
export type ViewTypeOptions = typeof allViewTypes[number];

export interface ViewModeProps<T extends object> {
    note: FNote;
    notePath: string;
    /**
     * We're using noteIds so that it's not necessary to load all notes at once when paging.
     */
    noteIds: string[];
    highlightedTokens: string[] | null | undefined;
    viewConfig: T | undefined;
    saveConfig(newConfig: T): void;
}

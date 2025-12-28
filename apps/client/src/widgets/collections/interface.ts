import FNote from "../../entities/fnote";
import type { PrintReport } from "../../print";

export const allViewTypes = ["list", "grid", "calendar", "table", "geoMap", "board", "presentation"] as const;
export type ViewTypeOptions = typeof allViewTypes[number];

export type ViewModeMedia = "screen" | "print";

export type ProgressChangedFn = (progress: number) => void;

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
    media: ViewModeMedia;
    onReady(data: PrintReport): void;
    onProgressChanged?: ProgressChangedFn;
}

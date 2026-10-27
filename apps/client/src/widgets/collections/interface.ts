import type { HighlightedTokenInfo } from "@triliumnext/commons";

import FNote from "../../entities/fnote";
import type { PrintReport } from "../../print";

export const allViewTypes = ["list", "searchPreview", "grid", "calendar", "table", "geoMap", "board", "presentation", "dashboard"] as const;
export type ViewTypeOptions = typeof allViewTypes[number];

export type ViewModeMedia = "screen" | "print";

/** Whether `value` names a view type this client can draw. */
export function isViewType(value: string | null | undefined): value is ViewTypeOptions {
    return (allViewTypes as readonly string[]).includes(value ?? "");
}

/**
 * The view a note shows: its `#viewType` label where the view applies to that note, otherwise the
 * default for the note's type. The search preview draws result details fetched for a saved search,
 * so it is limited to search notes.
 */
export function resolveViewType(
    note: Pick<FNote, "type"> | null | undefined,
    viewType: string | null | undefined
): ViewTypeOptions | undefined {
    if (!note) {
        return undefined;
    }

    const defaultViewType = note.type === "search" ? "searchPreview" : "grid";
    if (!isViewType(viewType)) {
        return defaultViewType;
    }

    return viewType === "searchPreview" && note.type !== "search" ? defaultViewType : viewType;
}

export type ProgressChangedFn = (progress: number) => void;

export interface ViewModeProps<T extends object> {
    note: FNote;
    notePath: string;
    /**
     * We're using noteIds so that it's not necessary to load all notes at once when paging.
     */
    noteIds: string[];
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined;
    /** The tab the view is drawn in, for events that must answer only their own context. */
    ntxId?: string | null;
    viewConfig: T | undefined;
    saveConfig(newConfig: T): void;
    media: ViewModeMedia;
    onReady(data: PrintReport): void;
    onProgressChanged?: ProgressChangedFn;
    showTextRepresentation?: boolean;
    /** Opens a note the view selects, in place of the view's own way, such as the map's detail pane. */
    onOpenNote?: (noteId: string) => void;
}

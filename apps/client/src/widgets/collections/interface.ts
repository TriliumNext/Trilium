import FNote from "../../entities/fnote";
import type { ViewModeArgs } from "../view_widgets/view_mode";

export const allViewTypes = ["list", "grid", "calendar", "table", "geoMap", "board"] as const;
export type ArgsWithoutNoteId = Omit<ViewModeArgs, "noteIds">;
export type ViewTypeOptions = typeof allViewTypes[number];

export interface ViewModeProps {
    note: FNote;
    /**
     * We're using noteIds so that it's not necessary to load all notes at once when paging.
     */
    noteIds: string[];
    highlightedTokens: string[] | null | undefined;
}

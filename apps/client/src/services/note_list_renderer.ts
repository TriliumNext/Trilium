import type FNote from "../entities/fnote.js";
import CalendarView from "../widgets/view_widgets/calendar_view.js";
import ListOrGridView from "../widgets/view_widgets/list_or_grid_view.js";
import TableView from "../widgets/view_widgets/table_view/index.js";
import type { ViewModeArgs } from "../widgets/view_widgets/view_mode.js";
import type ViewMode from "../widgets/view_widgets/view_mode.js";

export type ViewTypeOptions = "list" | "grid" | "calendar" | "table";

export default class NoteListRenderer {

    private viewType: ViewTypeOptions;
    public viewMode: ViewMode<any> | null;

    constructor(args: ViewModeArgs) {
        this.viewType = this.#getViewType(args.parentNote);

        switch (this.viewType) {
            case "list":
            case "grid":
                this.viewMode = new ListOrGridView(this.viewType, args);
                break;
            case "calendar":
                this.viewMode = new CalendarView(args);
                break;
            case "table":
                this.viewMode = new TableView(args);
                break;
            default:
                this.viewMode = null;
        }
    }

    #getViewType(parentNote: FNote): ViewTypeOptions {
        const viewType = parentNote.getLabelValue("viewType");

        if (!["list", "grid", "calendar", "table"].includes(viewType || "")) {
            // when not explicitly set, decide based on the note type
            return parentNote.type === "search" ? "list" : "grid";
        } else {
            return viewType as ViewTypeOptions;
        }
    }

    get isFullHeight() {
        return this.viewMode?.isFullHeight;
    }

    async renderList() {
        if (!this.viewMode) {
            return null;
        }

        return await this.viewMode.renderList();
    }

}

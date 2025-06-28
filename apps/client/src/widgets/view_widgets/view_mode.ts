import type { EventData } from "../../components/app_context.js";
import Component from "../../components/component.js";
import type FNote from "../../entities/fnote.js";
import type { ViewTypeOptions } from "../../services/note_list_renderer.js";
import ViewModeStorage from "./view_mode_storage.js";

export interface ViewModeArgs {
    $parent: JQuery<HTMLElement>;
    parentNote: FNote;
    parentNotePath: string | null | undefined;
    noteIds: string[];
    showNotePath?: boolean;
}

export default abstract class ViewMode<T extends object> extends Component {

    private _viewStorage: ViewModeStorage<T> | null;
    protected parentNote: FNote;
    protected viewType: ViewTypeOptions;

    constructor(args: ViewModeArgs, viewType: ViewTypeOptions) {
        super();
        this.parentNote = args.parentNote;
        this._viewStorage = null;
        // note list must be added to the DOM immediately, otherwise some functionality scripting (canvas) won't work
        args.$parent.empty();
        this.viewType = viewType;
    }

    abstract renderList(): Promise<JQuery<HTMLElement> | undefined>;

    /**
     * Called whenever an "entitiesReloaded" event has been received by the parent component.
     *
     * @param e the event data.
     * @return {@code true} if the view should be re-rendered, a falsy value otherwise.
     */
    onEntitiesReloaded(e: EventData<"entitiesReloaded">): boolean | void {
        // Do nothing by default.
    }

    get isFullHeight() {
        // Override to change its value.
        return false;
    }

    get viewStorage() {
        if (this._viewStorage) {
            return this._viewStorage;
        }

        this._viewStorage = new ViewModeStorage(this.parentNote, this.viewType);
        return this._viewStorage;
    }

}

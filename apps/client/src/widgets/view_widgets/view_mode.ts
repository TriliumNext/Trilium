import type { EventData } from "../../components/app_context.js";
import appContext from "../../components/app_context.js";
import Component from "../../components/component.js";
import type FNote from "../../entities/fnote.js";
import { ViewTypeOptions } from "../collections/interface.js";
import ViewModeStorage from "./view_mode_storage.js";

export interface ViewModeArgs {
    $parent: JQuery<HTMLElement>;
    parentNote: FNote;
    parentNotePath?: string | null;
    showNotePath?: boolean;
}

export default abstract class ViewMode<T extends object> extends Component {

    private _viewStorage: ViewModeStorage<T> | null;
    protected parentNote: FNote;
    protected viewType: ViewTypeOptions;
    protected noteIds: string[];
    protected args: ViewModeArgs;

    constructor(args: ViewModeArgs, viewType: ViewTypeOptions) {
        super();
        this.parentNote = args.parentNote;
        this._viewStorage = null;
        // note list must be added to the DOM immediately, otherwise some functionality scripting (canvas) won't work
        args.$parent.empty();
        this.viewType = viewType;
        this.args = args;
        this.noteIds = [];
    }

    async beforeRender() {
        await this.#refreshNoteIds();
    }

    abstract renderList(): Promise<JQuery<HTMLElement> | undefined>;

    /**
     * Called whenever an "entitiesReloaded" event has been received by the parent component.
     *
     * @param e the event data.
     * @return {@code true} if the view should be re-rendered, a falsy value otherwise.
     */
    async onEntitiesReloaded(e: EventData<"entitiesReloaded">): Promise<boolean | void> {
        // Do nothing by default.
    }

    async entitiesReloadedEvent(e: EventData<"entitiesReloaded">) {
        if (await this.onEntitiesReloaded(e)) {
            appContext.triggerEvent("refreshNoteList", { noteId: this.parentNote.noteId });
        }
    }

}

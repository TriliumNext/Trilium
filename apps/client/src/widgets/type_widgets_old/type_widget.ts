import NoteContextAwareWidget from "../note_context_aware_widget.js";
import appContext, { type EventData, type EventNames } from "../../components/app_context.js";
import type FNote from "../../entities/fnote.js";
import type NoteDetailWidget from "../note_detail.js";
import type SpacedUpdate from "../../services/spaced_update.js";
import type EmptyTypeWidget from "./empty.js";

/**
 * The base class for all the note types.
 */
export default abstract class TypeWidget extends NoteContextAwareWidget {

    spacedUpdate!: SpacedUpdate;

    // for overriding
    static getType() {}

    doRender() {
        return super.doRender();
    }

    doRefresh(note: FNote): void | Promise<void> {}

    async refresh() {
        const thisWidgetType = (this.constructor as any).getType();
        const noteWidgetType = await (this.parent as NoteDetailWidget).getWidgetType();

        if (thisWidgetType !== noteWidgetType) {
            this.toggleInt(false);

            this.cleanup();
        } else {
            this.toggleInt(true);

            // Avoid passing nullable this.note down to doRefresh().
            if (thisWidgetType !== "empty" && this.note) {
                await this.doRefresh(this.note);
            } else if (thisWidgetType === "empty") {
                // EmptyTypeWidget is a special case, since it's used for a new tab where there's no note.
                await (this as unknown as EmptyTypeWidget).doRefresh();
            }

            this.triggerEvent("noteDetailRefreshed", { ntxId: this.noteContext?.ntxId });
        }
    }

    isActive() {
        return this.$widget.is(":visible") && this.noteContext?.ntxId === appContext.tabManager.activeNtxId;
    }

    /** @returns {Promise<Object>|*} promise resolving note data. Note data is an object with content. */
    getData() {}

    focus() {}

    scrollToEnd() {
        // Do nothing by default.
    }

    dataSaved() {
        // Do nothing by default.
    }

    /**
     * {@inheritdoc}
     *
     * By default:
     *
     * - `activeContextChanged` is intercepted and converted to a `setNoteContext` event to avoid `refresh()`.
     * - `entitiesReloaded` and `refreshData` are passed as-is.
     * - any other event is not passed to the children.
     */
    handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>) {
        if (["activeContextChanged", "setNoteContext"].includes(name)) {
            // won't trigger .refresh();
            return super.handleEventInChildren("setNoteContext", data as EventData<"activeContextChanged">);
        } else if (name === "entitiesReloaded" || name === "refreshData") {
            return super.handleEventInChildren(name, data);
        } else {
            return Promise.resolve();
        }
    }

    cleanup(): void {
        super.cleanup();
    }
}

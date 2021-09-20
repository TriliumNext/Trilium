import NoteContextAwareWidget from "../note_context_aware_widget.js";

export default class TypeWidget extends NoteContextAwareWidget {
    // for overriding
    static getType() {}

    doRender() {
        this.contentSized();

        return super.doRender();
    }

    /**
     * @param {NoteShort} note
     */
    async doRefresh(note) {}

    async refresh() {
        const thisWidgetType = this.constructor.getType();
        const noteWidgetType = await this.parent.getWidgetType();

        if (thisWidgetType !== noteWidgetType) {
            this.toggleInt(false);

            this.cleanup();
        }
        else {
            this.toggleInt(true);

            await this.doRefresh(this.note);

            this.triggerEvent('noteDetailRefreshed', {ntxId: this.noteContext.ntxId});
        }
    }

    isActive() {
        return this.$widget.is(":visible");
    }

    getContent() {}

    focus() {}

    async readOnlyTemporarilyChangedEvent({noteContext}) {
        if (this.isNoteContext(noteContext.ntxId)) {
            await this.refresh();

            this.focus();
        }
    }
}

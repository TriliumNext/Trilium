import TypeWidget from "./type_widget.js";

const TPL = `
<div class="note-detail-mind-map note-detail-printable">
</div>
`;

export default class MindMapWidget extends TypeWidget {
    static getType() { return "mindMap"; }

    doRender() {
        this.$widget = $(TPL);

        super.doRender();
    }

    async doRefresh(note) {
        this.$widget.html("<p>Hello</p>");
        this.$widget.show();
    }

    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteReloaded(this.noteId)) {
            this.refresh();
        }
    }
}
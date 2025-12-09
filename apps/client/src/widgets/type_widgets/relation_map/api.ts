import { Connection } from "jsplumb";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import utils from "../../../services/utils";
import { RelationMapRelation } from "@triliumnext/commons";
import toast from "../../../services/toast";

export interface MapDataNoteEntry {
    noteId: string;
    x: number;
    y: number;
}

export interface MapData {
    notes: MapDataNoteEntry[];
    transform: PanZoomTransform;
}

export type RelationType = "uniDirectional" | "biDirectional" | "inverse";

export interface ClientRelation extends RelationMapRelation {
    type: RelationType;
    render: boolean;
}

const DELTA = 0.0001;

export default class RelationMapApi {

    private data: MapData;
    private relations: ClientRelation[];
    private onDataChange: (refreshUi: boolean) => void;

    constructor(note: FNote, initialMapData: MapData, onDataChange: (newData: MapData, refreshUi: boolean) => void) {
        this.data = initialMapData;
        this.onDataChange = (refreshUi) => onDataChange({ ...this.data }, refreshUi);
        this.relations = [];
    }

    loadRelations(relations: ClientRelation[]) {
        this.relations = relations;
    }

    createItem(newNote: MapDataNoteEntry) {
        this.data.notes.push(newNote);
        this.onDataChange(true);
    }

    async removeItem(noteId: string, deleteNoteToo: boolean) {
        console.log("Remove ", noteId, deleteNoteToo);
        if (deleteNoteToo) {
            const taskId = utils.randomString(10);
            await server.remove(`notes/${noteId}?taskId=${taskId}&last=true`);
        }

        if (this.data) {
            this.data.notes = this.data.notes.filter((note) => note.noteId !== noteId);
        }

        if (this.relations) {
            this.relations = this.relations.filter((relation) => relation.sourceNoteId !== noteId && relation.targetNoteId !== noteId);
        }

        this.onDataChange(true);
    }

    async removeRelation(connection: Connection) {
        const relation = this.relations.find((rel) => rel.attributeId === connection.id);

        if (relation) {
            await server.remove(`notes/${relation.sourceNoteId}/relations/${relation.name}/to/${relation.targetNoteId}`);
        }

        this.onDataChange(true);
    }

    cleanupOtherNotes(noteIds: string[]) {
        const filteredNotes = this.data.notes.filter((note) => noteIds.includes(note.noteId));
        if (filteredNotes.length === this.data.notes.length) return;
        this.data.notes = filteredNotes;
        this.onDataChange(true);
    }

    setTransform(transform: PanZoomTransform) {
        if (this.data.transform.scale - transform.scale > DELTA
            || this.data.transform.x - transform.x > DELTA
            || this.data.transform.y - transform.y > DELTA) {
            this.data.transform = { ...transform };
            this.onDataChange(false);
        }
    }

    moveNote(noteId: string, x: number, y: number) {
        const note = this.data?.notes.find((note) => note.noteId === noteId);

        if (!note) {
            logError(t("relation_map.note_not_found", { noteId }));
            return;
        }

        note.x = x;
        note.y = y;
        this.onDataChange(false);
    }

    addMultipleNotes(entries: (MapDataNoteEntry & { title: string })[]) {
        if (!entries.length) return;

        for (const entry of entries) {
            const exists = this.data.notes.some((n) => n.noteId === entry.noteId);

            if (exists) {
                toast.showError(t("relation_map.note_already_in_diagram", { title: entry.title }));
                continue;
            }

            this.data.notes.push(entry);
        }

        this.onDataChange(true);
    }

    async connect(name: string, sourceNoteId: string, targetNoteId: string) {
        name = utils.filterAttributeName(name);
        const relationExists = this.relations?.some((rel) => rel.targetNoteId === targetNoteId && rel.sourceNoteId === sourceNoteId && rel.name === name);

        if (relationExists) return false;
        await server.put(`notes/${sourceNoteId}/relations/${name}/to/${targetNoteId}`);
        this.onDataChange(true);
        return true;
    }

}

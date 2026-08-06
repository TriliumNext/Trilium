import { Connection } from "jsplumb";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { deleteNoteOrBranch } from "../../../services/note_deletion";
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
    private mapNote: FNote;

    constructor(note: FNote, initialMapData: MapData, onDataChange: (newData: MapData, refreshUi: boolean) => void) {
        this.data = initialMapData;
        this.onDataChange = (refreshUi) => onDataChange({ ...this.data }, refreshUi);
        this.relations = [];
        this.mapNote = note;
    }

    /**
     * The given note's branch under this map, where the map is one of the places it hangs.
     *
     * A map holds notes of two kinds and only looks like it holds one: the notes it made itself hang
     * under it in the tree (see `useNoteCreation` in RelationMap.tsx), while the notes dragged onto
     * it live wherever they lived and are merely named in the map's content. So there is a branch of
     * ours to remove for the first and none at all for the second, which is the whole difference
     * between removing a placement and deleting a note.
     */
    branchIdFor(noteId: string) {
        return froca.getNoteFromCache(noteId)?.parentToBranch[this.mapNote.noteId] ?? null;
    }

    loadRelations(relations: ClientRelation[]) {
        this.relations = relations;
    }

    createItem(newNote: MapDataNoteEntry) {
        this.data.notes.push(newNote);
        this.onDataChange(true);
    }

    /**
     * Takes the note off the map, and out of the tree as well where asked.
     *
     * Which of the two deletions that second half is — the map's placement of the note, or the note
     * itself — is `deleteFromTree`'s business no more than it is the reader's: the branch decides it
     * (see {@link branchIdFor}), and `deleteNoteOrBranch` reads the same branch the dialog read when
     * it told the reader what ticking the box would cost.
     */
    async removeItem(noteId: string, deleteFromTree: boolean) {
        if (deleteFromTree) {
            await deleteNoteOrBranch(noteId, this.branchIdFor(noteId));
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

    async renameRelation(connection: Connection, newName: string) {
        newName = utils.filterAttributeName(newName);
        const relation = this.relations.find((rel) => rel.attributeId === connection.id);

        if (!relation) return false;

        // Check if a relation with the new name already exists between these notes.
        const exists = this.relations.some(
            (rel) => rel.sourceNoteId === relation.sourceNoteId && rel.targetNoteId === relation.targetNoteId && rel.name === newName
        );
        if (exists) return false;

        await server.put(`notes/${relation.sourceNoteId}/relations/${newName}/to/${relation.targetNoteId}`);
        await server.remove(`notes/${relation.sourceNoteId}/relations/${relation.name}/to/${relation.targetNoteId}`);
        this.onDataChange(true);
        return true;
    }

    getRelationName(connection: Connection): string | undefined {
        const relation = this.relations.find((rel) => rel.attributeId === connection.id);
        return relation?.name;
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

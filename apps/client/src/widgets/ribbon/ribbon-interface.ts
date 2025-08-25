import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";

export interface TabContext {
    note: FNote | null | undefined;
    hidden: boolean;
    ntxId?: string | null;
    hoistedNoteId?: string;
    notePath?: string | null;
    noteContext?: NoteContext;
    componentId: string;
}

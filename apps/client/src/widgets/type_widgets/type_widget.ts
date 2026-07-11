import FNote from "../../entities/fnote";
import { ViewScope } from "../../services/link";
import { TypedComponent } from "../../components/component";
import NoteContext from "../../components/note_context";

export interface TypeWidgetProps {
    note: FNote;
    viewScope: ViewScope | undefined;
    ntxId: string | null | undefined;
    parentComponent: TypedComponent<any> | undefined;
    noteContext: NoteContext | undefined;
    /** Whether this is the displayed type widget for its context; false when cached/hidden after the note's type changed. */
    isVisible?: boolean;
}

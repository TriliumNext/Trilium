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
}

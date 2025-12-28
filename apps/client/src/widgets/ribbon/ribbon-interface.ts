import { KeyboardActionNames } from "@triliumnext/commons";
import { VNode } from "preact";

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
    activate(): void;
}

export interface TitleContext {
    note: FNote | null | undefined;
    noteContext: NoteContext | undefined;
}

export interface TabConfiguration {
    title: string | ((context: TitleContext) => string);
    icon: string;
    content: (context: TabContext) => VNode | false;
    show: boolean | ((context: TitleContext) => Promise<boolean | null | undefined> | boolean | null | undefined);
    toggleCommand?: KeyboardActionNames;
    activate?: boolean | ((context: TitleContext) => boolean);
    /**
     * By default the tab content will not be rendered unless the tab is active (i.e. selected by the user). Setting to `true` will ensure that the tab is rendered even when inactive, for cases where the tab needs to be accessible at all times (e.g. for the detached editor toolbar) or if event handling is needed.
     */
    stayInDom?: boolean;
}

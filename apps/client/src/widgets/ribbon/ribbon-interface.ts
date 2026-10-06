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
}

export async function shouldShowTab(showConfig: TabConfiguration["show"], context: TitleContext) {
    if (showConfig === null || showConfig === undefined) return true;
    if (typeof showConfig === "boolean") return showConfig;
    if ("then" in showConfig) return await showConfig(context);
    return showConfig(context);
}

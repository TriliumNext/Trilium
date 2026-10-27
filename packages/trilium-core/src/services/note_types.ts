import { ALLOWED_NOTE_TYPES, isNoteType, type NoteType } from "@triliumnext/commons";

const DEFAULT_MIMES: Record<NoteType, string> = {
    text: "text/html",
    code: "text/plain",
    render: "",
    file: "application/octet-stream",
    image: "",
    search: "",
    relationMap: "application/json",
    book: "",
    noteMap: "",
    mermaid: "text/vnd.mermaid",
    canvas: "application/json",
    webView: "",
    launcher: "",
    doc: "",
    contentWidget: "",
    mindMap: "application/json",
    spreadsheet: "application/json",
    llmChat: "application/json"
};

function getDefaultMimeForNoteType(typeName: string) {
    if (!isNoteType(typeName)) {
        throw new Error(`Cannot find note type '${typeName}'`);
    }

    return DEFAULT_MIMES[typeName];
}

export default {
    getNoteTypeNames: (): string[] => [...ALLOWED_NOTE_TYPES],
    getDefaultMimeForNoteType
};

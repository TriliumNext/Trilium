import { NoteType } from "@triliumnext/commons";
import FNote from "../entities/fnote";
import { ViewTypeOptions } from "../widgets/collections/interface";

export const byNoteType: Record<Exclude<NoteType, "book">, string | null> = {
    canvas: null,
    code: null,
    contentWidget: null,
    doc: null,
    file: null,
    image: null,
    launcher: null,
    mermaid: "s1aBHPd79XYj",
    mindMap: null,
    noteMap: null,
    relationMap: null,
    render: null,
    search: null,
    text: null,
    webView: null
};

export const byBookType: Record<ViewTypeOptions, string | null> = {
    list: "mULW0Q3VojwY",
    grid: "8QqnMzx393bx",
    calendar: "xWbu3jpNWapp",
    table: "2FvYrpmOXm29",
    geoMap: "81SGnPGMk7Xc",
    board: "CtBQqbwXDx1w",
    presentation: null
};

export function getHelpUrlForNote(note: FNote | null | undefined) {
    if (note && note.type !== "book" && byNoteType[note.type]) {
        return byNoteType[note.type];
    } else if (note?.hasLabel("calendarRoot")) {
        return "l0tKav7yLHGF";
    } else if (note?.hasLabel("textSnippet")) {
        return "pwc194wlRzcH";
    } else if (note && note.type === "book") {
        return byBookType[note.getAttributeValue("label", "viewType") as ViewTypeOptions ?? ""]
    }
}

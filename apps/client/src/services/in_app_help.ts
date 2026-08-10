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
    webView: null,
    spreadsheet: null,
    llmChat: null
};

export const byBookType: Record<ViewTypeOptions, string | null> = {
    list: "mULW0Q3VojwY",
    grid: "8QqnMzx393bx",
    calendar: "xWbu3jpNWapp",
    table: "2FvYrpmOXm29",
    geoMap: "81SGnPGMk7Xc",
    board: "CtBQqbwXDx1w",
    presentation: "zP3PMqaG71Ct",
    dashboard: "IF7Q6I9x7zuw"
};

/** In-app help note describing labels and relations. */
export const ATTRIBUTE_HELP_PAGE = "zEY4DaJG4YT5";

/** What one card of the right sidebar offers when its `?` is pressed. */
export interface SidebarSectionHelp {
    /** In-app help note the "Open help page" link at the foot of the popup goes to. */
    helpPage: string;
    /** Translation keys of the explanation shown in place, a paragraph each. */
    paragraphs: string[];
}

/**
 * The help each card of the right sidebar carries, keyed by the card's widget id: a section gains a
 * `?` in its header by being named here and rendering a `SidebarHelp` beside its other buttons.
 *
 * The help belongs to the card rather than to the pane or the tab, because the cards answer unrelated
 * questions — what is drawn on the map, why a note has two paths, what counts as a backlink — and each
 * has an in-app help page of its own. A single `?` beside the pane's close button would have to stand
 * for whichever tab happens to be on show, and then pick one of those pages out of several.
 */
export const bySidebarSection = {
    attributes: {
        helpPage: ATTRIBUTE_HELP_PAGE,
        paragraphs: [ "sidebar_help.attributes_what", "sidebar_help.attributes_inheritable" ]
    },
    "attributes-inherited": {
        // Attribute Inheritance, covering both ways one reaches a note it isn't set on.
        helpPage: "bwZpz2ajCEwO",
        paragraphs: [ "sidebar_help.attributes_inherited_what", "sidebar_help.attributes_inherited_source" ]
    },
    "attributes-definitions": {
        // Promoted Attributes, where a definition is set out and what promoting it does.
        helpPage: "OFXdgB2nNk1F",
        paragraphs: [ "sidebar_help.attributes_definitions_what", "sidebar_help.attributes_definitions_promoted" ]
    },
    highlights: {
        // Outline tab, which is where the highlights list is written up — its own page is a redirect
        // to that one.
        helpPage: "2dcGDhp9WFKb",
        paragraphs: [ "sidebar_help.highlights_what", "sidebar_help.highlights_configure" ]
    },
    noteMap: {
        // Note Map (Link map, Tree map).
        helpPage: "BCkXAVs63Ttv",
        paragraphs: [ "sidebar_help.note_map_what", "sidebar_help.note_map_interaction" ]
    },
    notePaths: {
        // Cloning Notes, which is what a second path amounts to.
        helpPage: "IakOLONlIfGI",
        paragraphs: [ "sidebar_help.note_paths_what", "sidebar_help.note_paths_cloning" ]
    },
    backlinks: {
        // Backlinks, covering both kinds one can come from.
        helpPage: "wfGXLmm7x27z",
        paragraphs: [ "sidebar_help.backlinks_what", "sidebar_help.backlinks_listing" ]
    },
    similarNotes: {
        // Similar Notes.
        helpPage: "xWtq5NUHOwql",
        paragraphs: [ "sidebar_help.similar_notes_what", "sidebar_help.similar_notes_how" ]
    }
} satisfies Record<string, SidebarSectionHelp>;

export type SidebarSectionId = keyof typeof bySidebarSection;

export function getHelpUrlForNote(note: FNote | null | undefined) {
    if (note?.isMarkdown()) {
        return "6RM1Q7ppFVoj";
    } else if (note && note.type !== "book" && byNoteType[note.type]) {
        return byNoteType[note.type];
    } else if (note?.hasLabel("calendarRoot")) {
        return "l0tKav7yLHGF";
    } else if (note?.hasLabel("textSnippet")) {
        return "pwc194wlRzcH";
    } else if (note && note.type === "book") {
        return byBookType[note.getAttributeValue("label", "viewType") as ViewTypeOptions ?? ""];
    }
}

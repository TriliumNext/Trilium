import { t } from "./i18n.js";
import froca from "./froca.js";
import server from "./server.js";
import type { MenuCommandItem, MenuItem, MenuItemBadge, MenuSeparatorItem } from "../menus/context_menu.js";
import type { NoteType } from "../entities/fnote.js";
import type { TreeCommandNames } from "../menus/tree_context_menu.js";

export interface NoteTypeMapping {
    type: NoteType;
    mime?: string;
    title: string;
    icon?: string;
    /** Indicates whether this type should be marked as a newly introduced feature. */
    isNew?: boolean;
    /** Indicates that this note type is part of a beta feature. */
    isBeta?: boolean;
    /** Indicates that this note type cannot be created by the user. */
    reserved?: boolean;
    /** Indicates that once a note of this type is created, its type can no longer be changed. */
    static?: boolean;
}

export const NOTE_TYPES: NoteTypeMapping[] = [
    // The suggested note type ordering method: insert the item into the corresponding group,
    // then ensure the items within the group are ordered alphabetically.

    // The default note type (always the first item)
    { type: "text", mime: "text/html", title: t("note_types.text"), icon: "bx-note" },

    // Text notes group
    { type: "book", mime: "", title: t("note_types.book"), icon: "bx-book" },

    // Graphic notes
    { type: "canvas", mime: "application/json", title: t("note_types.canvas"), icon: "bx-pen" },
    { type: "mermaid", mime: "text/mermaid", title: t("note_types.mermaid-diagram"), icon: "bx-selection" },

    // Map notes
    { type: "mindMap", mime: "application/json", title: t("note_types.mind-map"), icon: "bx-sitemap" },
    { type: "noteMap", mime: "", title: t("note_types.note-map"), icon: "bxs-network-chart", static: true },
    { type: "relationMap", mime: "application/json", title: t("note_types.relation-map"), icon: "bxs-network-chart" },

    // Misc note types
    { type: "render", mime: "", title: t("note_types.render-note"), icon: "bx-extension" },
    { type: "search", title: t("note_types.saved-search"), icon: "bx-file-find", static: true },
    { type: "webView", mime: "", title: t("note_types.web-view"), icon: "bx-globe-alt" },

    // Code notes
    { type: "code", mime: "text/plain", title: t("note_types.code"), icon: "bx-code" },

    // Reserved types (cannot be created by the user)
    { type: "contentWidget", mime: "", title: t("note_types.widget"), reserved: true },
    { type: "doc", mime: "", title: t("note_types.doc"), reserved: true },
    { type: "file", title: t("note_types.file"), reserved: true },
    { type: "image", title: t("note_types.image"), reserved: true },
    { type: "launcher", mime: "", title: t("note_types.launcher"), reserved: true },
];

/** The maximum age in days for a template to be marked with the "New" badge */
const NEW_TEMPLATE_MAX_AGE = 3;

/** The length of a day in milliseconds. */
const DAY_LENGTH = 1000 * 60 * 60 * 24;

/** The menu item badge used to mark new note types and templates */
const NEW_BADGE: MenuItemBadge = {
    title: t("note_types.new-feature"),
    className: "new-note-type-badge"
};

/** The menu item badge used to mark note types that are part of a beta feature */
const BETA_BADGE = {
    title: t("note_types.beta-feature")
};

const SEPARATOR: MenuSeparatorItem = { kind: "separator" };

const creationDateCache = new Map<string, Date>();
let rootCreationDate: Date | undefined;

async function getNoteTypeItems(command?: TreeCommandNames) {
    const items: MenuItem<TreeCommandNames>[] = [
        ...getBlankNoteTypes(command),
        ...await getBuiltInTemplates(null, command, false),
        ...await getBuiltInTemplates(t("note_types.collections"), command, true),
        ...await getUserTemplates(command)
    ];

    return items;
}

function getBlankNoteTypes(command?: TreeCommandNames): MenuItem<TreeCommandNames>[] {
    return NOTE_TYPES
        .filter((nt) => !nt.reserved && nt.type !== "book")
        .map((nt) => {
            const menuItem: MenuCommandItem<TreeCommandNames> = {
                title: nt.title,
                command,
                type: nt.type,
                uiIcon: "bx " + nt.icon,
                badges: []
            }

            if (nt.isNew) {
                menuItem.badges?.push(NEW_BADGE);
            }

            if (nt.isBeta) {
                menuItem.badges?.push(BETA_BADGE);
            }

            return menuItem;
        });
}

async function getUserTemplates(command?: TreeCommandNames) {
    const templateNoteIds = await server.get<string[]>("search-templates");
    const templateNotes = await froca.getNotes(templateNoteIds);
    if (templateNotes.length === 0) {
        return [];
    }

    const items: MenuItem<TreeCommandNames>[] = [
        {
            title: t("note_type_chooser.templates"),
            kind: "header"
        }
    ];

    for (const templateNote of templateNotes) {
        const item: MenuItem<TreeCommandNames> = {
            title: templateNote.title,
            uiIcon: templateNote.getIcon(),
            command: command,
            type: templateNote.type,
            templateNoteId: templateNote.noteId
        };

        if (await isNewTemplate(templateNote.noteId)) {
            item.badges = [NEW_BADGE];
        }

        items.push(item);
    }
    return items;
}

async function getBuiltInTemplates(title: string | null, command: TreeCommandNames | undefined, filterCollections: boolean) {
    const templatesRoot = await froca.getNote("_templates");
    if (!templatesRoot) {
        console.warn("Unable to find template root.");
        return [];
    }

    const childNotes = await templatesRoot.getChildNotes();
    if (childNotes.length === 0) {
        return [];
    }

    const items: MenuItem<TreeCommandNames>[] = [];
    if (title) {
        items.push({
            title: title,
            kind: "header"
        });
    } else {
        items.push(SEPARATOR);
    }

    for (const templateNote of childNotes) {
        if (templateNote.hasLabel("collection") !== filterCollections ||
            !templateNote.hasLabel("template")) {
            continue;
        }

        const item: MenuItem<TreeCommandNames> = {
            title: templateNote.title,
            uiIcon: templateNote.getIcon(),
            command: command,
            type: templateNote.type,
            templateNoteId: templateNote.noteId
        };

        if (await isNewTemplate(templateNote.noteId)) {
            item.badges = [NEW_BADGE];
        }

        items.push(item);
    }
    return items;
}

async function isNewTemplate(templateNoteId) {
    if (rootCreationDate === undefined) {
        // Retrieve the root note creation date
        try {
            let rootNoteInfo: any = await server.get("notes/root");
            if ("dateCreated" in rootNoteInfo) {
                rootCreationDate = new Date(rootNoteInfo.dateCreated);
            }
        } catch (ex) {
            console.error(ex);
        }
    }

    // Try to retrieve the template's creation date from the cache
    let creationDate: Date | undefined = creationDateCache.get(templateNoteId);

    if (creationDate === undefined) {
        // The creation date isn't available in the cache, try to retrieve it from the server
        try {
            const noteInfo: any = await server.get("notes/" + templateNoteId);
            if ("dateCreated" in noteInfo) {
                creationDate = new Date(noteInfo.dateCreated);
                creationDateCache.set(templateNoteId, creationDate);
            }
        } catch (ex) {
            console.error(ex);
        }
    }

    if (creationDate) {
        if (rootCreationDate && creationDate.getTime() - rootCreationDate.getTime() < 30000) {
            // Ignore templates created within 30 seconds after the root note is created.
            // This is useful to prevent predefined templates from being marked
            // as 'New' after setting up a new database.
            return false;
        }

        // Determine the difference in days between now and the template's creation date
        const age = (new Date().getTime() - creationDate.getTime()) / DAY_LENGTH;
        // Return true if the template is at most NEW_TEMPLATE_MAX_AGE days old
        return (age <= NEW_TEMPLATE_MAX_AGE);
    } else {
        return false;
    }
}

export default {
    getNoteTypeItems
};

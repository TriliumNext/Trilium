import {
    buildNoteTypeId, buildTemplateId, getCodeLanguageIcon, type NoteType as CommonNoteType, type NoteTypeId,
    type TemplatesResponse
} from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import type { NoteType } from "../entities/fnote.js";
import type { MenuCommandItem, MenuItem, MenuItemBadge, MenuSeparatorItem } from "../menus/context_menu.js";
import type { TreeCommandNames } from "../menus/tree_context_menu.js";
import { isExperimentalFeatureEnabled } from "./experimental_features.js";
import { getNotePresetItems } from "./note_presets.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import mimeTypes from "./mime_types.js";
import server from "./server.js";
import { escapeHtml } from "./utils.js";

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

/** The mime carried by the Markdown entry, which shares `type: "code"` with the plain code one. */
export const MARKDOWN_NOTE_TYPE_MIME = "text/x-markdown";

export const NOTE_TYPES: NoteTypeMapping[] = [
    // The suggested note type ordering method: insert the item into the corresponding group,
    // then ensure the items within the group are ordered alphabetically.

    // The default note type (always the first item)
    { type: "text", mime: "text/html", title: t("note_types.text"), icon: "bx-note" },
    { type: "spreadsheet", mime: "application/json", title: t("note_types.spreadsheet"), icon: "bx-table", isBeta: true, isNew: true },

    // Text notes group
    { type: "book", mime: "", title: t("note_types.book"), icon: "bx-book" },

    // Graphic notes
    { type: "canvas", mime: "application/json", title: t("note_types.canvas"), icon: "bx-pen" },
    { type: "mermaid", mime: "text/mermaid", title: t("note_types.mermaid-diagram"), icon: "bx-selection" },

    // Map notes
    { type: "mindMap", mime: "application/json", title: t("note_types.mind-map"), icon: "bx-sitemap" },
    { type: "noteMap", mime: "", title: t("note_types.note-map"), icon: "bxs-network-chart", static: true },
    { type: "relationMap", mime: "application/json", title: t("note_types.relation-map"), icon: "bx-shape-polygon" },

    // Misc note types
    { type: "llmChat", mime: "application/json", title: t("note_types.llm-chat"), icon: "bx-message-square-dots" },
    { type: "render", mime: "", title: t("note_types.render-note"), icon: "bx-extension" },
    { type: "search", title: t("note_types.saved-search"), icon: "bx-file-find", static: true },
    { type: "webView", mime: "", title: t("note_types.web-view"), icon: "bx-globe-alt" },

    // Code notes
    { type: "code", mime: "text/plain", title: t("note_types.code"), icon: "bx-code" },
    { type: "code", mime: MARKDOWN_NOTE_TYPE_MIME, title: t("note_types.markdown"), icon: "bxl-markdown", isNew: true },

    // Reserved types (cannot be created by the user)
    { type: "contentWidget", mime: "", title: t("note_types.widget"), reserved: true },
    { type: "doc", mime: "", title: t("note_types.doc"), reserved: true },
    { type: "file", title: t("note_types.file"), reserved: true },
    { type: "image", title: t("note_types.image"), reserved: true },
    { type: "launcher", mime: "", title: t("note_types.launcher"), reserved: true },
];

/**
 * Whether a {@link NOTE_TYPES} entry names the type `note` already has, so a menu can tick it.
 *
 * Code and Markdown are both `type: "code"`, so comparing types alone marks both of them for any
 * code note; the note's mime is what tells the two entries apart.
 */
export function isCurrentNoteType(entry: Pick<NoteTypeMapping, "type" | "mime">, note: FNote | null | undefined) {
    if (!note || entry.type !== note.type) return false;
    if (entry.type !== "code") return true;
    return note.isMarkdown() === (entry.mime === MARKDOWN_NOTE_TYPE_MIME);
}

/**
 * The entries a note type menu offers, leaving out what the reader cannot create.
 *
 * `withMimeList` says the caller also renders the code MIME list, which already offers Markdown
 * and every other language — so the Markdown entry is dropped and the code entries are left as
 * that list's heading.
 */
export function selectableNoteTypes(withMimeList: boolean) {
    return NOTE_TYPES.filter((nt) => !nt.reserved && !nt.static
        && (nt.type !== "llmChat" || isExperimentalFeatureEnabled("llm"))
        && (!withMimeList || nt.mime !== MARKDOWN_NOTE_TYPE_MIME));
}

/**
 * One thing a new note can be made from: a blank note type, or a note carrying `#template`.
 *
 * Named by a {@link NoteTypeId}, so that a stored choice outlives the list it was picked from and
 * anything offering the choice, a board's card templates included, speaks of it the same way.
 */
export interface NoteTypeOption {
    id: NoteTypeId;
    title: string;
    /** The icon class, `bx` prefix included. */
    icon: string;
    /** Where it stands in a list the reader picks from. */
    group: NoteTypeOptionGroup;
    /** What `createNote` is given to make one. */
    options: { type: NoteType; mime?: string; templateNoteId?: string };
}

export type NoteTypeOptionGroup = "type" | "builtin" | "user";

/**
 * Everything a new note can be made from: the blank note types, the templates the app ships, and
 * the reader's own.
 *
 * The note types are the ones the tree offers to create, so that anything built on this offers to
 * make what the tree offers to make and nothing else.
 */
export async function getNoteTypeOptions(): Promise<NoteTypeOption[]> {
    const { builtInTemplateNotes, userTemplateNotes } = await loadNoteTypeData();

    const types = NOTE_TYPES
        .filter((mapping) => !mapping.reserved && mapping.type !== "book")
        .filter((mapping) => mapping.type !== "llmChat" || isExperimentalFeatureEnabled("llm"))
        .map<NoteTypeOption>((mapping) => ({
            id: buildNoteTypeId(mapping.type as CommonNoteType, mapping.mime),
            title: mapping.title,
            icon: `bx ${mapping.icon ?? "bx-note"}`,
            group: "type",
            options: { type: mapping.type, mime: mapping.mime }
        }));

    return [
        ...types,
        ...templateOptions(
            builtInTemplateNotes.filter((note) => note.hasLabel("template")), "builtin"),
        ...templateOptions(userTemplateNotes, "user")
    ];
}

/**
 * The options named by the given ids, in that order, leaving out what no longer exists.
 *
 * A stored id outlives what it names: a note type can be dropped from the app and a template note
 * deleted. What is gone is left out rather than reported, so a stored list stays usable.
 */
export function resolveNoteTypeOptions(ids: NoteTypeId[], available: NoteTypeOption[]) {
    const byId = new Map(available.map((option) => [ option.id, option ]));
    return ids.flatMap((id) => {
        const option = byId.get(id);
        return option ? [ option ] : [];
    });
}

/** The name of the group an option stands in, for a list the reader picks from. */
export function noteTypeOptionGroupTitle(group: NoteTypeOptionGroup) {
    switch (group) {
        case "type":
            return t("note_types.note-types");
        case "builtin":
            return t("note_types.built-in-templates");
        default:
            return t("note_type_chooser.templates");
    }
}

function templateOptions(notes: FNote[], group: NoteTypeOptionGroup): NoteTypeOption[] {
    return notes.map((note) => ({
        id: buildTemplateId(note.noteId),
        title: note.title,
        icon: note.getIcon(),
        group,
        options: { type: note.type, mime: note.mime, templateNoteId: note.noteId }
    }));
}

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

/**
 * The templates the note type menus are built from. Kept separate from the menu items so that a
 * caller building several menus at once (e.g. the tree context menu, which has both an "insert
 * note after" and an "insert child note" submenu) pays for the requests only once.
 */
export interface NoteTypeData {
    builtInTemplateNotes: FNote[];
    userTemplateNotes: FNote[];
    /** The IDs of the templates to mark with the "New" badge. */
    newTemplates: Set<string>;
}

async function loadNoteTypeData(): Promise<NoteTypeData> {
    // A single request reports both the user templates and which templates are new, so that the
    // menus can be assembled without a round trip per template.
    const { templateNoteIds, newTemplateNoteIds } =
        await server.get<TemplatesResponse>("search-templates");

    const [ builtInTemplateNotes, userTemplateNotes ] = await Promise.all([
        getBuiltInTemplateNotes(),
        froca.getNotes(templateNoteIds)
    ]);

    return { builtInTemplateNotes, userTemplateNotes, newTemplates: new Set(newTemplateNoteIds) };
}

/**
 * The menu of what a new note can be made from, as the note tree's insert menus and the note type
 * chooser offer it: the note types grouped by kind ({@link MENU_GROUPS}), the collections in a
 * submenu, then the user's templates. The "More" submenu holds the rarely created note types, then
 * the templates whose notes the text editor reads: the snippets and, where AI is enabled, the AI
 * quick action.
 */
function buildNoteTypeItems(data: NoteTypeData, command?: TreeCommandNames) {
    const { builtInTemplateNotes, userTemplateNotes, newTemplates } = data;
    const builtIn = (group: BuiltInTemplateGroup) =>
        getBuiltInTemplates(command, builtInTemplateNotes, group, newTemplates);
    const blankTypes = getBlankNoteTypes(command);
    const inGroup = (group: Pick<NoteTypeMapping, "type" | "mime">[]) => group.flatMap(({ type, mime }) => {
        const item = blankTypes.find((blankType) => blankType.type === type && (mime === undefined || blankType.mime === mime));
        if (!item) return [];
        if (type === "code" && mime === "text/plain") item.items = getCodeLanguageItems(command);
        return [ item ];
    });

    const items: MenuItem<TreeCommandNames>[] = [];
    for (const group of MENU_GROUPS) {
        const groupItems = inGroup(group);
        if (groupItems.length === 0) continue;
        if (items.length > 0) items.push(SEPARATOR);
        items.push(...groupItems);
    }

    const collections = builtIn("collection");
    items.push(...withLeading(SEPARATOR, builtIn("other")), SEPARATOR);
    if (collections.length > 0) items.push({ title: t("note_types.book"), uiIcon: "bx bx-book", items: collections });
    const editorTemplates = [
        ...builtIn("snippet"),
        ...(isExperimentalFeatureEnabled("llm") ? builtIn("aiQuickAction") : [])
    ];
    items.push({
        title: t("note_types.more"),
        uiIcon: "bx bx-dots-horizontal-rounded",
        items: [
            ...inGroup(MORE_GROUP),
            ...withLeading(SEPARATOR, editorTemplates)
        ]
    });

    items.push(...getUserTemplates(command, userTemplateNotes, newTemplates));
    return items;
}

/**
 * How the menus order and group the blank note types, each group set apart by a separator. The
 * last group opens from the "More" submenu. A note type in none of them is not offered.
 */
const MENU_GROUPS: Pick<NoteTypeMapping, "type" | "mime">[][] = [
    [ { type: "text" }, { type: "code", mime: MARKDOWN_NOTE_TYPE_MIME }, { type: "code", mime: "text/plain" }, { type: "spreadsheet" }, { type: "llmChat" } ],
    [ { type: "canvas" }, { type: "mermaid" }, { type: "mindMap" }, { type: "relationMap" } ]
];
const MORE_GROUP: Pick<NoteTypeMapping, "type" | "mime">[] = [
    { type: "noteMap" }, { type: "render" }, { type: "search" }, { type: "webView" }
];

/** Builds a single note type menu. Use {@link loadNoteTypeData} directly to build several. */
async function getNoteTypeItems(command?: TreeCommandNames) {
    return buildNoteTypeItems(await loadNoteTypeData(), command);
}

function getBlankNoteTypes(command?: TreeCommandNames): MenuCommandItem<TreeCommandNames>[] {
    return NOTE_TYPES
        .filter((nt) => !nt.reserved && nt.type !== "book")
        .filter((nt) => nt.type !== "llmChat" || isExperimentalFeatureEnabled("llm"))
        .map((nt) => {
            const menuItem: MenuCommandItem<TreeCommandNames> = {
                title: nt.title,
                command,
                type: nt.type,
                mime: nt.mime,
                uiIcon: `bx ${nt.icon}`,
                badges: []
            };

            if (nt.isNew) {
                menuItem.badges?.push(NEW_BADGE);
            }

            if (nt.isBeta) {
                menuItem.badges?.push(BETA_BADGE);
            }

            return menuItem;
        });
}

/**
 * The scripting presets, then the code languages enabled in the code note options, Markdown aside
 * since it has an entry of its own, then a row to configure them. The options are read again each
 * time, so a language enabled since the last menu is offered.
 */
function getCodeLanguageItems(command?: TreeCommandNames): MenuItem<TreeCommandNames>[] {
    mimeTypes.loadMimeTypes();
    const languages = mimeTypes.getMimeTypes()
        .filter((mimeType) => mimeType.enabled && mimeType.mime !== MARKDOWN_NOTE_TYPE_MIME)
        .map<MenuItem<TreeCommandNames>>((mimeType) => ({
            title: escapeHtml(mimeType.title),
            uiIcon: getCodeLanguageIcon(mimeType),
            command,
            type: "code",
            mime: mimeType.mime
        }));

    return [
        ...getNotePresetItems(command),
        SEPARATOR,
        ...languages,
        SEPARATOR,
        {
            title: t("basic_properties.configure_code_notes"),
            uiIcon: "bx bx-cog",
            handler: () => void appContext.triggerCommand("showOptions", { section: "_optionsCodeNotes" })
        }
    ];
}

/**
 * The rows of the built-in templates of `group`, or of the user's own templates for `"user"`, as
 * the note type menu lists them.
 */
function getTemplateItems(data: NoteTypeData, group: BuiltInTemplateGroup | "user", command?: TreeCommandNames) {
    return group === "user"
        ? getUserTemplateRows(command, data.userTemplateNotes, data.newTemplates)
        : getBuiltInTemplates(command, data.builtInTemplateNotes, group, data.newTemplates);
}

function getUserTemplates(command: TreeCommandNames | undefined, templateNotes: FNote[], newTemplates: Set<string>) {
    const header: MenuItem<TreeCommandNames> = { title: t("note_type_chooser.templates"), kind: "header" };
    return withLeading(header, getUserTemplateRows(command, templateNotes, newTemplates));
}

function getUserTemplateRows(command: TreeCommandNames | undefined, templateNotes: FNote[], newTemplates: Set<string>) {
    return templateNotes.map<MenuItem<TreeCommandNames>>((templateNote) => ({
        // A menu renders titles as HTML.
        title: escapeHtml(templateNote.title),
        uiIcon: templateNote.getIcon(),
        command,
        type: templateNote.type,
        templateNoteId: templateNote.noteId,
        ...(newTemplates.has(templateNote.noteId) && { badges: [ NEW_BADGE ] })
    }));
}

async function getBuiltInTemplateNotes() {
    const templatesRoot = await froca.getNote("_templates");
    if (!templatesRoot) {
        console.warn("Unable to find template root.");
        return [];
    }

    return await templatesRoot.getChildNotes();
}

export type BuiltInTemplateGroup = "collection" | "snippet" | "aiQuickAction" | "other";

/** The group of the note type menus a built-in template stands in, told by the labels it carries. */
function builtInTemplateGroup(templateNote: FNote): BuiltInTemplateGroup {
    if (templateNote.hasLabel("collection")) return "collection";
    if (templateNote.hasLabel("snippet") || templateNote.hasLabel("textSnippet")) return "snippet";
    if (templateNote.hasLabel("aiQuickAction")) return "aiQuickAction";
    return "other";
}

function getBuiltInTemplates(command: TreeCommandNames | undefined, childNotes: FNote[], group: BuiltInTemplateGroup, newTemplates: Set<string>) {
    const items: MenuItem<TreeCommandNames>[] = [];

    for (const templateNote of childNotes) {
        if (!templateNote.hasLabel("template") || builtInTemplateGroup(templateNote) !== group) {
            continue;
        }

        const item: MenuItem<TreeCommandNames> = {
            // A menu renders titles as HTML.
            title: escapeHtml(templateNote.title),
            uiIcon: templateNote.getIcon(),
            command,
            type: templateNote.type,
            templateNoteId: templateNote.noteId
        };

        const badges: MenuItemBadge[] = [];
        if (newTemplates.has(templateNote.noteId)) {
            badges.push(NEW_BADGE);
        }
        if (templateNote.hasLabel("beta")) {
            badges.push(BETA_BADGE);
        }
        if (badges.length > 0) {
            item.badges = badges;
        }

        items.push(item);
    }
    return items;
}

/** `items` led by `lead`, or nothing when there are no items to lead. */
function withLeading(lead: MenuItem<TreeCommandNames>, items: MenuItem<TreeCommandNames>[]) {
    return items.length > 0 ? [ lead, ...items ] : [];
}

export default {
    loadNoteTypeData,
    buildNoteTypeItems,
    getNoteTypeItems,
    getCodeLanguageItems,
    getTemplateItems,
    getNoteTypeOptions,
    resolveNoteTypeOptions
};

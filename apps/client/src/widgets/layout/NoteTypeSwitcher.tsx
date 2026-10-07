import "./NoteTypeSwitcher.css";

import { getCodeLanguageIcon, type MimeType, type NoteType } from "@triliumnext/commons";
import { type Dispatch, type StateUpdater, useCallback, useEffect, useMemo, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import type { TreeCommandNames } from "../../menus/tree_context_menu";
import attributes from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import mime_types from "../../services/mime_types";
import { applyNotePreset } from "../../services/note_presets";
import note_types, {
    isCurrentNoteType, MARKDOWN_NOTE_TYPE_MIME, NOTE_TYPES, type NoteTypeData, selectableNoteTypes
} from "../../services/note_types";
import server from "../../services/server";
import { escapeHtml } from "../../services/utils";
import { Badge, BadgeWithDropdown } from "../react/Badge";
import {
    useGetContextDataFrom, useNoteContext, useNoteProperty, useNoteSavedData, useTriliumEvent, useTriliumOption
} from "../react/hooks";
import { MenuItemRows } from "../react/Menu";
import Modal from "../react/Modal";
import { CodeMimeTypesList } from "../type_widgets/options/code_mime_types_list";
import { onWheelHorizontalScroll } from "../widget_utils";

/** The note types offered as a pill of their own, each a single click away. */
const PINNED_NOTE_TYPES: { type: NoteType, mime?: string }[] = [
    { type: "code", mime: MARKDOWN_NOTE_TYPE_MIME },
    { type: "canvas" }
];

export default function NoteTypeSwitcher({ note }: { note?: FNote | null }) {
    const blob = useNoteSavedData(note?.noteId);
    const { noteContext } = useNoteContext();
    // A switch drops the editor's pending save, so the switcher waits for it to land.
    const saveState = useGetContextDataFrom(noteContext, "saveState")?.state;
    const isSaved = !saveState || saveState === "saved";
    const currentNoteType = useNoteProperty(note, "type");
    const currentNoteTypeData = NOTE_TYPES.find(t => t.type === currentNoteType);

    // Code notes fill the pane with their editor and carry no inline title, so the switcher has
    // nowhere to sit above them.
    return (currentNoteType === "text" &&
        <div
            className="note-type-switcher"
            onWheel={onWheelHorizontalScroll}
        >
            {note && blob?.length === 0 && isSaved && (
                <>
                    <div className="intro">{t("note_title.note_type_switcher_label", { type: currentNoteTypeData?.title.toLocaleLowerCase() })}</div>
                    <NoteTypeBadges noteId={note.noteId} />
                </>
            )}
        </div>
    );
}

/**
 * The pills offering what the note can become. Their dropdowns are built from the menu the note
 * tree inserts notes from, so that both offer the same note types and templates, grouped the same
 * way and with the same filter.
 */
export function NoteTypeBadges({ noteId }: { noteId: string }) {
    const data = useNoteTypeData();
    if (!data) return null;

    const userTemplates = note_types.getTemplateItems(data, "user");
    const otherTemplates = note_types.getTemplateItems(data, "other");
    const codeLanguages = toSwitcherItems(note_types.getCodeLanguageItems(), noteId);
    const collections = toSwitcherItems(note_types.getTemplateItems(data, "collection"), noteId);
    const templates = toSwitcherItems(userTemplates.length > 0 && otherTemplates.length > 0
        ? [ ...userTemplates, { kind: "separator" }, ...otherTemplates ]
        : [ ...userTemplates, ...otherTemplates ], noteId);
    const others = toSwitcherItems(note_types.buildNoteTypeItems(data), noteId);

    return (
        <>
            {PINNED_NOTE_TYPES.map(({ type, mime }) => {
                const noteType = NOTE_TYPES.find((nt) => nt.type === type && (mime === undefined || nt.mime === mime));
                return noteType && (
                    <Badge
                        key={`${type}-${mime}`}
                        text={noteType.title}
                        icon={`bx ${noteType.icon}`}
                        onClick={() => switchNoteType(noteId, noteType.type, noteType.mime)}
                    />
                );
            })}
            <BadgeWithDropdown
                text={t("note_types.code")}
                icon="bx bx-code"
                dropdownProps={{ items: codeLanguages, filterable: true }}
            />
            {collections.length > 0 && (
                <BadgeWithDropdown
                    text={t("note_title.note_type_switcher_collection")}
                    icon="bx bx-book"
                    dropdownProps={{ items: collections }}
                />
            )}
            {templates.length > 0 && (
                <BadgeWithDropdown
                    text={t("note_title.note_type_switcher_templates")}
                    icon="bx bx-copy-alt"
                    dropdownProps={{ items: templates, filterable: true }}
                />
            )}
            <BadgeWithDropdown
                text={t("note_title.note_type_switcher_all")}
                icon="bx bx-dots-vertical-rounded"
                dropdownProps={{ items: others, filterable: true }}
            />
        </>
    );
}

/**
 * The templates the switcher's menus are built from, loaded again when a note gains or loses
 * `#template` and after froca reloads, which replaces every `FNote` (e.g. a protected template's
 * title changes once the protected session is entered).
 */
export function useNoteTypeData() {
    const [ data, setData ] = useState<NoteTypeData>();

    function refresh() {
        note_types.loadNoteTypeData().then(setData);
    }

    useEffect(refresh, []);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some(attr => attr.type === "label" && attr.name === "template")) {
            refresh();
        }
    });

    useTriliumEvent("frocaReloaded", refresh);

    return data;
}

/** Blank note types a text note is not switched to: the type it already has, and a saved search. */
const NOT_SWITCHED_TO = new Set<string>([ "text", "search" ]);

/**
 * The note type menu's rows, each switching the note to what it creates: a note type changes the
 * note's type, a template becomes the note's `~template`, a preset sets the type, label and content
 * of its own. A row with a handler of its own keeps it.
 */
export function toSwitcherItems(items: MenuItem<TreeCommandNames>[], noteId: string): MenuItem<unknown>[] {
    return items.flatMap((item): MenuItem<unknown>[] => {
        if ("kind" in item) return item.kind === "actions" ? [] : [ item ];
        const { command, handler, items: subItems, ...rest } = item;
        if (subItems) return [ { ...rest, items: toSwitcherItems(subItems, noteId) } ];
        if (handler) return [ { ...rest, handler: (_, e) => handler(item, e) } ];
        if (!item.templateNoteId && item.type && NOT_SWITCHED_TO.has(item.type)) return [];
        return [ { ...rest, handler: () => void switchTo(noteId, item) } ];
    });
}

function switchTo(
    noteId: string,
    { type, mime, templateNoteId, notePreset }: MenuCommandItem<TreeCommandNames>
) {
    if (templateNoteId) return attributes.setRelation(noteId, "template", templateNoteId);
    if (notePreset) return applyNotePreset(noteId, notePreset);
    if (type) return switchNoteType(noteId, type, mime);
}

function switchNoteType(noteId: string, type: string, mime?: string) {
    return server.put(`notes/${noteId}/type`, { type, mime });
}

interface NoteTypeListProps {
    currentNoteType?: NoteType;
    currentNoteMime?: string | null;
    note?: FNote | null;
    setModalShown: Dispatch<StateUpdater<boolean>>;
    noCodeNotes?: boolean;
}

/** The note types to switch `note` to, as rows of a menu or a list. See {@link useNoteTypeItems}. */
export function NoteTypeDropdownContent(props: NoteTypeListProps) {
    return <MenuItemRows items={useNoteTypeItems(props)} />;
}

/**
 * The note types to switch `note` to, the current one ticked, as menu items: the note types, then,
 * unless {@link NoteTypeListProps.noCodeNotes}, the enabled code languages under a "Code" heading
 * and a row opening their options.
 */
export function useNoteTypeItems({ currentNoteType, currentNoteMime, note, setModalShown, noCodeNotes }: NoteTypeListProps) {
    const { enabledMimeTypes } = useMimeTypes();
    const noteTypes = useMemo(() => selectableNoteTypes(!noCodeNotes), [ noCodeNotes ]);
    const changeNoteType = useCallback(async (type: NoteType, mime?: string) => {
        if (!note || (type === currentNoteType && mime === currentNoteMime)) {
            return;
        }

        // Confirm change if the note already has a content.
        if (type !== currentNoteType) {
            const blob = await note.getBlob();

            if (blob?.content && blob.content.trim().length &&
                !await (dialog.confirm(t("note_types.confirm-change")))) {
                return;
            }
        }

        await switchNoteType(note.noteId, type, mime);
    }, [ note, currentNoteType, currentNoteMime ]);

    const items: MenuItem<unknown>[] = [];
    for (const { isNew, isBeta, type, mime, title } of noteTypes) {
        if (noCodeNotes || type !== "code") {
            items.push({
                title: escapeHtml(title),
                checked: isCurrentNoteType({ type, mime }, note),
                badges: [
                    ...isNew ? [ { className: "new-note-type-badge", title: t("note_types.new-feature") } ] : [],
                    ...isBeta ? [ { title: t("note_types.beta-feature") } ] : []
                ],
                handler: () => void changeNoteType(type, mime)
            });
        } else {
            // The code entries head the list of languages that follows.
            items.push({ kind: "separator" }, { title: `<strong>${escapeHtml(title)}</strong>`, uiIcon: undefined, enabled: false });
        }
    }
    if (!noCodeNotes) {
        items.push(...codeLanguageItems({
            currentMimeType: currentNoteMime ?? undefined,
            mimeTypes: enabledMimeTypes,
            changeNoteType: (type, mime) => void changeNoteType(type, mime),
            onConfigure: () => setModalShown(true)
        }));
    }
    return items;
}

interface CodeLanguageListProps {
    currentMimeType?: string;
    mimeTypes: MimeType[];
    changeNoteType(type: NoteType, mime: string): void;
    /** Opens the options of the code languages, from a row at the end; without it, there is none. */
    onConfigure?(): void;
}

/** The code languages to switch a note to, the current one ticked, as menu items. */
export function codeLanguageItems({ currentMimeType, mimeTypes, changeNoteType, onConfigure }: CodeLanguageListProps) {
    const items: MenuItem<unknown>[] = mimeTypes.map((mimeType) => ({
        title: escapeHtml(mimeType.title),
        uiIcon: getCodeLanguageIcon(mimeType),
        checked: mimeType.mime === currentMimeType,
        handler: () => changeNoteType("code", mimeType.mime)
    }));
    if (onConfigure) {
        items.push({ kind: "separator" }, { title: t("basic_properties.configure_code_notes"), uiIcon: "bx bx-cog", handler: onConfigure });
    }
    return items;
}

export function useMimeTypes() {
    const [ codeNotesMimeTypes ] = useTriliumOption("codeNotesMimeTypes");
    return useMemo(() => {
        mime_types.loadMimeTypes();
        const allMimeTypes = mime_types.getMimeTypes();
        return {
            enabledMimeTypes: allMimeTypes.filter(mimeType => mimeType?.enabled),
            allMimeTypes
        };
    }, [ codeNotesMimeTypes ]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function NoteTypeOptionsModal({ modalShown, setModalShown }: { modalShown: boolean, setModalShown: (shown: boolean) => void }) {
    return (
        <Modal
            className="code-mime-types-modal"
            title={t("code_mime_types.title")}
            show={modalShown} onHidden={() => setModalShown(false)}
            size="xl" scrollable
        >
            <CodeMimeTypesList />
        </Modal>
    );
}

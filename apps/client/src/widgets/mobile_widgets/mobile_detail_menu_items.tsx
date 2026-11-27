import "./mobile_detail_menu_items.css";

import type { RefObject } from "preact";

import type NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { getLocaleName, useLanguageSwitcher } from "../layout/language_switcher";
import { CommandItem } from "../layout/NoteActions";
import NoteActionsCustom from "../layout/NoteActionsCustom";
import { codeLanguageItems, useMimeTypes } from "../layout/NoteTypeSwitcher";
import { useAttributeCount, useUserAttachmentCount } from "../layout/StatusBar";
import { NoteInfoContent, SimilarNotesList } from "../layout/StatusBarPanels";
import { type DropdownHandle, DropdownMenuItemRows } from "../react/Dropdown";
import {
    FormDropdownDivider, FormDropdownSubmenu, FormListCustomItem, FormListItem
} from "../react/FormList";
import { useBacklinkCount, useNoteProperty, useSortedNotePaths } from "../react/hooks/note";
import Modal from "../react/Modal";
import { BacklinksWidget } from "../sidebar/Backlinks";
import { NotePathsWidget } from "../sidebar/NotePaths";
import { useProcessedLocales } from "../type_widgets/options/components/LocaleSelector";

/** A dialog the menu opens over the note. */
export type DetailMenuModal = "backlinks" | "notePaths" | "similarNotes";

/**
 * The rows that head the menu: the backlinks, note paths, attachments and attributes, the note's
 * custom actions and, in a split that is not the first, the row that closes it.
 */
export function ItemsAtStart({ note, noteContext, ntxId, hoistedNoteId, isMainContext, disabled, showModal, closePane }: {
    note: FNote;
    noteContext: NoteContext | undefined;
    ntxId: string | null | undefined;
    hoistedNoteId: string | undefined;
    isMainContext: boolean | undefined;
    disabled: boolean;
    showModal: (modal: DetailMenuModal) => void;
    closePane: () => void;
}) {
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const backlinksCount = useBacklinkCount(note, noteContext?.viewScope?.viewMode === "default");

    return (
        <>
            <div className="form-list-row">
                <div className="form-list-col">
                    <FormListItem
                        icon="bx bx-link"
                        onClick={() => showModal("backlinks")}
                        disabled={backlinksCount === 0}
                    >{t("status_bar.backlinks", { count: backlinksCount })}</FormListItem>
                </div>
                <div className="form-list-col">
                    <FormListItem
                        icon="bx bx-directions"
                        onClick={() => showModal("notePaths")}
                        disabled={(sortedNotePaths?.length ?? 0) <= 1}
                    >{t("status_bar.note_paths", { count: sortedNotePaths?.length })}</FormListItem>
                </div>
                <AttachmentsAndAttributes note={note} disabled={disabled} />
            </div>
            <FormDropdownDivider />

            {noteContext && ntxId && <NoteActionsCustom note={note} noteContext={noteContext} ntxId={ntxId} />}
            {!isMainContext && <>
                <FormListItem icon="bx bx-x" onClick={closePane}>{t("close_pane_button.close_this_pane")}</FormListItem>
                <FormDropdownDivider />
            </>}
        </>
    );
}

/** The note settings only a text or a code note has: the content language and the code language. */
export function NoteSettingsItems({ note }: { note: FNote }) {
    return (
        <>
            {note.type === "text" && <ContentLanguageSelector note={note} />}
            {note.type === "code" && <CodeLanguageSelector note={note} />}
        </>
    );
}

/** The submenu that shows the note's information. */
export function NoteInfoItem({ note, dropdownRef, showModal }: {
    note: FNote;
    dropdownRef: RefObject<DropdownHandle | null>;
    showModal: (modal: DetailMenuModal) => void;
}) {
    return (
        <FormDropdownSubmenu icon="bx bx-info-circle" title={t("note_info_widget.title")}>
            <FormListCustomItem>
                {/* Calculating the size or selecting a value keeps the menu open; the
                    similar notes link closes it through `dropdownRef`. */}
                <div onClick={(e) => e.stopPropagation()}>
                    <NoteInfoContent note={note} noteType={note.type} dropdownRef={dropdownRef}
                        setSimilarNotesShown={() => showModal("similarNotes")} />
                </div>
            </FormListCustomItem>
        </FormDropdownSubmenu>
    );
}

/** The dialogs the menu opens, of which `shown` is the one on screen. */
export function DetailMenuModals({ note, notePath, hoistedNoteId, shown, hide }: {
    note: FNote | null | undefined;
    notePath: string | null | undefined;
    hoistedNoteId: string | undefined;
    shown: DetailMenuModal | undefined;
    hide: () => void;
}) {
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);

    return (
        <>
            <Modal
                className="backlinks-modal"
                size="md"
                title={t("mobile_detail_menu.backlinks")}
                show={shown === "backlinks"}
                onHidden={hide}
            >
                {note && <BacklinksWidget note={note} />}
            </Modal>
            <Modal
                className="note-paths-modal"
                size="md"
                title={t("note_paths.title")}
                show={shown === "notePaths"}
                onHidden={hide}
            >
                {note && <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} />}
            </Modal>
            <Modal
                className="similar-notes-modal"
                size="md"
                title={t("similar_notes.title")}
                show={shown === "similarNotes"}
                onHidden={hide}
            >
                <SimilarNotesList note={note} />
            </Modal>
        </>
    );
}

/** The cells that open the attachments and the attributes, counted as in the status bar. */
function AttachmentsAndAttributes({ note, disabled }: { note: FNote, disabled: boolean }) {
    const attachmentCount = useUserAttachmentCount(note);
    const attributeCount = useAttributeCount(note);

    return (
        <>
            <div className="form-list-col">
                <CommandItem command="showAttachments" icon="bx bx-paperclip" disabled={disabled}
                    text={t("status_bar.attachments", { count: attachmentCount })} />
            </div>
            <div className="form-list-col">
                <CommandItem command="showNoteAttributes" icon="bx bx-list-check"
                    disabled={disabled || note.isContentWritable === false}
                    text={t("status_bar.attributes", { count: attributeCount })} />
            </div>
        </>
    );
}

function ContentLanguageSelector({ note }: { note: FNote | null | undefined }) {
    const { locales, DEFAULT_LOCALE, effectiveLocale, currentNoteLanguage, setCurrentNoteLanguage } = useLanguageSwitcher(note);
    const { processedLocales } = useProcessedLocales(locales, DEFAULT_LOCALE, currentNoteLanguage ?? DEFAULT_LOCALE.id);

    return (
        <FormDropdownSubmenu
            icon="bx bx-globe"
            title={t("mobile_detail_menu.content_language_switcher", { language: getLocaleName(effectiveLocale ?? DEFAULT_LOCALE) })}
        >
            {processedLocales.map((locale, index) =>
                (typeof locale === "object") ? (
                    <FormListItem
                        key={locale.id}
                        rtl={locale.rtl}
                        checked={locale.id === currentNoteLanguage}
                        onClick={() => setCurrentNoteLanguage(locale.id)}
                    >{locale.name}</FormListItem>
                ) : (
                    <FormDropdownDivider key={`divider-${index}`} />
                )
            )}
        </FormDropdownSubmenu>
    );
}

/** The code languages to switch the note to, filtered as the reader types. */
function CodeLanguageSelector({ note }: { note: FNote }) {
    const currentNoteMime = useNoteProperty(note, "mime");
    const { enabledMimeTypes } = useMimeTypes();

    return (
        <FormDropdownSubmenu icon="bx bx-code" title={t("status_bar.code_note_switcher")} filterable>
            <DropdownMenuItemRows items={codeLanguageItems({
                currentMimeType: currentNoteMime,
                mimeTypes: enabledMimeTypes,
                changeNoteType: (type, mime) => void server.put(`notes/${note.noteId}/type`, { type, mime })
            })} />
        </FormDropdownSubmenu>
    );
}

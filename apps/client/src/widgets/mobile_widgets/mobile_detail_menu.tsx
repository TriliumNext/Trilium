import "./mobile_detail_menu.css";

import { Dropdown as BootstrapDropdown } from "bootstrap";
import { createPortal, useRef, useState } from "preact/compat";

import FNote, { NotePathRecord } from "../../entities/fnote";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import server from "../../services/server";
import { BacklinksList, useBacklinkCount } from "../FloatingButtonsDefinitions";
import { getLocaleName, NoteInfoContent } from "../layout/StatusBar";
import ActionButton from "../react/ActionButton";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem } from "../react/FormList";
import { useNoteContext, useNoteProperty } from "../react/hooks";
import Modal from "../react/Modal";
import { NoteTypeCodeNoteList, useLanguageSwitcher, useMimeTypes } from "../ribbon/BasicPropertiesTab";
import { NoteContextMenu } from "../ribbon/NoteActions";
import NoteActionsCustom from "../ribbon/NoteActionsCustom";
import { NotePathsWidget, useSortedNotePaths } from "../ribbon/NotePathsTab";
import SimilarNotesTab from "../ribbon/SimilarNotesTab";
import { useProcessedLocales } from "../type_widgets/options/components/LocaleSelector";

export default function MobileDetailMenu() {
    const dropdownRef = useRef<BootstrapDropdown | null>(null);
    const { note, noteContext, parentComponent, ntxId, viewScope, hoistedNoteId } = useNoteContext();
    const subContexts = noteContext?.getMainContext().getSubContexts() ?? [];
    const isMainContext = noteContext?.isMainContext();
    const [ backlinksModalShown, setBacklinksModalShown ] = useState(false);
    const [ notePathsModalShown, setNotePathsModalShown ] = useState(false);
    const [ noteInfoModalShown, setNoteInfoModalShown ] = useState(false);
    const [ similarNotesModalShown, setSimilarNotesModalShown ] = useState(false);
    const [ codeNoteSwitcherModalShown, setCodeNoteSwitcherModalShown ] = useState(false);
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const backlinksCount = useBacklinkCount(note, viewScope?.viewMode === "default");

    function closePane() {
        // Wait first for the context menu to be dismissed, otherwise the backdrop stays on.
        requestAnimationFrame(() => {
            parentComponent.triggerCommand("closeThisNoteSplit", { ntxId });
        });
    }

    return (
        <div style={{ contain: "none" }}>
            {note ? (
                <NoteContextMenu
                    dropdownRef={dropdownRef}
                    note={note} noteContext={noteContext}
                    itemsAtStart={<>
                        <div className="form-list-row">
                            <div className="form-list-col">
                                <FormListItem
                                    icon="bx bx-link"
                                    onClick={() => setBacklinksModalShown(true)}
                                    disabled={backlinksCount === 0}
                                >{t("status_bar.backlinks", { count: backlinksCount })}</FormListItem>
                            </div>
                            <div className="form-list-col">
                                <FormListItem
                                    icon="bx bx-directions"
                                    onClick={() => setNotePathsModalShown(true)}
                                    disabled={(sortedNotePaths?.length ?? 0) <= 1}
                                >{t("status_bar.note_paths", { count: sortedNotePaths?.length })}</FormListItem>
                            </div>
                        </div>
                        <FormDropdownDivider />

                        {noteContext && ntxId && <NoteActionsCustom note={note} noteContext={noteContext} ntxId={ntxId} />}
                        <FormListItem
                            onClick={() => noteContext?.notePath && note_create.createNote(noteContext.notePath)}
                            icon="bx bx-plus"
                        >{t("mobile_detail_menu.insert_child_note")}</FormListItem>
                        {subContexts.length < 2 && <>
                            <FormDropdownDivider />
                            <FormListItem
                                onClick={(e) => {
                                    // We have to manually manage the hide because otherwise the old note context gets activated.
                                    e.stopPropagation();
                                    dropdownRef.current?.hide();
                                    parentComponent.triggerCommand("openNewNoteSplit", { ntxId });
                                }}
                                icon="bx bx-dock-right"
                            >{t("create_pane_button.create_new_split")}</FormListItem>
                        </>}
                        {!isMainContext && <>
                            <FormDropdownDivider />
                            <FormListItem
                                icon="bx bx-x"
                                onClick={closePane}
                            >{t("close_pane_button.close_this_pane")}</FormListItem>
                        </>}
                        <FormDropdownDivider />
                    </>}
                    itemsNearNoteSettings={<>
                        {note.type === "text" && <ContentLanguageSelector note={note} />}
                        {note.type === "code" && <FormListItem icon={"bx bx-code"} onClick={() => setCodeNoteSwitcherModalShown(true)}>{t("status_bar.code_note_switcher")}</FormListItem>}
                        <FormListItem icon="bx bx-info-circle" onClick={() => setNoteInfoModalShown(true)}>{t("note_info_widget.title")}</FormListItem>
                        <FormListItem icon="bx bx-bar-chart" onClick={() => setSimilarNotesModalShown(true)}>{t("similar_notes.title")}</FormListItem>
                        <FormDropdownDivider />
                    </>}
                />
            ) : (
                <ActionButton
                    icon="bx bx-x"
                    onClick={closePane}
                    text={t("close_pane_button.close_this_pane")}
                />
            )}

            {createPortal((
                <>
                    <BacklinksModal note={note} modalShown={backlinksModalShown} setModalShown={setBacklinksModalShown} />
                    <NotePathsModal note={note} modalShown={notePathsModalShown} notePath={noteContext?.notePath} sortedNotePaths={sortedNotePaths} setModalShown={setNotePathsModalShown} />
                    <NoteInfoModal note={note}  modalShown={noteInfoModalShown} setModalShown={setNoteInfoModalShown} />
                    <SimilarNotesModal note={note} modalShown={similarNotesModalShown} setModalShown={setSimilarNotesModalShown} />
                    <CodeNoteSwitcherModal note={note} modalShown={codeNoteSwitcherModalShown} setModalShown={setCodeNoteSwitcherModalShown} />
                </>
            ), document.body)}
        </div>
    );
}

function ContentLanguageSelector({ note }: { note: FNote | null | undefined }) {
    const { locales, DEFAULT_LOCALE, currentNoteLanguage, setCurrentNoteLanguage } = useLanguageSwitcher(note);
    const { activeLocale, processedLocales } = useProcessedLocales(locales, DEFAULT_LOCALE, currentNoteLanguage ?? DEFAULT_LOCALE.id);

    return (
        <FormDropdownSubmenu
            icon="bx bx-globe"
            title={t("mobile_detail_menu.content_language_switcher", { language: getLocaleName(activeLocale ?? DEFAULT_LOCALE) })}
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

interface WithModal {
    modalShown: boolean;
    setModalShown: (shown: boolean) => void;
}

function BacklinksModal({ note, modalShown, setModalShown }: { note: FNote | null | undefined } & WithModal) {
    return (
        <Modal
            className="backlinks-modal tn-backlinks-widget"
            size="md"
            title={t("mobile_detail_menu.backlinks")}
            show={modalShown}
            onHidden={() => setModalShown(false)}
        >
            <ul className="backlinks-items">
                {note && <BacklinksList note={note} />}
            </ul>
        </Modal>
    );
}

function NotePathsModal({ note, modalShown, notePath, sortedNotePaths, setModalShown }: { note: FNote | null | undefined, sortedNotePaths: NotePathRecord[] | undefined, notePath: string | null | undefined } & WithModal) {
    return (
        <Modal
            className="note-paths-modal"
            size="md"
            title={t("note_paths.title")}
            show={modalShown}
            onHidden={() => setModalShown(false)}
        >
            {note && (
                <NotePathsWidget
                    sortedNotePaths={sortedNotePaths}
                    currentNotePath={notePath}
                />
            )}
        </Modal>
    );
}

function NoteInfoModal({ note, modalShown, setModalShown }: { note: FNote | null | undefined } & WithModal) {
    return (
        <Modal
            className="note-info-modal"
            size="md"
            title={t("note_info_widget.title")}
            show={modalShown}
            onHidden={() => setModalShown(false)}
        >
            {note && <NoteInfoContent note={note} noteType={note.type} />}
        </Modal>
    );
}

function SimilarNotesModal({ note, modalShown, setModalShown }: { note: FNote | null | undefined } & WithModal) {
    return (
        <Modal
            className="similar-notes-modal"
            size="md"
            title={t("similar_notes.title")}
            show={modalShown}
            onHidden={() => setModalShown(false)}
        >
            <SimilarNotesTab note={note} />
        </Modal>
    );
}

function CodeNoteSwitcherModal({ note, modalShown, setModalShown }: { note: FNote | null | undefined } & WithModal) {
    const currentNoteMime = useNoteProperty(note, "mime");
    const mimeTypes = useMimeTypes();

    return (
        <Modal
            className="code-note-switcher-modal"
            size="md"
            title={t("status_bar.code_note_switcher")}
            show={modalShown}
            onHidden={() => setModalShown(false)}
        >
            <div className="dropdown-menu static show">
                {note && <NoteTypeCodeNoteList
                    currentMimeType={currentNoteMime}
                    mimeTypes={mimeTypes}
                    changeNoteType={(type, mime) => {
                        server.put(`notes/${note.noteId}/type`, { type, mime });
                        setModalShown(false);
                    }}
                />}
            </div>
        </Modal>
    );
}

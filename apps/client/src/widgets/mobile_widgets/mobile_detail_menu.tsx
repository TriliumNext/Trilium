import { createPortal, useState } from "preact/compat";

import FNote, { NotePathRecord } from "../../entities/fnote";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import { BacklinksList, useBacklinkCount } from "../FloatingButtonsDefinitions";
import ActionButton from "../react/ActionButton";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useNoteContext } from "../react/hooks";
import Modal from "../react/Modal";
import { NoteContextMenu } from "../ribbon/NoteActions";
import NoteActionsCustom from "../ribbon/NoteActionsCustom";
import { NotePathsWidget, useSortedNotePaths } from "../ribbon/NotePathsTab";

export default function MobileDetailMenu() {
    const { note, noteContext, parentComponent, ntxId, viewScope, hoistedNoteId } = useNoteContext();
    const subContexts = noteContext?.getMainContext().getSubContexts() ?? [];
    const isMainContext = noteContext?.isMainContext();
    const [ backlinksModalShown, setBacklinksModalShown ] = useState(false);
    const [ notePathsModalShown, setNotePathsModalShown ] = useState(false);
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
                    note={note} noteContext={noteContext}
                    extraItems={<>
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
                                onClick={() => parentComponent.triggerCommand("openNewNoteSplit", { ntxId })}
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
                </>
            ), document.body)}
        </div>
    );
}

function BacklinksModal({ note, modalShown, setModalShown }: { note: FNote | null | undefined, modalShown: boolean, setModalShown: (shown: boolean) => void }) {
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

function NotePathsModal({ note, modalShown, notePath, sortedNotePaths, setModalShown }: { note: FNote | null | undefined, modalShown: boolean, sortedNotePaths: NotePathRecord[] | undefined, notePath: string | null | undefined, setModalShown: (shown: boolean) => void }) {
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

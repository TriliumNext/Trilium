import { createPortal } from "preact";
import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import { NoteContextMenu } from "../layout/NoteActions";
import ActionButton from "../react/ActionButton";
import type { DropdownHandle } from "../react/Dropdown";
import { useNoteContext } from "../react/hooks/note_context";
import { preloadLazyModule, WithLazyModule } from "../react/LazyComponent";
import type { DetailMenuModal } from "./mobile_detail_menu_items";

export default function MobileDetailMenu() {
    const dropdownRef = useRef<DropdownHandle | null>(null);
    const { note, noteContext, parentComponent, ntxId, viewScope, hoistedNoteId } = useNoteContext();
    const subContexts = noteContext?.getMainContext().getSubContexts() ?? [];
    const isMainContext = noteContext?.isMainContext();
    const [ shownModal, setShownModal ] = useState<DetailMenuModal>();
    // The dialogs render from the first one opened on, and stay so they can animate closed.
    const [ modalsOpened, setModalsOpened ] = useState(false);
    const isInOptionsOrHelp = !!note && (note.noteId.startsWith("_options") || note.noteId.startsWith("_help"));

    function showModal(modal: DetailMenuModal) {
        setModalsOpened(true);
        setShownModal(modal);
    }

    function closePane() {
        // Wait first for the context menu to be dismissed, otherwise the backdrop stays on.
        requestAnimationFrame(() => {
            parentComponent.triggerCommand("closeThisNoteSplit", { ntxId });
        });
    }

    return (
        <div
            style={{ contain: "none" }}
            onPointerEnter={preloadMenuItems}
            onPointerDown={preloadMenuItems}
            onFocus={preloadMenuItems}
        >
            {note ? (
                <NoteContextMenu
                    key={viewScope?.viewMode ?? "default"}
                    dropdownRef={dropdownRef}
                    note={note} noteContext={noteContext}
                    leadingViewActions={subContexts.length < 2 ? [ {
                        title: t("mobile_detail_menu.create_new_split_short"),
                        uiIcon: "bx bx-dock-right",
                        handler: (_item: unknown, e: MouseEvent | KeyboardEvent) => {
                            // We have to manually manage the hide because otherwise the old note context gets activated.
                            e.stopPropagation();
                            dropdownRef.current?.hide();
                            parentComponent.triggerCommand("openNewNoteSplit", { ntxId });
                        }
                    } ] : []}
                    trailingViewActions={[ {
                        title: t("mobile_detail_menu.insert_child_note_short"),
                        uiIcon: "bx bx-plus",
                        handler: () => void (noteContext?.notePath && note_create.createNote(noteContext.notePath))
                    } ]}
                    itemsAtStart={
                        <WithLazyModule load={loadMenuItems}>{({ ItemsAtStart }) => (
                            <ItemsAtStart
                                note={note} noteContext={noteContext} ntxId={ntxId} hoistedNoteId={hoistedNoteId}
                                isMainContext={isMainContext} disabled={isInOptionsOrHelp}
                                showModal={showModal} closePane={closePane}
                            />
                        )}</WithLazyModule>
                    }
                    noteSettingsItems={
                        <WithLazyModule load={loadMenuItems}>{({ NoteSettingsItems }) => <NoteSettingsItems note={note} />}</WithLazyModule>
                    }
                    itemsNearNoteSettings={
                        <WithLazyModule load={loadMenuItems}>{({ NoteInfoItem }) => (
                            <NoteInfoItem note={note} dropdownRef={dropdownRef} showModal={showModal} />
                        )}</WithLazyModule>
                    }
                />
            ) : (
                <ActionButton
                    icon="bx bx-x"
                    onClick={closePane}
                    text={t("close_pane_button.close_this_pane")}
                />
            )}

            {modalsOpened && createPortal((
                <WithLazyModule load={loadMenuItems}>{({ DetailMenuModals }) => (
                    <DetailMenuModals
                        note={note} notePath={noteContext?.notePath} hoistedNoteId={hoistedNoteId}
                        shown={shownModal} hide={() => setShownModal(undefined)}
                    />
                )}</WithLazyModule>
            ), document.body)}
        </div>
    );
}

// The rows load once the menu is about to open, and the dialogs with them.
const loadMenuItems = () => import("./mobile_detail_menu_items");
const preloadMenuItems = () => preloadLazyModule(loadMenuItems);

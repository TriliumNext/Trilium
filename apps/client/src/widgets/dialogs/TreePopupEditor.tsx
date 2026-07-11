import "./TreePopupEditor.css";

import { useCallback, useContext, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import NoteTreeWidget from "../note_tree";
import NoteDetail from "../NoteDetail";
import PromotedAttributes from "../PromotedAttributes";
import { useContainedLinkNavigation, useLegacyWidget, useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { TitleRow } from "./PopupEditor";

/**
 * A quick-edit-style popup whose sidebar is a hoisted note tree.
 *
 * Summoned via the `openInTreePopup` command with a `noteIdOrPath` to open and a `hoistedNoteId`
 * to scope the sidebar tree to. Used to open the launch-bar configuration subtree in a modal
 * (with the same hoisting it would get in a dedicated tab) instead of a separate tab.
 */
export default function TreePopupEditor() {
    const [ shown, setShown ] = useState(false);
    const parentComponent = useContext(ParentComponent);
    const [ noteContext, setNoteContext ] = useState(() => new NoteContext("_tree-popup"));
    const modalRef = useRef<HTMLDivElement>(null);

    useTriliumEvent("openInTreePopup", async ({ noteIdOrPath, hoistedNoteId }) => {
        // Fresh context per open so the sidebar tree is hoisted to the requested subtree.
        const newContext = new NoteContext("_tree-popup", hoistedNoteId);
        await newContext.setNote(noteIdOrPath, { keepActiveDialog: true });

        // Events triggered at note-context level (e.g. the save indicator) would not work since this
        // context has no parent component. Propagate them so they can be handled properly.
        newContext.triggerEvent = (name, data) => parentComponent?.handleEventInChildren(name, data);

        setNoteContext(newContext);
        setShown(true);
    });

    // Keep navigation that follows internal links inside the popup, rather than letting the global
    // link handler open the target in the background tab. Links that stay within the hoisted subtree
    // navigate the modal's own context; links pointing outside it can't be shown in the hoisted
    // context, so they fall back to the quick-edit popup.
    useContainedLinkNavigation(modalRef, useCallback((notePath, viewScope) => {
        if (notePath.split("/").includes(noteContext.hoistedNoteId)) {
            void noteContext.setNote(notePath, { viewScope, keepActiveDialog: true });
        } else {
            void appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
        }
    }, [ noteContext ]));

    return (
        <NoteContextContext.Provider value={noteContext}>
            <Modal
                modalRef={modalRef}
                // Reuse the quick-edit note header (icon + editable title); it lives in the main
                // header, so skip the sidebar header that would otherwise duplicate it.
                title={<TitleRow />}
                hideSidebarHeader
                className="tree-popup-editor-dialog"
                size="xl"
                sidebar={<TreeSidebar noteContext={noteContext} />}
                show={shown}
                onShown={() => parentComponent?.handleEvent("focusOnDetail", { ntxId: noteContext.ntxId })}
                onHidden={() => setShown(false)}
                scrollable
                stackable
            >
                <PromotedAttributes />
                <NoteDetail />
            </Modal>
        </NoteContextContext.Provider>
    );
}

function TreeSidebar({ noteContext }: { noteContext: NoteContext }) {
    const [ treeEl ] = useLegacyWidget(() => new NoteTreeWidget(), { noteContext });
    return <div className="tree-popup-sidebar">{treeEl}</div>;
}

import "./PopupEditor.css";

import { ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import tree from "../../services/tree";
import utils from "../../services/utils";
import NoteList from "../collections/NoteList";
import FloatingButtons from "../FloatingButtons";
import { DESKTOP_FLOATING_BUTTONS, POPUP_HIDDEN_FLOATING_BUTTONS } from "../FloatingButtonsDefinitions";
import NoteTypeSwitcher from "../layout/NoteTypeSwitcher";
import TitleRow from "../layout/TitleRow";
import NoteDetail from "../NoteDetail";
import PromotedAttributes from "../PromotedAttributes";
import { useContainedLinkNavigation, useNoteContext, useNoteLabel, useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import ReadOnlyNoteInfoBar from "../ReadOnlyNoteInfoBar";
import StandaloneRibbonAdapter from "../ribbon/components/StandaloneRibbonAdapter";
import FormattingToolbar, { showFormattingToolbar } from "../ribbon/FormattingToolbar";
import MobileEditorToolbar from "../type_widgets/text/mobile_editor_toolbar";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

/** The layer the stylesheet gives this popup while it stands over another modal. */
const STACKED_LAYER = 1100;

/** Where a dialog this popup stands over is held while it is up, which is under its backdrop. */
const COVERED_LAYER = 1090;

export default function PopupEditor() {
    const [ shown, setShown ] = useState(false);
    const [ stacked, setStacked ] = useState(false);
    const [ switchable, setSwitchable ] = useState(false);
    const parentComponent = useContext(ParentComponent);
    const [ noteContext, setNoteContext ] = useState(() => new NoteContext("_popup-editor"));
    const modalRef = useRef<HTMLDivElement>(null);
    const isMobile = utils.isMobile();
    const items = useMemo(() => {
        const baseItems = isMobile ? [] : DESKTOP_FLOATING_BUTTONS;
        return baseItems.filter(item => !POPUP_HIDDEN_FLOATING_BUTTONS.includes(item));
    }, [ isMobile ]);

    useTriliumEvent("openInPopup", async ({ noteIdOrPath, viewScope, showNoteTypeSwitcher }) => {
        const noteId = tree.getNoteIdAndParentIdFromUrl(noteIdOrPath);
        if (!noteId.noteId) return;
        const note = await froca.getNote(noteId.noteId);
        if (!note) return;

        // Settings pages are displayed in their own dedicated dialog with the page selector sidebar.
        if (note.isOptions()) {
            void appContext.triggerCommand("showOptions", { section: noteId.noteId });
            return;
        }

        const noteContext = new NoteContext("_popup-editor");
        setStacked(!!document.querySelector(".modal.show"));
        setSwitchable(!!showNoteTypeSwitcher);

        const hasUserSetNoteReadOnly = note.hasLabel("readOnly");
        await noteContext.setNote(noteIdOrPath, {
            viewScope: {
                // Override auto-readonly notes to be editable, but respect user's choice to have a read-only note.
                readOnlyTemporarilyDisabled: !hasUserSetNoteReadOnly,
                // A view scope from the caller (e.g. an attachment link) decides what is actually displayed.
                ...viewScope
            },
            keepActiveDialog: true
        });

        // Events triggered at note context level (e.g. the save indicator) would not work since the note context has no parent component. Propagate events to parent component so that they can be handled properly.
        noteContext.triggerEvent = (name, data) => parentComponent?.handleEventInChildren(name, data);
        setNoteContext(noteContext);
        setShown(true);
    });

    // Asked to stand aside by something within it that has sent the reader elsewhere — the note map,
    // whose nodes navigate the pane behind rather than the popup, which would otherwise be left covering
    // the note it has just gone to with a map of the note it came from.
    useTriliumEvent("closePopupEditor", () => setShown(false));

    // Keep navigation that follows internal links inside the popup, rather than letting the global
    // link handler open the target in the background tab. Settings links open the options dialog.
    useContainedLinkNavigation(modalRef, useCallback((notePath, viewScope) => {
        const targetNoteId = notePath.split("/").at(-1);
        if (targetNoteId?.startsWith("_options")) {
            void appContext.triggerCommand("showOptions", { section: targetNoteId });
        } else {
            void noteContext.setNote(notePath, { viewScope, keepActiveDialog: true });
        }
    }, [ noteContext ]));

    // Add a global class to be able to handle issues with z-index due to rendering in a popup.
    useEffect(() => {
        document.body.classList.toggle("popup-editor-open", shown);
        document.body.classList.toggle("popup-editor-stacked", shown && stacked);
    }, [shown, stacked]);

    // A CKEditor dialog — the AI assistant — stacks at `--ck-z-dialog` (9999), far above the 999
    // this popup is deliberately held at so the editor's own panels can float over it. One already
    // open belongs to the editor behind and has to give way; one opened later belongs to the editor
    // *in* the popup and has to stay above it. Both are appended to `<body>`, so no selector tells
    // them apart — but the one to demote is exactly the one standing when the popup opens.
    useEffect(() => {
        if (!shown) return;
        const openDialog = document.querySelector(".ck-dialog-overlay");
        openDialog?.classList.add("ck-dialog-behind-popup-editor");
        return () => openDialog?.classList.remove("ck-dialog-behind-popup-editor");
    }, [shown]);

    // When stacked on top of another modal, raise this popup's own backdrop above
    // the underlying modal. Bootstrap does not auto-increment z-index for stacked
    // modals, and the appended `.modal-backdrop` is not individually addressable.
    useEffect(() => {
        if (!shown || !stacked) return;
        const backdrops = document.querySelectorAll(".modal-backdrop");
        const popupBackdrop = backdrops[backdrops.length - 1] as HTMLElement | undefined;
        if (!popupBackdrop) return;
        popupBackdrop.classList.add("popup-editor-backdrop");

        /*
         * The stylesheet's stacked layer clears Bootstrap's own dialogs and no more. A dialog that
         * declares a layer of its own stands above it — a confirm or a prompt at 2000, or the
         * properties of a collection that opened this to write a template — and would cover the
         * popup entirely.
         *
         * What gives way is the dialog, not this popup: it is held deliberately low so that the
         * editor's own panels and the menus its pickers open (portalled to the page at 1200) float
         * over it, and raising it above a dialog would put every one of those behind it. Each is
         * put back exactly as it was found, an inline layer of its own included.
         */
        const dialog = modalRef.current;
        const lowered = [ ...document.querySelectorAll<HTMLElement>(".modal.show") ]
            .filter((modal) => modal !== dialog
                && (parseInt(getComputedStyle(modal).zIndex, 10) || 0) >= STACKED_LAYER)
            .map((modal) => {
                const was = modal.style.zIndex;
                modal.style.zIndex = String(COVERED_LAYER);
                return () => { modal.style.zIndex = was; };
            });

        return () => {
            popupBackdrop.classList.remove("popup-editor-backdrop");
            for (const restore of lowered) {
                restore();
            }
        };
    }, [shown, stacked]);

    return (
        <NoteContextContext.Provider value={noteContext}>
            <DialogWrapper>
                <Modal
                    modalRef={modalRef}
                    title={<TitleRow />}
                    customTitleBarButtons={[{
                        iconClassName: "bx-expand-alt",
                        title: t("popup-editor.maximize"),
                        onClick: async () => {
                            if (!noteContext.noteId) return;
                            const { noteId, hoistedNoteId, viewScope } = noteContext;
                            if (viewScope?.attachmentId || (viewScope?.viewMode && viewScope.viewMode !== "default")) {
                                // Whatever is on show that isn't the note itself — an attachment, or a view
                                // mode such as the note map — is carried over, or the tab would open on the
                                // note and drop what was being looked at.
                                await appContext.tabManager.openContextWithNote(noteId, { hoistedNoteId, viewScope, activate: true });
                            } else {
                                await appContext.tabManager.openInNewTab(noteId, hoistedNoteId, true);
                            }
                            setShown(false);
                        }
                    }]}
                    className="popup-editor-dialog"
                    size="lg"
                    show={shown}
                    onShown={() => parentComponent?.handleEvent("focusOnDetail", { ntxId: noteContext.ntxId })}
                    onHidden={() => setShown(false)}
                    keepInDom // needed for faster loading
                    noFocus // automatic focus breaks block popup
                    stackable
                >
                    {!isNewLayout && <ReadOnlyNoteInfoBar />}
                    <PromotedAttributes />

                    {isMobile
                        ? <MobileEditorToolbar inPopupEditor />
                        : <StandaloneRibbonAdapter component={FormattingToolbar} show={showFormattingToolbar} />}

                    <FloatingButtons items={items} />
                    <NoteDetail />
                    <NoteList media="screen" displayOnlyCollections />
                    {switchable && <NoteTypeSwitcher note={noteContext.note} />}
                </Modal>
            </DialogWrapper>
        </NoteContextContext.Provider>
    );
}

export function DialogWrapper({ children }: { children: ComponentChildren }) {
    const { note } = useNoteContext();
    const wrapperRef = useRef<HTMLDivElement>(null);
    useNoteLabel(note, "color"); // to update color class

    return (
        <div ref={wrapperRef} class={`quick-edit-dialog-wrapper ${note?.getColorClass() ?? ""}`}>
            {children}
        </div>
    );
}

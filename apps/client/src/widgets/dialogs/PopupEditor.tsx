import "./PopupEditor.css";

import { ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import tree from "../../services/tree";
import utils from "../../services/utils";
import NoteList from "../collections/NoteList";
import FloatingButtons from "../FloatingButtons";
import { DESKTOP_FLOATING_BUTTONS, MOBILE_FLOATING_BUTTONS, POPUP_HIDDEN_FLOATING_BUTTONS } from "../FloatingButtonsDefinitions";
import NoteIcon from "../note_icon";
import NoteTitleWidget from "../note_title";
import NoteDetail from "../NoteDetail";
import PromotedAttributes from "../PromotedAttributes";
import { useNoteContext, useNoteLabel, useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import ReadOnlyNoteInfoBar from "../ReadOnlyNoteInfoBar";
import StandaloneRibbonAdapter from "../ribbon/components/StandaloneRibbonAdapter";
import FormattingToolbar from "../ribbon/FormattingToolbar";
import MobileEditorToolbar from "../type_widgets/text/mobile_editor_toolbar";
import NoteBadges from "../layout/NoteBadges";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export default function PopupEditor() {
    const [ shown, setShown ] = useState(false);
    const parentComponent = useContext(ParentComponent);
    const [ noteContext, setNoteContext ] = useState(new NoteContext("_popup-editor"));
    const isMobile = utils.isMobile();
    const items = useMemo(() => {
        const baseItems = isMobile ? MOBILE_FLOATING_BUTTONS : DESKTOP_FLOATING_BUTTONS;
        return baseItems.filter(item => !POPUP_HIDDEN_FLOATING_BUTTONS.includes(item));
    }, [ isMobile ]);

    useTriliumEvent("openInPopup", async ({ noteIdOrPath }) => {
        const noteContext = new NoteContext("_popup-editor");

        const noteId = tree.getNoteIdAndParentIdFromUrl(noteIdOrPath);
        if (!noteId.noteId) return;
        const note = await froca.getNote(noteId.noteId);
        if (!note) return;

        const hasUserSetNoteReadOnly = note.hasLabel("readOnly");
        await noteContext.setNote(noteIdOrPath, {
            viewScope: {
                // Override auto-readonly notes to be editable, but respect user's choice to have a read-only note.
                readOnlyTemporarilyDisabled: !hasUserSetNoteReadOnly
            }
        });

        setNoteContext(noteContext);
        setShown(true);
    });

    // Add a global class to be able to handle issues with z-index due to rendering in a popup.
    useEffect(() => {
        document.body.classList.toggle("popup-editor-open", shown);
    }, [shown]);

    return (
        <NoteContextContext.Provider value={noteContext}>
            <DialogWrapper>
                <Modal
                    title={<>
                        <TitleRow />
                        {isNewLayout && <NoteBadges />}
                    </>}
                    customTitleBarButtons={[{
                        iconClassName: "bx-expand-alt",
                        title: t("popup-editor.maximize"),
                        onClick: async () => {
                            if (!noteContext.noteId) return;
                            const { noteId, hoistedNoteId } = noteContext;
                            await appContext.tabManager.openInNewTab(noteId, hoistedNoteId, true);
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
                        : <StandaloneRibbonAdapter component={FormattingToolbar} />}

                    <FloatingButtons items={items} />
                    <NoteDetail />
                    <NoteList media="screen" displayOnlyCollections />
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

export function TitleRow() {
    return (
        <div className="title-row">
            <NoteIcon />
            <NoteTitleWidget />
        </div>
    );
}

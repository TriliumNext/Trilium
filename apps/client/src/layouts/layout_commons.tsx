import { ComponentType } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import type { EventData, EventNames } from "../components/app_context.js";
import type RootContainer from "../widgets/containers/root_container.js";
import CallToActionDialog from "../widgets/dialogs/call_to_action.jsx";
import PopupEditorDialog from "../widgets/dialogs/PopupEditor.jsx";
import { useTriliumEvents } from "../widgets/react/hooks.jsx";
import { ParentComponent } from "../widgets/react/react_utils.jsx";
import ToastContainer from "../widgets/Toast.jsx";

export function applyModals(rootContainer: RootContainer) {
    rootContainer
        .child(<LazyDialog triggerEvents={["openBulkActionsDialog"]} loader={() => import("../widgets/dialogs/bulk_actions.js")} />)
        .child(<LazyDialog triggerEvents={["openAboutDialog"]} loader={() => import("../widgets/dialogs/about.js")} />)
        .child(<LazyDialog triggerEvents={["showCheatsheet"]} loader={() => import("../widgets/dialogs/help.js")} />)
        .child(<LazyDialog triggerEvents={["showRecentChanges"]} loader={() => import("../widgets/dialogs/recent_changes.js")} />)
        .child(<LazyDialog triggerEvents={["editBranchPrefix"]} loader={() => import("../widgets/dialogs/branch_prefix.js")} />)
        .child(<LazyDialog triggerEvents={["sortChildNotes"]} loader={() => import("../widgets/dialogs/sort_child_notes.js")} />)
        .child(<LazyDialog triggerEvents={["showIncludeNoteDialog"]} loader={() => import("../widgets/dialogs/include_note.js")} />)
        .child(<LazyDialog triggerEvents={["showLinkEmbedDialog"]} loader={() => import("../widgets/dialogs/link_embed.js")} />)
        .child(<LazyDialog triggerEvents={["chooseNoteType"]} loader={() => import("../widgets/dialogs/note_type_chooser.js")} />)
        .child(<LazyDialog triggerEvents={["jumpToNote", "commandPalette"]} loader={() => import("../widgets/dialogs/jump_to_note.js")} />)
        .child(<LazyDialog triggerEvents={["showAddLinkDialog"]} loader={() => import("../widgets/dialogs/add_link.js")} />)
        .child(<LazyDialog triggerEvents={["cloneNoteIdsTo"]} loader={() => import("../widgets/dialogs/clone_to.js")} />)
        .child(<LazyDialog triggerEvents={["moveBranchIdsTo"]} loader={() => import("../widgets/dialogs/move_to.js")} />)
        .child(<LazyDialog triggerEvents={["showImportDialog"]} loader={() => import("../widgets/dialogs/import/import_dialog.js")} />)
        .child(<LazyDialog triggerEvents={["showExportDialog"]} loader={() => import("../widgets/dialogs/export.js")} />)
        .child(<LazyDialog triggerEvents={["showPasteMarkdownDialog"]} loader={() => import("../widgets/dialogs/markdown_import.js")} />)
        .child(<LazyDialog triggerEvents={["showProtectedSessionPasswordDialog"]} loader={() => import("../widgets/dialogs/protected_session_password.js")} />)
        .child(<LazyDialog triggerEvents={["showRevisions"]} loader={() => import("../widgets/dialogs/revisions.js")} />)
        .child(<LazyDialog triggerEvents={["showDeleteNotesDialog"]} loader={() => import("../widgets/dialogs/delete_notes.js")} />)
        .child(<LazyDialog triggerEvents={["showPrintPreview"]} loader={() => import("../widgets/dialogs/print_preview.jsx")} />)
        .child(<LazyDialog triggerEvents={["showInfoDialog"]} loader={() => import("../widgets/dialogs/info.js")} />)
        .child(<LazyDialog triggerEvents={["showConfirmDialog", "showConfirmDeleteNoteBoxWithNoteDialog"]} loader={() => import("../widgets/dialogs/confirm.js")} />)
        .child(<LazyDialog triggerEvents={["showPromptDialog"]} loader={() => import("../widgets/dialogs/prompt.js")} />)
        .child(<LazyDialog triggerEvents={["showCpuArchWarning"]} loader={() => import("../widgets/dialogs/incorrect_cpu_arch.js")} />)
        .child(<LazyDialog triggerEvents={["showOptions"]} loader={() => import("../widgets/dialogs/OptionsDialog.jsx")} />)
        .child(<LazyDialog triggerEvents={["showOcrTextDialog"]} loader={() => import("../widgets/dialogs/ocr_text.js")} />)
        .child(<LazyDialog triggerEvents={["showUploadAttachmentsDialog"]} loader={() => import("../widgets/dialogs/upload_attachments.js")} />)
        .child(<LazyDialog triggerEvents={["openInTreePopup"]} loader={() => import("../widgets/dialogs/TreePopupEditor.jsx")} />)
        // The following three are deliberately eager (not wrapped in LazyDialog):
        //  - PopupEditor keeps itself in the DOM (`keepInDom`) for fast hover-preview latency, so deferring its module would defeat the purpose.
        //  - CallToAction has no summon event; it decides whether to show itself on startup, so there is nothing to lazily mount against.
        //  - Toast is needed immediately and continuously to surface messages/errors, including ones raised during startup.
        .child(<PopupEditorDialog />)
        .child(<CallToActionDialog />)
        .child(<ToastContainer />);
}

interface LazyDialogProps {
    /** Loader returning the module whose default export is the dialog component, e.g. `() => import("../widgets/dialogs/about.js")`. */
    loader: () => Promise<{ default: ComponentType }>;
    /** The events that summon this dialog; the first one to fire loads and mounts it. */
    triggerEvents: EventNames[];
}

/**
 * Mounts a dialog on demand: dialogs are summoned via events (with any results reported through
 * callbacks in the event data), so until the first summons there is no reason to have the dialog
 * or its module graph around. Once loaded, the dialog stays mounted and handles further events
 * itself.
 *
 * The buffered first event is re-delivered through the subtree's host component, which only
 * notifies handlers registered within this subtree (the wrapper and the dialog), not the rest of
 * the application. The re-delivery happens in an effect because parent effects run after the
 * children's, guaranteeing that the dialog's own event handlers are registered by then.
 *
 * Limitation: a second summons arriving while the dialog module is still being fetched replaces
 * the buffered event rather than queueing behind it.
 */
function LazyDialog({ loader, triggerEvents }: LazyDialogProps) {
    const parentComponent = useContext(ParentComponent);
    const [ Component, setComponent ] = useState<ComponentType>();
    const [ pendingEvent, setPendingEvent ] = useState<{ name: EventNames, data: unknown }>();
    const loadStarted = useRef(false);

    // Stable identity so it does not churn useTriliumEvents' handler registration on each of the
    // load's state updates.
    const handleSummons = useCallback(async (data: EventData<EventNames>, name: EventNames) => {
        // Guards against a second summons that arrives before the import resolves (the `Component`
        // state is still undefined then, so it cannot be used to short-circuit the load).
        if (loadStarted.current) return;
        loadStarted.current = true;
        const module = await loader();
        setComponent(() => module.default);
        setPendingEvent({ name, data });
    }, [ loader ]);
    useTriliumEvents(triggerEvents, handleSummons);

    useEffect(() => {
        // Wait for the host component as well: clearing pendingEvent before delivery would drop the
        // buffered summons. If the host is briefly unavailable, this effect re-runs once it appears.
        if (!Component || !pendingEvent || !parentComponent) return;
        // Once loaded, the dialog receives events directly through the shared host component.
        void parentComponent.handleEvent(pendingEvent.name, pendingEvent.data as EventData<EventNames>);
        setPendingEvent(undefined);
    }, [ Component, pendingEvent, parentComponent ]);

    return <div className="lazy-component">{Component && <Component />}</div>;
}

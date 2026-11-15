import "./layout_commons.css";

import { ComponentType, VNode } from "preact";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { CommandNames, EventData, EventNames } from "../components/app_context.js";
import Component from "../components/component.js";
import { applyAppearance, applyReloadedAppearance } from "../services/appearance.js";
import type BasicWidget from "../widgets/basic_widget.js";
import NoteList from "../widgets/collections/NoteList.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import FindWidget from "../widgets/find.js";
import InlineTitle from "../widgets/layout/InlineTitle.js";
import NoteBadges from "../widgets/layout/NoteBadges.js";
import NoteTitleActions from "../widgets/layout/NoteTitleActions.js";
import NoteIcon from "../widgets/note_icon.js";
import NoteTitleWidget, { NoteTypeSwitcherBar } from "../widgets/note_title.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import NoteDetail from "../widgets/NoteDetail.js";
import { useTriliumEvent, useTriliumEvents } from "../widgets/react/hooks/events.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import { useNoteProperty } from "../widgets/react/hooks/note.js";
import { useNoteContext } from "../widgets/react/hooks/note_context.js";
import { WithLazyModule } from "../widgets/react/LazyComponent.js";
import { ParentComponent, POPUP_EDITOR_NTX_ID } from "../widgets/react/react_utils.jsx";
import ScrollPadding from "../widgets/scroll_padding.js";
import ToastContainer from "../widgets/Toast.jsx";

/**
 * The dialogs, toasts and other overlays of every layout. Each dialog mounts on its first summons;
 * only the toasts are mounted from the start.
 */
export function modals(): VNode[] {
    return [
        <LazyDialog key="bulk_actions" triggerEvents={["openBulkActionsDialog"]} loader={() => import("../widgets/dialogs/bulk_actions.js")} />,
        <LazyDialog key="about" triggerEvents={["openAboutDialog"]} loader={() => import("../widgets/dialogs/about.js")} />,
        <LazyDialog key="help" triggerEvents={["showCheatsheet"]} loader={() => import("../widgets/dialogs/help.js")} />,
        <LazyDialog key="recent_changes" triggerEvents={["showRecentChanges", "showDeletedNotes"]} loader={() => import("../widgets/dialogs/recent_changes.js")} />,
        <LazyDialog key="branch_prefix" triggerEvents={["editBranchPrefix"]} loader={() => import("../widgets/dialogs/branch_prefix.js")} />,
        <LazyDialog key="sort_child_notes" triggerEvents={["sortChildNotes"]} loader={() => import("../widgets/dialogs/sort_child_notes.js")} />,
        <LazyDialog key="template_properties" triggerEvents={["showTemplateProperties"]} loader={() => import("../widgets/dialogs/template_properties.js")} />,
        <LazyDialog key="content_embed" triggerEvents={["showContentEmbedDialog"]} loader={() => import("../widgets/dialogs/content_embed.js")} />,
        <LazyDialog key="note_picker" triggerEvents={["showNotePickerDialog"]} loader={() => import("../widgets/dialogs/note_picker.js")} />,
        <LazyDialog key="note_type_chooser" triggerEvents={["chooseNoteType"]} loader={() => import("../widgets/dialogs/note_type_chooser.js")} />,
        <LazyDialog key="jump_to_note" triggerEvents={["jumpToNote", "commandPalette"]} loader={() => import("../widgets/dialogs/jump_to_note.js")} />,
        <LazyDialog key="edit_link" triggerEvents={["showEditLinkDialog"]} loader={() => import("../widgets/dialogs/edit_link.js")} />,
        <LazyDialog key="icon_picker" triggerEvents={["showIconPickerDialog"]} loader={() => import("../widgets/dialogs/icon_picker.js")} />,
        <LazyDialog key="insert_media" triggerEvents={["showInsertMediaDialog"]} loader={() => import("../widgets/dialogs/insert_media.js")} />,
        <LazyDialog key="clone_to" triggerEvents={["cloneNoteIdsTo"]} loader={() => import("../widgets/dialogs/clone_to.js")} />,
        <LazyDialog key="move_to" triggerEvents={["moveBranchIdsTo"]} loader={() => import("../widgets/dialogs/move_to.js")} />,
        <LazyDialog key="import" triggerEvents={["showImportDialog"]} loader={() => import("../widgets/dialogs/import/import_dialog.js")} />,
        <LazyDialog key="export" triggerEvents={["showExportDialog"]} loader={() => import("../widgets/dialogs/export.js")} />,
        <LazyDialog key="markdown_import" triggerEvents={["showPasteMarkdownDialog"]} loader={() => import("../widgets/dialogs/markdown_import.js")} />,
        <LazyDialog key="protected_session_password" triggerEvents={["showProtectedSessionPasswordDialog"]} loader={() => import("../widgets/dialogs/protected_session_password.js")} />,
        <LazyDialog key="protect_subtree" triggerEvents={["showProtectSubtreeDialog"]} loader={() => import("../widgets/dialogs/protect_subtree.js")} />,
        <LazyDialog key="revisions" triggerEvents={["showRevisions"]} loader={() => import("../widgets/dialogs/revisions.js")} />,
        <LazyDialog key="delete_notes" triggerEvents={["showDeleteNotesDialog"]} loader={() => import("../widgets/dialogs/delete_notes.js")} />,
        <LazyDialog key="print_preview" triggerEvents={["showPrintPreview"]} loader={() => import("../widgets/dialogs/print_preview.jsx")} />,
        <LazyDialog key="lightbox" triggerEvents={["showLightbox"]} loader={() => import("../widgets/dialogs/lightbox.js")} />,
        <LazyDialog key="tool_call_details" triggerEvents={["showToolCallDetails"]} loader={() => import("../widgets/dialogs/tool_call_details.js")} />,
        <LazyDialog key="info" triggerEvents={["showInfoDialog"]} loader={() => import("../widgets/dialogs/info.js")} />,
        <LazyDialog key="confirm" triggerEvents={["showConfirmDialog", "showConfirmDeleteNoteBoxWithNoteDialog"]} loader={() => import("../widgets/dialogs/confirm.js")} />,
        <LazyDialog key="prompt" triggerEvents={["showPromptDialog"]} loader={() => import("../widgets/dialogs/prompt.js")} />,
        <LazyDialog key="item_picker" triggerEvents={["showItemPickerDialog"]} loader={() => import("../widgets/dialogs/item_picker.js")} />,
        <LazyDialog key="incorrect_cpu_arch" triggerEvents={["showCpuArchWarning"]} loader={() => import("../widgets/dialogs/incorrect_cpu_arch.js")} />,
        <LazyDialog key="resource_download" triggerEvents={["showResourceDownloadDialog"]} loader={() => import("../widgets/dialogs/resource_download.js")} />,
        <LazyDialog key="options" triggerEvents={["showOptions"]} loader={() => import("../widgets/dialogs/OptionsDialog.jsx")} />,
        <LazyDialog key="content_languages" triggerEvents={["showContentLanguagesDialog"]} loader={() => import("../widgets/dialogs/content_languages.js")} />,
        <LazyDialog key="ocr_text" triggerEvents={["showOcrTextDialog"]} loader={() => import("../widgets/dialogs/ocr_text.js")} />,
        <LazyDialog key="upload_attachments" triggerEvents={["showUploadAttachmentsDialog"]} loader={() => import("../widgets/dialogs/upload_attachments.js")} />,
        <LazyDialog key="tree_popup_editor" triggerEvents={["openInTreePopup"]} loader={() => import("../widgets/dialogs/TreePopupEditor.jsx")} />,
        // The popup editors stay in the DOM once mounted (`keepInDom`), so only their first opening waits for the module.
        <LazyDialog key="popup_editor" triggerEvents={["openInPopup"]} loader={() => loadPopupEditor(POPUP_EDITOR_NTX_ID, "openInPopup")} />,
        <LazyDialog key="popup_editor_nested" triggerEvents={["openInNestedPopup"]} loader={() => loadPopupEditor(`${POPUP_EDITOR_NTX_ID}-nested`, "openInNestedPopup")} />,
        <LazyDialog key="shortcut_hints" triggerEvents={["shortcutHintsRequested"]} loader={() => import("../widgets/shortcut_hints/shortcut_hints_panel.jsx")} />,
        <LazyCallToAction key="call_to_action" />,
        // Mounted from the start, to show the messages and errors raised during startup.
        <ToastContainer key="toast" />
    ];
}

/** {@link modals} for a layout rendered by Preact, built once so that the layout's renders skip them. */
export function Modals() {
    const [ elements ] = useState(modals);
    return <>{elements}</>;
}

/** Loads the popup editor that opens on `openCommand` in the note context `ntxId`. */
async function loadPopupEditor(ntxId: string, openCommand: "openInPopup" | "openInNestedPopup") {
    const { default: PopupEditor } = await import("../widgets/dialogs/PopupEditor.jsx");
    return {
        default: () => <PopupEditor ntxId={ntxId} openCommand={openCommand} />
    };
}

/**
 * The call to action dialog, which has no summons: once the layout has rendered, it loads the
 * dialog only if one of `getCallToActions()` applies.
 */
function LazyCallToAction() {
    const [ Dialog, setDialog ] = useState<ComponentType>();

    useEffect(() => {
        let cancelled = false;
        void import("../widgets/dialogs/call_to_action_definitions.js").then(async ({ getCallToActions }) => {
            if (!getCallToActions().length) return;
            const { default: CallToActionDialog } = await import("../widgets/dialogs/call_to_action.jsx");
            if (!cancelled) setDialog(() => CallToActionDialog);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return <div className="lazy-component">{Dialog && <Dialog />}</div>;
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
 * The dialog registers its handlers on a `Component` of its own, a child of the parent component,
 * so further events reach it through the parent. The buffered first event is re-delivered to that
 * component alone, not to the rest of the application. The re-delivery happens in an effect because
 * parent effects run after the children's, so the dialog's own handlers are registered by then.
 *
 * Limitation: a second summons arriving while the dialog module is still being fetched replaces
 * the buffered event rather than queueing behind it.
 */
export function LazyDialog({ loader, triggerEvents }: LazyDialogProps) {
    const parentComponent = useContext(ParentComponent);
    const [ host ] = useState(() => new Component());
    const [ Dialog, setDialog ] = useState<ComponentType>();
    const [ pendingEvent, setPendingEvent ] = useState<{ name: EventNames, data: unknown }>();
    const loadStarted = useRef(false);

    useLayoutEffect(() => {
        if (!parentComponent) return;
        parentComponent.child(host);
        return () => parentComponent.removeChild(host);
    }, [ parentComponent, host ]);

    // Stable identity so it does not churn useTriliumEvents' handler registration on each of the
    // load's state updates.
    const handleSummons = useCallback(async (data: EventData<EventNames>, name: EventNames) => {
        // Guards against a second summons that arrives before the import resolves (the component
        // state is still undefined then, so it cannot be used to short-circuit the load).
        if (loadStarted.current) return;
        loadStarted.current = true;
        const module = await loader();
        setDialog(() => module.default);
        setPendingEvent({ name, data });
    }, [ loader ]);
    useTriliumEvents(triggerEvents, handleSummons);

    useEffect(() => {
        if (!Dialog || !pendingEvent) return;
        void host.handleEvent(pendingEvent.name, pendingEvent.data as EventData<EventNames>);
        setPendingEvent(undefined);
    }, [ Dialog, pendingEvent, host ]);

    return (
        <div className="lazy-component">
            {Dialog && (
                <ParentComponent.Provider value={host}>
                    <Dialog />
                </ParentComponent.Provider>
            )}
        </div>
    );
}

const loadSearchResult = () => import("../widgets/search_result.js");

/**
 * The results of a search note, whose module loads once a search note shows. The host keeps one
 * root element, which the legacy widget adapter requires, and takes no box of its own.
 */
function SearchResults() {
    const { note } = useNoteContext();
    const noteType = useNoteProperty(note, "type");

    return (
        <div className="search-result-host">
            {noteType === "search" && (
                <WithLazyModule load={loadSearchResult}>
                    {({ default: SearchResult }) => <SearchResult />}
                </WithLazyModule>
            )}
        </div>
    );
}

/**
 * Applies the appearance options to the body before the first paint, and again whenever they are
 * reloaded; see `applyAppearance()`.
 */
export function useAppearance() {
    useLayoutEffect(applyAppearance, []);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => applyReloadedAppearance(loadResults));
}

/**
 * Runs the command that an element of a legacy widget names in `data-trigger-command`, from the
 * widget it belongs to. A layout handles it on its root, for every legacy widget inside it.
 */
export function triggerLegacyCommand(e: MouseEvent) {
    const target = (e.target as Element).closest<HTMLElement>("[data-trigger-command]");
    if (!target || target.classList.contains("disabled")) return;

    const component = $(target).closest(".component").prop("component") as Component | undefined;
    void component?.triggerCommand(target.dataset.triggerCommand as CommandNames, { $el: $(target) });
}

type SplitPart = BasicWidget | VNode;

/** What a layout adds to the parts every note split has, each built anew for every split. */
export interface NoteSplitParts {
    /** Before the note's icon in the title row. */
    titleRowStart?: () => SplitPart[];
    /** After the note's badges in the title row. */
    titleRowEnd?: () => SplitPart[];
    /** Between the bar that picks the type of an empty note and the find bar. */
    beforeFind?: () => SplitPart[];
    /** After the find bar. */
    afterFind?: () => SplitPart[];
    /**
     * What goes in each gap around the split's children: the title row, the scroller, the bar that
     * picks the type of an empty note, the find bar and the parts around it, from the gap before the
     * first child to the one after the last. `split` is the same object for every gap of a split.
     */
    between?: (gap: number, builtInCount: number, split: object) => SplitPart[];
}

/**
 * One note split per note context of the active tab. Each has a title row (the note's icon, title
 * and badges) above a scroller with the note's inline title, title actions, content, list of child
 * notes, search results and scroll padding, then the bar that picks the type of an empty note and the
 * find bar, with the layout's own `parts` around them. `SplitNoteContainer` is a legacy widget, so
 * the splits are attached to a host element named by `containerId` and `containerClassName`.
 */
export function NoteSplits({ parts, containerId, containerClassName }: {
    parts: NoteSplitParts;
    containerId?: string;
    containerClassName?: string;
}) {
    const [ splits ] = useLegacyWidget(() => new SplitNoteContainer(() => {
        const children: SplitPart[] = [
            new FlexContainer("row")
                .class("title-row note-split-title")
                .child(...parts.titleRowStart?.() ?? [])
                .child(<NoteIcon />)
                .child(<NoteTitleWidget placement="split" />)
                .child(<NoteBadges />)
                .child(...parts.titleRowEnd?.() ?? []),
            new ScrollingContainer()
                .filling()
                .child(<InlineTitle />)
                .child(<NoteTitleActions />)
                .child(<NoteDetail />)
                .child(<NoteList media="screen" />)
                .child(<SearchResults />)
                .child(<ScrollPadding />),
            <NoteTypeSwitcherBar />,
            ...parts.beforeFind?.() ?? [],
            new FindWidget(),
            ...parts.afterFind?.() ?? []
        ];
        const wrapper = new NoteWrapperWidget();
        const split = {};
        for (const [ gap, child ] of children.entries()) {
            wrapper.child(...parts.between?.(gap, children.length, split) ?? [], child);
        }
        return wrapper.child(...parts.between?.(children.length, children.length, split) ?? []);
    }), { containerId, containerClassName });
    return splits;
}

import "./NoteDetail.css";

import { isValidElement, VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import NoteContext from "../components/note_context";
import FNote from "../entities/fnote";
import type { PrintReport } from "../print";
import attributes from "../services/attributes";
import dialog from "../services/dialog";
import { t } from "../services/i18n";
import protected_session_holder from "../services/protected_session_holder";
import toast from "../services/toast.js";
import { dynamicRequire, isElectron, isMobile } from "../services/utils";
import { ExtendedNoteType, TYPE_MAPPINGS, TypeWidget } from "./note_types";
import { useNoteContext, useTriliumEvent } from "./react/hooks";
import { NoteListWithLinks } from "./react/NoteList";
import { TypeWidgetProps } from "./type_widgets/type_widget";

/**
 * The note detail is in charge of rendering the content of a note, by determining its type (e.g. text, code) and using the appropriate view widget.
 *
 * Apart from that, it:
 * - Applies a full-height style depending on the content type (e.g. canvas notes).
 * - Focuses the content when switching tabs.
 * - Caches the note type elements based on what the user has accessed, in order to quickly load it again.
 * - Fixes the tree for launch bar configurations on mobile.
 * - Provides scripting events such as obtaining the active note detail widget, or note type widget.
 * - Printing and exporting to PDF.
 */
export default function NoteDetail() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { note, type, mime, noteContext, parentComponent } = useNoteInfo();
    const { ntxId, viewScope } = noteContext ?? {};
    const isFullHeight = checkFullHeight(noteContext, type);
    const [ noteTypesToRender, setNoteTypesToRender ] = useState<{ [ key in ExtendedNoteType ]?: (props: TypeWidgetProps) => VNode }>({});
    const [ activeNoteType, setActiveNoteType ] = useState<ExtendedNoteType>();
    const widgetRequestId = useRef(0);

    const props: TypeWidgetProps = {
        note: note!,
        viewScope,
        ntxId,
        parentComponent,
        noteContext
    };

    useEffect(() => {
        if (!type) return;
        const requestId = ++widgetRequestId.current;

        if (!noteTypesToRender[type]) {
            getCorrespondingWidget(type).then((el) => {
                if (!el) return;

                // Ignore stale requests
                if (requestId !== widgetRequestId.current) return;

                setNoteTypesToRender(prev => ({
                    ...prev,
                    [type]: el
                }));
                setActiveNoteType(type);
            });
        } else {
            setActiveNoteType(type);
        }
    }, [ note, viewScope, type, noteTypesToRender ]);

    // Detect note type changes.
    useTriliumEvent("entitiesReloaded", async ({ loadResults }) => {
        if (!note) return;

        // we're detecting note type change on the note_detail level, but triggering the noteTypeMimeChanged
        // globally, so it gets also to e.g. ribbon components. But this means that the event can be generated multiple
        // times if the same note is open in several tabs.

        if (note.noteId && loadResults.isNoteContentReloaded(note.noteId, parentComponent.componentId)) {
            // probably incorrect event
            // calling this.refresh() is not enough since the event needs to be propagated to children as well
            // FIXME: create a separate event to force hierarchical refresh

            // this uses handleEvent to make sure that the ordinary content updates are propagated only in the subtree
            // to avoid the problem in #3365
            parentComponent.handleEvent("noteTypeMimeChanged", { noteId: note.noteId });
        } else if (note.noteId
            && loadResults.isNoteReloaded(note.noteId, parentComponent.componentId)
            && (type !== (await getExtendedWidgetType(note, noteContext)) || mime !== note?.mime)) {
            // this needs to have a triggerEvent so that e.g., note type (not in the component subtree) is updated
            parentComponent.triggerEvent("noteTypeMimeChanged", { noteId: note.noteId });
        } else {
            const attrs = loadResults.getAttributeRows();

            const label = attrs.find(
                (attr) =>
                    attr.type === "label" &&
                    ["readOnly", "autoReadOnlyDisabled", "cssClass", "displayRelations", "hideRelations"].includes(attr.name ?? "") &&
                    attributes.isAffecting(attr, note)
            );

            const relation = attrs.find((attr) => attr.type === "relation" && ["template", "inherit", "renderNote"]
                .includes(attr.name ?? "") && attributes.isAffecting(attr, note));

            if (note.noteId && (label || relation)) {
                // probably incorrect event
                // calling this.refresh() is not enough since the event needs to be propagated to children as well
                parentComponent.triggerEvent("noteTypeMimeChanged", { noteId: note.noteId });
            }
        }
    });

    // Automatically focus the editor.
    useTriliumEvent("activeNoteChanged", ({ ntxId: eventNtxId }) => {
        if (eventNtxId != ntxId) return;
        // Restore focus to the editor when switching tabs,
        // but only if the note tree and the note panel (e.g., note title or note detail) are not focused.
        if (!document.activeElement?.classList.contains("fancytree-title") && !parentComponent.$widget[0].closest(".note-split")?.contains(document.activeElement)) {
            parentComponent.triggerCommand("focusOnDetail", { ntxId });
        }
    });

    // Fixed tree for launch bar config on mobile.
    useEffect(() => {
        if (!isMobile) return;
        const hasFixedTree = noteContext?.hoistedNoteId === "_lbMobileRoot";
        document.body.classList.toggle("force-fixed-tree", hasFixedTree);
    }, [ note ]);

    // Handle toast notifications.
    useEffect(() => {
        if (!isElectron()) return;
        const { ipcRenderer } = dynamicRequire("electron");
        const onPrintProgress = (_e: any, { progress, action }: { progress: number, action: "printing" | "exporting_pdf" }) => showToast(action, progress);
        const onPrintDone = (_e, printReport: PrintReport) => {
            toast.closePersistent("printing");
            handlePrintReport(printReport);
        };
        ipcRenderer.on("print-progress", onPrintProgress);
        ipcRenderer.on("print-done", onPrintDone);
        return () => {
            ipcRenderer.off("print-progress", onPrintProgress);
            ipcRenderer.off("print-done", onPrintDone);
        };
    }, []);

    useTriliumEvent("executeInActiveNoteDetailWidget", ({ callback }) => {
        if (!noteContext?.isActive()) return;
        callback(parentComponent);
    });

    useTriliumEvent("executeWithTypeWidget", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !activeNoteType || !containerRef.current) return;

        const classNameToSearch = TYPE_MAPPINGS[activeNoteType].className;
        const componentEl = containerRef.current.querySelector<HTMLElement>(`.${classNameToSearch}`);
        if (!componentEl) return;

        const component = glob.getComponentByEl(componentEl);
        resolve(component);
    });

    useTriliumEvent("printActiveNote", () => {
        if (!noteContext?.isActive() || !note) return;

        showToast("printing");

        if (isElectron()) {
            const { ipcRenderer } = dynamicRequire("electron");
            ipcRenderer.send("print-note", {
                notePath: noteContext.notePath
            });
        } else {
            const iframe = document.createElement('iframe');
            iframe.src = `?print#${noteContext.notePath}`;
            iframe.className = "print-iframe";
            document.body.appendChild(iframe);
            iframe.onload = () => {
                if (!iframe.contentWindow) {
                    toast.closePersistent("printing");
                    document.body.removeChild(iframe);
                    return;
                }

                iframe.contentWindow.addEventListener("note-load-progress", (e) => {
                    showToast("printing", e.detail.progress);
                });

                iframe.contentWindow.addEventListener("note-ready", (e) => {
                    toast.closePersistent("printing");

                    if ("detail" in e) {
                        handlePrintReport(e.detail as PrintReport);
                    }

                    iframe.contentWindow?.print();
                    document.body.removeChild(iframe);
                });
            };
        }
    });

    useTriliumEvent("exportAsPdf", () => {
        if (!noteContext?.isActive() || !note) return;
        showToast("exporting_pdf");

        const { ipcRenderer } = dynamicRequire("electron");
        ipcRenderer.send("export-as-pdf", {
            title: note.title,
            notePath: noteContext.notePath,
            pageSize: note.getAttributeValue("label", "printPageSize") ?? "Letter",
            landscape: note.hasAttribute("label", "printLandscape")
        });
    });

    return (
        <div
            ref={containerRef}
            class={`note-detail ${isFullHeight ? "full-height" : ""}`}
        >
            {Object.entries(noteTypesToRender).map(([ itemType, Element ]) => {
                return <NoteDetailWrapper
                    Element={Element}
                    key={itemType}
                    type={itemType as ExtendedNoteType}
                    isVisible={type === itemType}
                    isFullHeight={isFullHeight}
                    props={props}
                />;
            })}
        </div>
    );
}

/**
 * Wraps a single note type widget, in order to keep it in the DOM even after the user has switched away to another note type. This allows faster loading of the same note type again. The properties are cached, so that they are updated only
 * while the widget is visible, to avoid rendering in the background. When not visible, the DOM element is simply hidden.
 */
function NoteDetailWrapper({ Element, type, isVisible, isFullHeight, props }: { Element: (props: TypeWidgetProps) => VNode, type: ExtendedNoteType, isVisible: boolean, isFullHeight: boolean, props: TypeWidgetProps }) {
    const [ cachedProps, setCachedProps ] = useState(props);

    useEffect(() => {
        if (isVisible) {
            setCachedProps(props);
        } else {
            // Do nothing, keep the old props.
        }
    }, [ props, isVisible ]);

    const typeMapping = TYPE_MAPPINGS[type];
    return (
        <div
            className={`${typeMapping.className} ${typeMapping.printable ? "note-detail-printable" : ""} ${isVisible ? "visible" : "hidden-ext"}`}
            style={{
                height: isFullHeight ? "100%" : ""
            }}
        >
            { <Element {...cachedProps} /> }
        </div>
    );
}

/** Manages both note changes and changes to the widget type, which are asynchronous. */
function useNoteInfo() {
    const { note: actualNote, noteContext, parentComponent } = useNoteContext();
    const [ note, setNote ] = useState<FNote | null | undefined>();
    const [ type, setType ] = useState<ExtendedNoteType>();
    const [ mime, setMime ] = useState<string>();

    function refresh() {
        getExtendedWidgetType(actualNote, noteContext).then(type => {
            setNote(actualNote);
            setType(type);
            setMime(actualNote?.mime);
        });
    }

    useEffect(refresh, [ actualNote, noteContext, noteContext?.viewScope ]);
    useTriliumEvent("readOnlyTemporarilyDisabled", ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext?.ntxId !== noteContext?.ntxId) return;
        refresh();
    });
    useTriliumEvent("noteTypeMimeChanged", refresh);

    return { note, type, mime, noteContext, parentComponent };
}

async function getCorrespondingWidget(type: ExtendedNoteType): Promise<null | TypeWidget> {
    const correspondingType = TYPE_MAPPINGS[type].view;
    if (!correspondingType) return null;

    const result = await correspondingType();

    if ("default" in result) {
        return result.default;
    } else if (isValidElement(result)) {
        // Direct VNode provided.
        return result;
    }
    return result;

}

export async function getExtendedWidgetType(note: FNote | null | undefined, noteContext: NoteContext | undefined): Promise<ExtendedNoteType | undefined> {
    if (!noteContext) return undefined;
    if (!note) {
        // If the note is null, then it's a new tab. If it's undefined, then it's not loaded yet.
        return note === null ? "empty" : undefined;
    }

    const type = note.type;
    let resultingType: ExtendedNoteType;

    if (noteContext?.viewScope?.viewMode === "source") {
        resultingType = "readOnlyCode";
    } else if (noteContext.viewScope?.viewMode === "attachments") {
        resultingType = noteContext.viewScope.attachmentId ? "attachmentDetail" : "attachmentList";
    } else if (noteContext.viewScope?.viewMode === "note-map") {
        resultingType = "noteMap";
    } else if (type === "text" && (await noteContext?.isReadOnly())) {
        resultingType = "readOnlyText";
    } else if ((type === "code" || type === "mermaid") && (await noteContext?.isReadOnly())) {
        resultingType = "readOnlyCode";
    } else if (type === "text") {
        resultingType = "editableText";
    } else if (type === "code") {
        resultingType = "editableCode";
    } else if (type === "launcher") {
        resultingType = "doc";
    } else {
        resultingType = type;
    }

    if (note.isProtected && !protected_session_holder.isProtectedSessionAvailable()) {
        resultingType = "protectedSession";
    }

    return resultingType;
}

export function checkFullHeight(noteContext: NoteContext | undefined, type: ExtendedNoteType | undefined) {
    if (!noteContext) return false;

    // https://github.com/zadam/trilium/issues/2522
    const isBackendNote = noteContext?.noteId === "_backendLog";
    const isSqlNote = noteContext.note?.mime === "text/x-sqlite;schema=trilium";
    const isFullHeightNoteType = type && TYPE_MAPPINGS[type].isFullHeight;
    return (!noteContext?.hasNoteList() && isFullHeightNoteType && !isSqlNote)
        || noteContext?.viewScope?.viewMode === "attachments"
        || isBackendNote;
}

function showToast(type: "printing" | "exporting_pdf", progress: number = 0) {
    toast.showPersistent({
        icon: "bx bx-loader-circle bx-spin",
        message: type === "printing" ? t("note_detail.printing") : t("note_detail.printing_pdf"),
        id: "printing",
        progress
    });
}

function handlePrintReport(printReport: PrintReport) {
    if (printReport.type === "collection" && printReport.ignoredNoteIds.length > 0) {
        toast.showPersistent({
            id: "print-report",
            icon: "bx bx-collection",
            title: t("note_detail.print_report_title"),
            message: t("note_detail.print_report_collection_content", { count: printReport.ignoredNoteIds.length }),
            buttons: [
                {
                    text: t("note_detail.print_report_collection_details_button"),
                    onClick(api) {
                        api.dismissToast();
                        dialog.info(<>
                            <h3>{t("note_detail.print_report_collection_details_ignored_notes")}</h3>
                            <NoteListWithLinks noteIds={printReport.ignoredNoteIds} />
                        </>, {
                            title: t("note_detail.print_report_title"),
                            size: "md"
                        });
                    }
                }
            ]
        });
    }
}

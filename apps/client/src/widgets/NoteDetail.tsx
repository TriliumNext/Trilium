import { useNoteContext, useTriliumEvent } from "./react/hooks"
import FNote from "../entities/fnote";
import protected_session_holder from "../services/protected_session_holder";
import { useEffect, useRef, useState } from "preact/hooks";
import NoteContext from "../components/note_context";
import { isValidElement, VNode } from "preact";
import { TypeWidgetProps } from "./type_widgets/type_widget";
import "./NoteDetail.css";
import attributes from "../services/attributes";
import { ExtendedNoteType, TYPE_MAPPINGS } from "./note_types";

/**
 * The note detail is in charge of rendering the content of a note, by determining its type (e.g. text, code) and using the appropriate view widget.
 *
 * Apart from that:
 * - It applies a full-height style depending on the content type (e.g. canvas notes).
 * - Focuses the content when switching tabs.
 * - Caches the note type elements based on what the user has accessed, in order to quickly load it again.
 */
export default function NoteDetail() {
    const { note, type, mime, noteContext, parentComponent } = useNoteInfo();
    const { ntxId, viewScope } = noteContext ?? {};
    const isFullHeight = checkFullHeight(noteContext, type);
    const noteTypesToRender = useRef<{ [ key in ExtendedNoteType ]?: (props: TypeWidgetProps) => VNode }>({});
    const [ activeNoteType, setActiveNoteType ] = useState<ExtendedNoteType>();

    const props: TypeWidgetProps = {
        note: note!,
        viewScope,
        ntxId,
        parentComponent,
        noteContext
    };
    useEffect(() => {
        if (!type) return;

        if (!noteTypesToRender.current[type]) {
            getCorrespondingWidget(type).then((el) => {
                if (!el) return;
                noteTypesToRender.current[type] = el;
                setActiveNoteType(type);
            });
        } else {
            setActiveNoteType(type);
        }
    }, [ note, viewScope, type ]);

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
            && (type !== (await getWidgetType(note, noteContext)) || mime !== note?.mime)) {
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
    useTriliumEvent("activeNoteChanged", () => {
        // Restore focus to the editor when switching tabs, but only if the note tree is not already focused.
        if (!document.activeElement?.classList.contains("fancytree-title")) {
            parentComponent.triggerCommand("focusOnDetail", { ntxId });
        }
    });

    return (
        <div class={`note-detail ${isFullHeight ? "full-height" : ""}`}>
            {Object.entries(noteTypesToRender.current).map(([ type, Element ]) => {
                return <NoteDetailWrapper
                    Element={Element}
                    key={type}
                    type={type as ExtendedNoteType}
                    isVisible={activeNoteType === type}
                    props={props}
                />
            })}
        </div>
    );
}

/**
 * Wraps a single note type widget, in order to keep it in the DOM even after the user has switched away to another note type. This allows faster loading of the same note type again. The properties are cached, so that they are updated only
 * while the widget is visible, to avoid rendering in the background. When not visible, the DOM element is simply hidden.
 */
function NoteDetailWrapper({ Element, type, isVisible, props }: { Element: (props: TypeWidgetProps) => VNode, type: ExtendedNoteType, isVisible: boolean, props: TypeWidgetProps }) {
    const [ cachedProps, setCachedProps ] = useState(props);

    useEffect(() => {
        if (isVisible) {
            setCachedProps(props);
        } else {
            // Do nothing, keep the old props.
        }
    }, [ isVisible ]);

    return (
        <div className={`note-detail-${type}`} style={{
            display: !isVisible ? "none" : ""
        }}>
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
        getWidgetType(actualNote, noteContext).then(type => {
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

async function getCorrespondingWidget(type: ExtendedNoteType): Promise<null | ((props: TypeWidgetProps) => VNode)> {
    const correspondingType = TYPE_MAPPINGS[type].view;
    if (!correspondingType) return null;

    const result = await correspondingType();

    if ("default" in result) {
        return result.default;
    } else if (isValidElement(result)) {
        // Direct VNode provided.
        return result;
    } else {
        return result;
    }
}

async function getWidgetType(note: FNote | null | undefined, noteContext: NoteContext | undefined): Promise<ExtendedNoteType> {
    if (!note) {
        console.log("Returning empty because no note.");
        return "empty";
    }

    const type = note.type;
    let resultingType: ExtendedNoteType;

    if (noteContext?.viewScope?.viewMode === "source") {
        resultingType = "readOnlyCode";
    } else if (noteContext?.viewScope && noteContext.viewScope.viewMode === "attachments") {
        resultingType = noteContext.viewScope.attachmentId ? "attachmentDetail" : "attachmentList";
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

function checkFullHeight(noteContext: NoteContext | undefined, type: ExtendedNoteType | undefined) {
    if (!noteContext) return false;

    // https://github.com/zadam/trilium/issues/2522
    const isBackendNote = noteContext?.noteId === "_backendLog";
    const isSqlNote = noteContext.note?.mime === "text/x-sqlite;schema=trilium";
    const isFullHeightNoteType = ["canvas", "webView", "noteMap", "mindMap", "mermaid", "file", "aiChat"].includes(type ?? "");
    return (!noteContext?.hasNoteList() && isFullHeightNoteType && !isSqlNote)
        || noteContext?.viewScope?.viewMode === "attachments"
        || isBackendNote;
}

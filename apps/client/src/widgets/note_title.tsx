import "./note_title.css";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../components/app_context";
import type NoteContext from "../components/note_context";
import branches from "../services/branches";
import froca from "../services/froca";
import { t } from "../services/i18n";
import protected_session_holder from "../services/protected_session_holder";
import server from "../services/server";
import { isIMEComposing } from "../services/shortcuts";
import { shouldShowInlineTitle } from "./layout/InlineTitle";
import FormTextBox from "./react/FormTextBox";
import { useNoteContext, useNoteProperty, useSpacedUpdate, useTriliumEvents, useTriliumOption } from "./react/hooks";

/**
 * Where a title sits in a note split, which has one in its title row and one in `InlineTitle`.
 * Elsewhere (popups, embedded panes) the title is the only one and has no placement.
 */
export type TitlePlacement = "split" | "inline";

export default function NoteTitleWidget({ className, placement }: {
    className?: string;
    placement?: TitlePlacement;
}) {
    const { note, noteId, componentId, viewScope, noteContext, parentComponent } = useNoteContext();
    const title = useNoteProperty(note, "title", componentId);
    const isProtected = useNoteProperty(note, "isProtected");
    const newTitle = useRef("");

    const [ isReadOnly, setReadOnly ] = useState<boolean>(false);
    const [ isLocked, setLocked ] = useState<boolean>(false);
    const [ navigationTitle, setNavigationTitle ] = useState<string | null>(null);

    // Manage read-only
    useEffect(() => {
        const isLocked = !!note?.isProtected
            && !protected_session_holder.isProtectedSessionAvailable();
        const isReadOnly = note === null
            || note === undefined
            || isLocked
            || note.isTitleReadOnly
            || viewScope?.viewMode !== "default";
        setLocked(isLocked);
        setReadOnly(isReadOnly);
    }, [ note, note?.noteId, note?.isProtected, viewScope?.viewMode ]);

    // Manage the title for read-only notes
    useEffect(() => {
        if (isReadOnly) {
            noteContext?.getNavigationTitle().then(setNavigationTitle);
        }
    }, [note, isReadOnly]);

    // Save changes to title.
    const spacedUpdate = useSpacedUpdate(async () => {
        // A deleted note is gone from `froca`, and the server refuses its changes.
        if (!note || !(note.noteId in froca.notes)) {
            return;
        }
        protected_session_holder.touchProtectedSessionIfNecessary(note);
        await server.put<void>(`notes/${noteId}/title`, { title: newTitle.current }, componentId);
    });

    // Prevent user from navigating away if the spaced update is not done.
    useEffect(() => {
        const listener = () => spacedUpdate.isAllSavedAndTriggerUpdate();
        appContext.addBeforeUnloadListener(listener);
        return () => appContext.removeBeforeUnloadListener(listener);
    }, []);
    useTriliumEvents([ "beforeNoteSwitch", "beforeNoteContextRemove" ], () => spacedUpdate.updateNowIfNecessary());

    // Manage focus.
    const textBoxRef = useRef<HTMLInputElement>(null);
    const isNewNote = useRef<boolean | undefined>(undefined);
    const pendingSelect = useRef<boolean>(false);

    // Re-apply selection when title changes if we have a pending select.
    // This handles the case where the server sends back entity changes after we've
    // already called select(), which causes the controlled input to re-render and lose selection.
    useEffect(() => {
        if (pendingSelect.current && textBoxRef.current && document.activeElement === textBoxRef.current) {
            textBoxRef.current.select();
            pendingSelect.current = false;
        }
    }, [title]);

    const pendingFocus = useRef<FocusRequest | null>(null);
    const [ titleStyle ] = useTriliumOption("noteTitleStyle");

    function focusIfVisible(request: FocusRequest) {
        const textBox = textBoxRef.current;
        // A split has two NoteTitleWidget instances, the title row's and InlineTitle's; the hidden
        // one stays out.
        if (!textBox?.checkVisibility({ checkOpacity: true })) {
            return false;
        }

        textBox.focus();
        if (request.select) {
            textBox.select();
            pendingSelect.current = true;
        }
        isNewNote.current = request.isNewNote;
        return true;
    }

    useTriliumEvents([ "focusOnTitle", "focusAndSelectTitle" ], (e, eventName) => {
        // When the event targets a specific context (e.g. a popup's own context, which is never
        // "active" in the tab manager), match on it; otherwise fall back to the active context.
        const isTargeted = e.ntxId ? e.ntxId === noteContext?.ntxId : noteContext?.isActive();
        if (!isTargeted || !noteContext?.noteId) {
            return;
        }

        const request: FocusRequest = {
            noteId: noteContext.noteId,
            select: eventName === "focusAndSelectTitle",
            isNewNote: ("isNewNote" in e ? e.isNewNote : false) ?? false
        };
        // `note_create` asks for the title right after `setNote()`, which can come before this
        // widget and `InlineTitle` render the new note; the request then waits for that render.
        const isRendered = note?.noteId === request.noteId;
        pendingFocus.current = isRendered ? null : request;
        if (isRendered) {
            focusIfVisible(request);
        }
    });

    useLayoutEffect(() => {
        const request = pendingFocus.current;
        if (!request || !noteContext || note?.noteId !== noteContext.noteId) {
            return;
        }
        pendingFocus.current = null;
        if (request.noteId !== noteContext.noteId || !ownsTitle(placement, noteContext, titleStyle)) {
            return;
        }

        // `InlineTitle` shows its title and hides the title row's a render after the note arrives,
        // and that render leaves this widget alone, so the visibility check retries on later frames.
        let frame = 0;
        let framesLeft = MAX_FOCUS_FRAMES;
        const tryFocus = () => {
            if (focusIfVisible(request) || --framesLeft <= 0) return;
            frame = requestAnimationFrame(tryFocus);
        };
        tryFocus();
        return () => cancelAnimationFrame(frame);
    }, [ note ]);

    return (
        <div className={clsx("note-title-widget", className)}>
            {note && <FormTextBox
                inputRef={textBoxRef}
                autocomplete="off"
                currentValue={isLocked
                    ? t("protected_session.locked_note_title")
                    : (!isReadOnly ? title : navigationTitle) ?? ""}
                placeholder={t("note_title.placeholder")}
                className={clsx(
                    "note-title",
                    isProtected && "protected",
                    isLocked && "protected-title"
                )}
                tabIndex={100}
                readOnly={isReadOnly}
                onChange={(newValue) => {
                    newTitle.current = newValue;
                    spacedUpdate.scheduleUpdate();
                }}
                onKeyDown={(e) => {
                    // User started typing, stop re-applying selection
                    pendingSelect.current = false;

                    // Skip processing if IME is composing to prevent interference
                    // with text input in CJK languages
                    if (isIMEComposing(e)) {
                        return;
                    }

                    // Pressing Enter moves to the note content. For text notes this inserts a new empty
                    // paragraph at the top of the document (Notion-like) rather than just focusing.
                    if (e.key === "Enter") {
                        e.preventDefault();
                        parentComponent.triggerCommand("focusOnDetail", { ntxId: noteContext?.ntxId, insertNewlineAtTop: true });
                        return;
                    }

                    if (e.key === "Escape" && isNewNote.current && noteContext?.isActive() && note) {
                        branches.deleteNotes(Object.values(note.parentToBranch));
                    }
                }}
                onBlur={() => {
                    pendingSelect.current = false;
                    spacedUpdate.updateNowIfNecessary();
                    isNewNote.current = false;
                }}
            />}
        </div>
    );
}

/** How many frames a title waits to become visible before a focus request for it is dropped. */
const MAX_FOCUS_FRAMES = 10;

interface FocusRequest {
    noteId: string;
    select: boolean;
    isNewNote: boolean;
}

/** Whether the title at `placement` is the one a split shows for its current note. */
function ownsTitle(placement: TitlePlacement | undefined, noteContext: NoteContext, titleStyle: string) {
    if (!placement) {
        return true;
    }
    const note = noteContext.note;
    const showsInlineTitle = shouldShowInlineTitle(note, note?.type, noteContext.viewScope, titleStyle);
    return showsInlineTitle === (placement === "inline");
}

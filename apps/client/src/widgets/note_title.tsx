import "./note_title.css";

import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../components/app_context";
import branches from "../services/branches";
import { t } from "../services/i18n";
import protected_session_holder from "../services/protected_session_holder";
import server from "../services/server";
import { isIMEComposing } from "../services/shortcuts";
import FormTextBox from "./react/FormTextBox";
import { useNoteContext, useNoteProperty, useSpacedUpdate, useTriliumEvent, useTriliumEvents } from "./react/hooks";

export default function NoteTitleWidget(props: {className?: string}) {
    const { note, noteId, componentId, viewScope, noteContext, parentComponent } = useNoteContext();
    const title = useNoteProperty(note, "title", componentId);
    const isProtected = useNoteProperty(note, "isProtected");
    const newTitle = useRef("");

    const [ isReadOnly, setReadOnly ] = useState<boolean>(false);
    const [ navigationTitle, setNavigationTitle ] = useState<string | null>(null);

    // Manage read-only
    useEffect(() => {
        const isReadOnly = note === null
            || note === undefined
            || (note.isProtected && !protected_session_holder.isProtectedSessionAvailable())
            || note.isMetadataReadOnly
            || viewScope?.viewMode !== "default";
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
        if (!note) {
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
    const isNewNote = useRef<boolean>();
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

    useTriliumEvents([ "focusOnTitle", "focusAndSelectTitle" ], (e, eventName) => {
        if (noteContext?.isActive() && textBoxRef.current) {
            // In the new layout, there are two NoteTitleWidget instances. Only handle if visible.
            if (!textBoxRef.current.checkVisibility({ checkOpacity: true })) {
                return;
            }

            textBoxRef.current.focus();
            if (eventName === "focusAndSelectTitle") {
                textBoxRef.current.select();
                pendingSelect.current = true;
            }
            isNewNote.current = ("isNewNote" in e ? e.isNewNote : false);
        }
    });

    return (
        <div className={clsx("note-title-widget", props.className)}>
            {note && <FormTextBox
                inputRef={textBoxRef}
                autocomplete="off"
                currentValue={(!isReadOnly ? title : navigationTitle) ?? ""}
                placeholder={t("note_title.placeholder")}
                className={`note-title ${isProtected ? "protected" : ""}`}
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

                    // Focus on the note content when pressing enter.
                    if (e.key === "Enter") {
                        e.preventDefault();
                        parentComponent.triggerCommand("focusOnDetail", { ntxId: noteContext?.ntxId });
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

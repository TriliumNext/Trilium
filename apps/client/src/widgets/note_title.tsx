import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../services/i18n";
import FormTextBox from "./react/FormTextBox";
import { useNoteContext, useNoteProperty, useSpacedUpdate, useTriliumEvent, useTriliumEvents } from "./react/hooks";
import protected_session_holder from "../services/protected_session_holder";
import server from "../services/server";
import "./note_title.css";
import { isLaunchBarConfig } from "../services/utils";
import appContext from "../components/app_context";
import branches from "../services/branches";
import { isIMEComposing } from "../services/shortcuts";
import clsx from "clsx";

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
            || isLaunchBarConfig(note.noteId)
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
    useTriliumEvents([ "focusOnTitle", "focusAndSelectTitle" ], (e, eventName) => {
        if (noteContext?.isActive() && textBoxRef.current) {
            textBoxRef.current.focus();
            if (eventName === "focusAndSelectTitle") {
                textBoxRef.current.select();
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
                    spacedUpdate.updateNowIfNecessary();
                    isNewNote.current = false;
                }}
            />}
        </div>
    );
}

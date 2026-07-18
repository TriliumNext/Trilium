import "./Toast.css";

import clsx from "clsx";
import { useEffect } from "preact/hooks";

import { removeToastFromStore, ToastOptionsWithRequiredId, toasts } from "../services/toast";
import Button from "./react/Button";
import Icon from "./react/Icon";
import NoteLink from "./react/NoteLink";

export default function ToastContainer() {
    return (
        <div id="toast-container">
            {toasts.value.map(toast => <Toast key={toast.id} {...toast} />)}
        </div>
    );
}

function Toast({ id, title, timeout, progress, message, messageMonospace, icon, buttons, dismissible, wide, notes, notesHeading }: ToastOptionsWithRequiredId) {
    // Autohide.
    useEffect(() => {
        if (!timeout || timeout <= 0) return;
        const timerId = setTimeout(() => removeToastFromStore(id), timeout);
        return () => clearTimeout(timerId);
    }, [ id, timeout ]);

    function dismissToast() {
        removeToastFromStore(id);
    }

    // `dismissible === false` hides the × entirely (the operation runs regardless of the toast, so a close
    // button there would misleadingly read as "cancel").
    const closeButton = dismissible === false ? null : (
        <button
            type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"
            onClick={dismissToast}
        />
    );
    const toastIcon = <Icon icon={icon.startsWith("bx ") ? icon : `bx bx-${icon}`} />;

    return (
        <div
            class={clsx("toast", !title && "no-title", dismissible === false && "not-dismissible", wide && "wide")}
            role="alert" aria-live="assertive" aria-atomic="true"
            id={`toast-${id}`}
        >
            {title ? (
                <>
                    <div class="toast-header">
                        <strong class="me-auto">
                            {toastIcon}
                            <span class="toast-title">{title}</span>
                        </strong>
                        {closeButton}
                    </div>
                    <div className={clsx("toast-body", messageMonospace && "monospace")}>{message}</div>
                </>
            ) : (
                <div class="toast-main-row">
                    <div class="toast-icon">{toastIcon}</div>
                    <div className={clsx("toast-body", messageMonospace && "monospace")}>{message}</div>
                    {closeButton && <div class="toast-close">{closeButton}</div>}
                </div>
            )}

            {notes && notes.length > 0 && (
                <div class="toast-notes">
                    {notesHeading && <div class="toast-notes-heading">{notesHeading}</div>}
                    <div class="toast-notes-list">
                        {notes
                            .map(note => (typeof note === "string" ? { noteId: note } : note))
                            .map(({ noteId, description }) => (
                                <NoteLink key={noteId} notePath={noteId} showNoteIcon noPreview showNotePath titleSuffix={description} />
                            ))}
                    </div>
                </div>
            )}

            {buttons && (
                <div class="toast-buttons">
                    {buttons.map(({ text, onClick }) => (
                        <Button text={text} onClick={() => onClick({ dismissToast })} />
                    ))}
                </div>
            )}

            <div
                class="toast-progress"
                style={{ width: `${(progress ?? 0) * 100}%` }}
            />
        </div>
    );
}

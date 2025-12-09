import "./Toast.css";

import clsx from "clsx";
import { useEffect } from "preact/hooks";

import { removeToastFromStore, ToastOptionsWithRequiredId, toasts } from "../services/toast";
import Icon from "./react/Icon";
import { RawHtmlBlock } from "./react/RawHtml";
import Button from "./react/Button";

export default function ToastContainer() {
    return (
        <div id="toast-container">
            {toasts.value.map(toast => <Toast key={toast.id} {...toast} />)}
        </div>
    )
}

function Toast({ id, title, timeout, progress, message, icon, buttons }: ToastOptionsWithRequiredId) {
    // Autohide.
    useEffect(() => {
        if (!timeout || timeout <= 0) return;
        const timerId = setTimeout(() => removeToastFromStore(id), timeout);
        return () => clearTimeout(timerId);
    }, [ id, timeout ]);

    function dismissToast() {
        removeToastFromStore(id);
    }

    const closeButton = (
        <button
            type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"
            onClick={dismissToast}
        />
    );
    const toastIcon = <Icon icon={icon.startsWith("bx ") ? icon : `bx bx-${icon}`} />;

    return (
        <div
            class={clsx("toast", !title && "no-title")}
            role="alert" aria-live="assertive" aria-atomic="true"
            id={`toast-${id}`}
        >
            {title ? (
                <div class="toast-header">
                    <strong class="me-auto">
                        {toastIcon}
                        <span class="toast-title">{title}</span>
                    </strong>
                    {closeButton}
                </div>
            ) : (
                <div class="toast-icon">{toastIcon}</div>
            )}

            <RawHtmlBlock className="toast-body" html={message} />

            {!title && <div class="toast-header">{closeButton}</div>}

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
    )
}

import Modal from "../react/Modal";
import Button from "../react/Button";
import { t } from "../../services/i18n";
import { useState } from "preact/hooks";
import FormCheckbox from "../react/FormCheckbox";
import { useTriliumEvent } from "../react/hooks";

interface ConfirmDialogProps {
    title?: string;
    message?: string | HTMLElement;
    callback?: ConfirmDialogCallback;
    isConfirmDeleteNoteBox?: boolean;   
}

export default function ConfirmDialog() {
    const [ opts, setOpts ] = useState<ConfirmDialogProps>();
    const [ isDeleteNoteChecked, setIsDeleteNoteChecked ] = useState(false);
    const [ shown, setShown ] = useState(false);

    function showDialog(title: string | null, message: MessageType, callback: ConfirmDialogCallback, isConfirmDeleteNoteBox: boolean) {
        setOpts({
            title: title ?? undefined,
            message: (typeof message === "object" && "length" in message ? message[0] : message),
            callback,
            isConfirmDeleteNoteBox
        });
        setShown(true);
    }

    useTriliumEvent("showConfirmDialog", ({ message, callback }) => showDialog(null, message, callback, false));
    useTriliumEvent("showConfirmDeleteNoteBoxWithNoteDialog", ({ title, callback }) => showDialog(title, t("confirm.are_you_sure_remove_note", { title: title }), callback, true));

    return ( 
        <Modal
            className="confirm-dialog"
            title={opts?.title ?? t("confirm.confirmation")}
            size="md"
            zIndex={2000}
            scrollable={true}
            onHidden={() => {
                opts?.callback?.({
                    confirmed: false,
                    isDeleteNoteChecked
                });
                setShown(false);
            }}
            footer={<>
                <Button text={t("confirm.cancel")} onClick={() => setShown(false)} />
                <Button text={t("confirm.ok")} onClick={() => {
                    opts?.callback?.({
                        confirmed: true,
                        isDeleteNoteChecked
                    });
                    setShown(false);
                }} />
            </>}
            show={shown}
            stackable
        >
            {!opts?.message || typeof opts?.message === "string"
                ? <div>{(opts?.message as string) ?? ""}</div>
                : <div dangerouslySetInnerHTML={{ __html: opts?.message.outerHTML ?? "" }} />}

            {opts?.isConfirmDeleteNoteBox && (
                <FormCheckbox
                    name="confirm-dialog-delete-note"
                    label={t("confirm.also_delete_note")}
                    hint={t("confirm.if_you_dont_check")}
                    currentValue={isDeleteNoteChecked} onChange={setIsDeleteNoteChecked} />
            )}
        </Modal>
    );
}

export type ConfirmDialogResult = false | ConfirmDialogOptions;
export type ConfirmDialogCallback = (val?: ConfirmDialogResult) => void;
type MessageType = string | HTMLElement | JQuery<HTMLElement>;

export interface ConfirmDialogOptions {
    confirmed: boolean;
    isDeleteNoteChecked: boolean;
}

export interface ConfirmWithMessageOptions {
    message: MessageType;
    callback: ConfirmDialogCallback;
}

// For "showConfirmDialog"
export interface ConfirmWithTitleOptions {
    title: string;
    callback: ConfirmDialogCallback;
}

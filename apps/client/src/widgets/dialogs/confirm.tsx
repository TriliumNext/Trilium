import "./confirm.css";

import Modal from "../react/Modal";
import Button from "../react/Button";
import { t } from "../../services/i18n";
import { describeNoteDeletion, type NoteDeletionTarget, planNoteDeletion } from "../../services/note_deletion";
import { useMemo, useRef, useState } from "preact/hooks";
import FormCheckbox from "../react/FormCheckbox";
import { useTriliumEvent } from "../react/hooks";
import { isValidElement, type VNode } from "preact";
import { RawHtmlBlock } from "../react/RawHtml";

interface ConfirmDialogProps {
    title?: string;
    message?: MessageType;
    callback?: ConfirmDialogCallback;
    isConfirmDeleteNoteBox?: boolean;
    deletionTarget?: NoteDeletionTarget;
    mustDeleteNote?: boolean;
}

export default function ConfirmDialog() {
    const [ opts, setOpts ] = useState<ConfirmDialogProps>();
    const [ isDeleteNoteChecked, setIsDeleteNoteChecked ] = useState(false);
    const [ shown, setShown ] = useState(false);
    const okButtonRef = useRef<HTMLButtonElement>(null);

    // What ticking the box would cost, worked out here rather than by whoever opened the dialog: the
    // question is the same wherever it is asked from, and a caller that had to answer it for itself
    // would be a caller that could get it wrong.
    const deleteNoteDescription = useMemo(() => {
        const { noteId, branchId } = opts?.deletionTarget ?? {};
        return noteId ? describeNoteDeletion(planNoteDeletion(noteId, branchId)) : undefined;
    }, [ opts?.deletionTarget ]);

    // Removing the note from where it is shown may leave nothing to decide: a view whose note *is*
    // what it draws (a GPX track on a geo map) cannot take it off and keep it, so the box would be
    // one the reader had to tick to get anywhere. The outcome is still shown, being the whole of
    // what the dialog has to say then.
    const deleteNote = opts?.mustDeleteNote || isDeleteNoteChecked;

    function showDialog(title: string | null, message: MessageType, callback: ConfirmDialogCallback, isConfirmDeleteNoteBox: boolean, deletionTarget?: NoteDeletionTarget, mustDeleteNote?: boolean) {
        setOpts({
            title: title ?? undefined,
            message,
            callback,
            isConfirmDeleteNoteBox,
            deletionTarget,
            mustDeleteNote
        });
        // The dialog is mounted once and lives for the session (see LazyDialog), so a box left
        // ticked would still be ticked the next time it is asked about — a destructive default
        // carried over to another note, and to whichever part of the app asks next.
        setIsDeleteNoteChecked(false);
        setShown(true);
    }

    useTriliumEvent("showConfirmDialog", ({ message, callback }) => showDialog(null, message, callback, false));
    useTriliumEvent("showConfirmDeleteNoteBoxWithNoteDialog", ({ title, message, callback, deletionTarget, mustDeleteNote }) => showDialog(title, message ?? t("confirm.are_you_sure_remove_note", { title: title }), callback, true, deletionTarget, mustDeleteNote));

    return (
        <Modal
            className="confirm-dialog"
            title={opts?.title ?? t("confirm.confirmation")}
            size="md"
            zIndex={2000}
            scrollable={true}
            onShown={() => okButtonRef.current?.focus()}
            onHidden={() => {
                opts?.callback?.({
                    confirmed: false,
                    isDeleteNoteChecked: deleteNote
                });
                setShown(false);
            }}
            footer={<>
                <Button text={t("confirm.cancel")} onClick={() => setShown(false)} />
                <Button buttonRef={okButtonRef} text={t("confirm.ok")} onClick={() => {
                    opts?.callback?.({
                        confirmed: true,
                        isDeleteNoteChecked: deleteNote
                    });
                    setShown(false);
                }} />
            </>}
            show={shown}
            stackable
        >
            {isValidElement(opts?.message)
            ? opts?.message
            : <RawHtmlBlock html={opts?.message} />
            }

            {opts?.isConfirmDeleteNoteBox && (<>
                {!opts.mustDeleteNote && (
                    <FormCheckbox
                        name="confirm-dialog-delete-note"
                        label={t("confirm.also_delete_note")}
                        currentValue={isDeleteNoteChecked} onChange={setIsDeleteNoteChecked} />
                )}

                {/* What the answer means, written out rather than hidden in a tooltip on the box's
                    label: the two answers do quite different things to the tree, and which one a
                    tick would be is not something the reader should have to hover to find out. The
                    line is there in both states so ticking the box does not shift the dialog. */}
                <p className="confirm-delete-note-outcome">
                    {deleteNote
                        ? deleteNoteDescription
                        : t("confirm.if_you_dont_check")}
                </p>
            </>)}
        </Modal>
    );
}

export type ConfirmDialogResult = false | ConfirmDialogOptions;
export type ConfirmDialogCallback = (val?: ConfirmDialogResult) => void;
export type MessageType = string | HTMLElement | JQuery<HTMLElement> | VNode;

export interface ConfirmDialogOptions {
    confirmed: boolean;
    isDeleteNoteChecked: boolean;
}

export interface ConfirmWithMessageOptions {
    message: MessageType;
    callback: ConfirmDialogCallback;
}

/**
 * How a view asking to remove a note wants the question put, over and above the note itself.
 *
 * Both are things only the caller can know — where the note is being removed *from*, and whether
 * removing it there can mean anything other than deleting it.
 */
export interface ConfirmDeleteNoteBoxOptions {
    /**
     * The question, where the stock one does not fit. It names where the note is being removed from,
     * which is the one thing about this dialog only the caller can say.
     */
    message?: MessageType;
    /**
     * Removing the note from where it is shown necessarily deletes it, so there is nothing to offer
     * a choice about: the checkbox is left out and the answer comes back as though it were ticked.
     * For a view whose note *is* what it draws — a GPX track on a geo map, whose line is drawn from
     * the note's own file — there is no taking it off and keeping it.
     */
    mustDeleteNote?: boolean;
}

// For "showConfirmDeleteNoteBoxWithNoteDialog"
export interface ConfirmWithTitleOptions extends ConfirmDeleteNoteBoxOptions {
    title: string;
    callback: ConfirmDialogCallback;
    /**
     * The note being removed, and the placement it is being removed from. Given it, the dialog says
     * for itself what ticking "Also delete the note" would cost (see {@link NoteDeletionTarget});
     * without it the box is offered bare, as it was before it could tell.
     */
    deletionTarget?: NoteDeletionTarget;
}

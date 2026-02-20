import { useRef, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import Modal from "../react/Modal";
import FormTextBox from "../react/FormTextBox";
import FormGroup from "../react/FormGroup";
import { refToJQuerySelector } from "../react/react_utils";
import { useTriliumEvent } from "../react/hooks";

// JQuery here is maintained for compatibility with existing code.
interface ShownCallbackData {
    $dialog: JQuery<HTMLDivElement>;
    $question: JQuery<HTMLLabelElement> | null;
    $answer: JQuery<HTMLElement> | null;
    $form: JQuery<HTMLFormElement>;
}

export type PromptShownDialogCallback = ((callback: ShownCallbackData) => void) | null;

export interface PromptDialogOptions {
    title?: string;
    message?: string;
    defaultValue?: string;
    shown?: PromptShownDialogCallback;
    callback?: (value: string | null) => void;
    readOnly?: boolean;
}

export default function PromptDialog() {
    const modalRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const labelRef = useRef<HTMLLabelElement>(null);
    const answerRef = useRef<HTMLInputElement>(null);
    const opts = useRef<PromptDialogOptions>();
    const [ value, setValue ] = useState("");
    const [ shown, setShown ] = useState(false);
    const submitValue = useRef<string>(null);

    useTriliumEvent("showPromptDialog", (newOpts) => {
        opts.current = newOpts;
        setValue(newOpts.defaultValue ?? "");
        setShown(true);
    })

    return (
        <Modal
            className="prompt-dialog"
            title={opts.current?.title ?? t("prompt.title")}
            size="lg"
            zIndex={2000}
            modalRef={modalRef} formRef={formRef}
            onShown={() => {
                opts.current?.shown?.({
                    $dialog: refToJQuerySelector(modalRef),
                    $question: refToJQuerySelector(labelRef),
                    $answer: refToJQuerySelector(answerRef),
                    $form: refToJQuerySelector(formRef)
                });
                answerRef.current?.focus();
                answerRef.current?.select();
            }}
            onSubmit={() => {
                submitValue.current = value;
                setShown(false);
            }}
            onHidden={() => {
                setShown(false);
                opts.current?.callback?.(submitValue.current);
                submitValue.current = null;
                opts.current = undefined;
            }}
            footer={<Button text={t("prompt.ok")} keyboardShortcut="Enter" kind="primary" />}
            show={shown}
            stackable
        >
            <FormGroup name="prompt-dialog-answer" label={opts.current?.message} labelRef={labelRef}>
                <FormTextBox
                    inputRef={answerRef}
                    currentValue={value} onChange={setValue}
                    readOnly={opts.current?.readOnly}
                />
            </FormGroup>
        </Modal>
    );
}

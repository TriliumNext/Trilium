import { EventData } from "../../components/app_context";
import Modal, { type ModalProps } from "../react/Modal";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import { useRef, useState } from "preact/hooks";
import { RawHtmlBlock } from "../react/RawHtml";
import { useTriliumEvent } from "../react/hooks";
import { isValidElement } from "preact";
import { ConfirmWithMessageOptions } from "./confirm";
import "./info.css";
import server from "../../services/server";
import { ToMarkdownResponse } from "@triliumnext/commons";
import { copyTextWithToast } from "../../services/clipboard_ext";

export interface InfoExtraProps extends Partial<Pick<ModalProps, "size" | "title">> {
    /** Adds a button in the footer that allows easily copying the content of the infobox to clipboard. */
    copyToClipboardButton?: boolean;
}

export type InfoProps = ConfirmWithMessageOptions & InfoExtraProps;

export default function InfoDialog() {
    const modalRef = useRef<HTMLDivElement>(null);
    const [ opts, setOpts ] = useState<EventData<"showInfoDialog">>();
    const [ shown, setShown ] = useState(false);
    const okButtonRef = useRef<HTMLButtonElement>(null);

    useTriliumEvent("showInfoDialog", (opts) => {
        setOpts(opts);
        setShown(true);
    });

    return (<Modal
        className="info-dialog"
        size={opts?.size ?? "sm"}
        title={opts?.title ?? t("info.modalTitle")}
        onHidden={() => {
            opts?.callback?.();
            setShown(false);
        }}
        onShown={() => okButtonRef.current?.focus?.()}
        modalRef={modalRef}
        footer={<>
            {opts?.copyToClipboardButton && (
                <Button
                    text={t("info.copy_to_clipboard")}
                    icon="bx bx-copy"
                    onClick={async () => {
                        const htmlContent = modalRef.current?.querySelector<HTMLDivElement>(".modal-body")?.innerHTML;
                        if (!htmlContent) return;

                        const { markdownContent } = await server.post<ToMarkdownResponse>("other/to-markdown", { htmlContent });
                        copyTextWithToast(markdownContent);
                    }}
                />
            )}

            <Button
                buttonRef={okButtonRef}
                text={t("info.okButton")}
                onClick={() => setShown(false)}
            />
        </>}
        show={shown}
        stackable
        scrollable
    >
        {isValidElement(opts?.message)
        ? opts?.message
        : <RawHtmlBlock className="info-dialog-content" html={opts?.message} />
        }
    </Modal>);
}

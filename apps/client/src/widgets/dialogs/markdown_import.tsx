import { useRef, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import Modal from "../react/Modal";
import Button from "../react/Button";
import { useTriliumEvent } from "../react/hooks";
import { CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";
import { RenderMarkdownResponse } from "@triliumnext/commons";

export interface MarkdownImportOpts {
    editorApi: CKEditorApi;
}

export default function MarkdownImportDialog() {
    const markdownImportTextArea = useRef<HTMLTextAreaElement>(null);
    const editorApiRef = useRef<CKEditorApi>(null);
    const [ text, setText ] = useState("");
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showPasteMarkdownDialog", ({ editorApi }) => {
        if (utils.isElectron()) {
            const { clipboard } = utils.dynamicRequire("electron");
            const text = clipboard.readText();

            convertMarkdownToHtml(text, editorApi);
        } else {
            editorApiRef.current = editorApi;
            setShown(true);
        }
    });

    function submit() {
        setShown(false);
        if (editorApiRef.current && text) {
            convertMarkdownToHtml(text, editorApiRef.current);
        }
    }

    return (
        <Modal
            className="markdown-import-dialog" title={t("markdown_import.dialog_title")} size="lg"
            footer={
                <Button
                    className="markdown-import-button"
                    text={t("markdown_import.import_button")}
                    keyboardShortcut="Ctrl+Enter"
                    onClick={submit}
                />
            }
            onShown={() => markdownImportTextArea.current?.focus()}
            onHidden={() => {
                setShown(false);
                setText("");
            }}
            show={shown}
        >
            <p>{t("markdown_import.modal_body_text")}</p>
            <textarea ref={markdownImportTextArea} value={text}
                onInput={(e) => setText(e.currentTarget.value)}
                style={{ height: 340, width: "100%" }}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) {
                        e.preventDefault();
                        submit();
                    }
                }}></textarea>
        </Modal>
    )
}

async function convertMarkdownToHtml(markdownContent: string, textTypeWidget: CKEditorApi) {
    const { htmlContent } = await server.post<RenderMarkdownResponse>("other/render-markdown", { markdownContent });
    textTypeWidget.addHtmlToEditor(htmlContent);
    toast.showMessage(t("markdown_import.import_success"));
}

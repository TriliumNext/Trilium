import { useCallback, useRef, useState } from "preact/hooks";
import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import Modal from "../react/Modal";
import Button from "../react/Button";
import { useTriliumEvent } from "../react/hooks";
import EditableTextTypeWidget from "../type_widgets/editable_text";

interface RenderMarkdownResponse {
    htmlContent: string;
}

export default function MarkdownImportDialog() {
    const markdownImportTextArea = useRef<HTMLTextAreaElement>(null);
    const [textTypeWidget, setTextTypeWidget] = useState<EditableTextTypeWidget>();
    const [ text, setText ] = useState("");
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showPasteMarkdownDialog", ({ textTypeWidget }) => {
        setTextTypeWidget(textTypeWidget);
        if (utils.isElectron()) {
            const { clipboard } = utils.dynamicRequire("electron");
            const text = clipboard.readText();
    
            convertMarkdownToHtml(text, textTypeWidget);
        } else {
            setShown(true);
        }
    });

    return (
        <Modal
            className="markdown-import-dialog" title={t("markdown_import.dialog_title")} size="lg"
            footer={<Button className="markdown-import-button" text={t("markdown_import.import_button")} onClick={() => setShown(false)} keyboardShortcut="Ctrl+Enter" />}
            onShown={() => markdownImportTextArea.current?.focus()}
            onHidden={async () => {
                if (textTypeWidget) {
                    await convertMarkdownToHtml(text, textTypeWidget);
                }
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
                        setShown(false);
                    }
                }}></textarea>
        </Modal>
    )
}

async function convertMarkdownToHtml(markdownContent: string, textTypeWidget: EditableTextTypeWidget) {
    const { htmlContent } = await server.post<RenderMarkdownResponse>("other/render-markdown", { markdownContent });

    await textTypeWidget.addHtmlToEditor(htmlContent);
    
    toast.showMessage(t("markdown_import.import_success"));
}
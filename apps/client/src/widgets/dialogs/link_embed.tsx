import { useRef, useState } from "preact/hooks";
import linkEmbedService from "../../services/link_embed";
import type { LinkPasteMode } from "../../services/link_embed";
import FormGroup from "../react/FormGroup";
import Modal from "../react/Modal";
import Button from "../react/Button";
import { useTriliumEvent } from "../react/hooks";
import type { CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";

export interface LinkEmbedOpts {
    editorApi: CKEditorApi;
}

export default function LinkEmbedDialog() {
    const editorApiRef = useRef<CKEditorApi>(null);
    const [url, setUrl] = useState("");
    const [mode, setMode] = useState<LinkPasteMode>("embed");
    const [shown, setShown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useTriliumEvent("showLinkEmbedDialog", ({ editorApi }) => {
        editorApiRef.current = editorApi;
        setUrl("");
        setMode("embed");
        setShown(true);
    });

    const handleSubmit = async () => {
        const trimmedUrl = url.trim();
        if (!trimmedUrl || !editorApiRef.current) return;

        if (mode === "url") {
            editorApiRef.current.addLinkToEditor(trimmedUrl, trimmedUrl);
        } else {
            const metadata = await linkEmbedService.fetchMetadata(trimmedUrl);
            if (mode === "mention") {
                editorApiRef.current.addLinkMention(metadata);
            } else {
                editorApiRef.current.addLinkEmbed(metadata);
            }
        }
        setShown(false);
    };

    return (
        <Modal
            className="link-embed-dialog"
            title="Insert link"
            size="lg"
            onShown={() => inputRef.current?.focus()}
            onHidden={() => setShown(false)}
            onSubmit={handleSubmit}
            footer={<Button text="Insert" keyboardShortcut="Enter" />}
            show={shown}
        >
            <FormGroup name="url" label="URL">
                <input
                    ref={inputRef}
                    type="url"
                    className="form-control"
                    placeholder="https://example.com or https://youtube.com/watch?v=..."
                    value={url}
                    onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
                />
            </FormGroup>
            <FormGroup name="mode" label="Paste as">
                <div className="btn-group w-100">
                    {(["mention", "url", "embed"] as const).map((m) => (
                        <button
                            key={m}
                            type="button"
                            className={`btn btn-sm ${mode === m ? "btn-primary" : "btn-outline-secondary"}`}
                            onClick={() => setMode(m)}
                        >
                            {m === "mention" ? "@ Mention" : m === "url" ? "URL" : "Embed"}
                        </button>
                    ))}
                </div>
            </FormGroup>
        </Modal>
    );
}

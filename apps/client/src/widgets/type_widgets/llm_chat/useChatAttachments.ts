import type { LlmAttachmentKind, LlmModelInfo } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useRef } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import {
    nativeAttachmentKind, readsAttachmentKind, resolveSelectedModel, unreadableAttachments
} from "../../../services/llm_providers.js";
import server from "../../../services/server.js";
import toast from "../../../services/toast.js";
import type { LightboxOptions } from "../../dialogs/lightbox.js";
import { getPdfUrl } from "../file/PdfViewer.js";
import type { FileBlock, ImageBlock, TextFileBlock } from "./llm_chat_types.js";
import type { AttachmentBlock, UseLlmChatReturn } from "./useLlmChat.js";

/**
 * MIME types we accept as image attachments. The first four are what every
 * major provider supports natively as vision input. SVG is treated as an image
 * here — the chip and message bubble render it inline — but the server detects
 * the SVG mime and sends the XML source as a text part, since no provider
 * accepts SVG as a vision input.
 */
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml"];
/** Binary file MIME types we accept (provider-side handling). PDFs are supported by Anthropic, OpenAI, Google. */
const ACCEPTED_BINARY_FILE_TYPES = ["application/pdf"];
/**
 * File extensions we treat as text. The browser often reports an empty or
 * generic MIME for source code, so extension-based detection is the practical
 * approach. The server decodes the bytes as UTF-8 and inlines them as text.
 */
const ACCEPTED_TEXT_EXTENSIONS = [
    ".txt", ".md", ".markdown", ".rst", ".log",
    ".csv", ".tsv",
    ".json", ".yaml", ".yml", ".xml", ".toml", ".ini", ".env",
    ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".c", ".cc", ".cpp", ".h", ".hpp",
    ".java", ".kt", ".swift", ".php", ".lua", ".pl", ".scala",
    ".sh", ".bash", ".zsh", ".sql",
    ".html", ".htm", ".css", ".scss", ".vue", ".svelte"
];


/** Best-effort classification of an uploaded file. */
type UploadKind = "image" | "binary_file" | "text_file" | null;

function classifyUpload(file: File): UploadKind {
    if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return "image";
    if (ACCEPTED_BINARY_FILE_TYPES.includes(file.type)) return "binary_file";
    if (file.type.startsWith("text/")) return "text_file";
    const lowerName = file.name.toLowerCase();
    if (ACCEPTED_TEXT_EXTENSIONS.some(ext => lowerName.endsWith(ext))) return "text_file";
    return null;
}

/**
 * Extract the Trilium attachment ID from one of the URLs returned by
 * `notes/{id}/attachments/upload`. Image roles return `api/attachments/<id>/image/<title>`;
 * file roles return `#root/<noteId>?viewMode=attachments&attachmentId=<id>`.
 */
function parseAttachmentIdFromUploadUrl(url: string): string | null {
    const imageMatch = url.match(/attachments\/([^/]+)\/image\//);
    if (imageMatch) return imageMatch[1];
    const fileMatch = url.match(/attachmentId=([^&]+)/);
    if (fileMatch) return fileMatch[1];
    return null;
}

/**
 * Upload a file as an attachment to the chat note and return a block describing
 * it. The server's `notes/{id}/attachments/upload` endpoint sorts images and
 * non-images into different attachment roles and returns different URL shapes;
 * we unify them back into a typed block here based on the client's
 * pre-classification.
 */
async function uploadFileAsAttachment(noteId: string, file: File, kind: UploadKind): Promise<AttachmentBlock | null> {
    let detail: string | undefined;
    try {
        const result = await server.upload(
            `notes/${noteId}/attachments/upload`,
            file, undefined, "POST"
        ) as { uploaded?: boolean; url?: string; message?: string };
        if (result?.uploaded && result.url) {
            const attachmentId = parseAttachmentIdFromUploadUrl(result.url);
            if (attachmentId) {
                if (kind === "image") {
                    return {
                        type: "image",
                        attachmentId,
                        mime: file.type,
                        title: file.name,
                        url: result.url
                    } satisfies ImageBlock;
                }
                if (kind === "text_file") {
                    return {
                        type: "text_file",
                        attachmentId,
                        mime: file.type || "text/plain",
                        title: file.name,
                        url: result.url
                    } satisfies TextFileBlock;
                }
                return {
                    type: "file",
                    attachmentId,
                    mime: file.type,
                    title: file.name,
                    url: result.url
                } satisfies FileBlock;
            }
        }
        detail = result?.message;
    } catch (e) {
        detail = e instanceof Error ? e.message : undefined;
    }

    const base = t("llm_chat.attachment_upload_failed", { name: file.name });
    toast.showError(detail ? `${base} ${detail}` : base);
    return null;
}

export interface UseChatAttachmentsReturn {
    /** Ref to plug into the hidden `<input type="file">`. */
    fileInputRef: RefObject<HTMLInputElement>;
    /** Value for the `accept` attribute of the hidden file input. */
    acceptAttr: string;
    /**
     * Always-fresh paste handler. The DOM `paste` listener on CKEditor is
     * registered once when the editor mounts, but `chat.chatNoteId` arrives
     * later via a parent useEffect — registering through this ref means the
     * listener always reads the current closure.
     */
    pasteHandlerRef: { current: (e: ClipboardEvent) => void };
    /** Programmatically open the file picker — wire to the attach button. */
    openFilePicker: () => void;
    /** `onChange` handler for the hidden file input. */
    handleFilePickerChange: (e: Event) => Promise<void>;
    /** `onDrop` handler for the form element. */
    handleDrop: (e: DragEvent) => Promise<void>;
    /** `onDragOver` handler for the form element (required for `onDrop` to fire). */
    handleDragOver: (e: DragEvent) => void;
}

/**
 * Manages clipboard / drag-drop / file-picker uploads for the chat input. Each
 * accepted file is uploaded as an attachment of the current chat note and
 * appended to the chat's pending-attachments list — the parent component just
 * wires the returned handlers into its JSX.
 */
export function useChatAttachments(chat: UseLlmChatReturn): UseChatAttachmentsReturn {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pasteHandlerRef = useRef<(e: ClipboardEvent) => void>(() => {});

    const uploadFile = useCallback(async (file: File) => {
        if (!chat.chatNoteId) return;
        const kind = classifyUpload(file);
        if (!kind) {
            toast.showError(t("llm_chat.attachment_unsupported_type", { name: file.name }));
            return;
        }
        const model = resolveSelectedModel(chat.availableModels, chat.selectedModel, chat.selectedProvider, chat.selectedProviderId);
        const refusal = uploadRefusal(model, file, kind);
        if (refusal) {
            toast.showError(refusal);
            return;
        }
        const block = await uploadFileAsAttachment(chat.chatNoteId, file, kind);
        if (block) {
            chat.addPendingAttachment(block);
        }
    }, [chat]);

    const handleFilePickerChange = useCallback(async (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        if (!files) return;
        for (const file of Array.from(files)) {
            await uploadFile(file);
        }
        // Reset so the same file can be picked again later.
        target.value = "";
    }, [uploadFile]);

    const handlePaste = useCallback(async (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pastedFiles: File[] = [];
        for (const item of Array.from(items)) {
            if (item.kind !== "file") continue;
            const file = item.getAsFile();
            if (file && classifyUpload(file)) {
                pastedFiles.push(file);
            }
        }
        if (pastedFiles.length === 0) return;
        // Stop CKEditor from also pasting the file (e.g. an image as a base64
        // data URL) — we want it as an attachment, not embedded markup.
        e.preventDefault();
        e.stopPropagation();
        for (const file of pastedFiles) {
            await uploadFile(file);
        }
    }, [uploadFile]);
    pasteHandlerRef.current = handlePaste;

    const handleDrop = useCallback(async (e: DragEvent) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        for (const file of Array.from(files)) {
            await uploadFile(file);
        }
    }, [uploadFile]);

    const handleDragOver = useCallback((e: DragEvent) => {
        // Required for the drop event to fire.
        if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
        }
    }, []);

    const openFilePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const model = resolveSelectedModel(chat.availableModels, chat.selectedModel, chat.selectedProvider, chat.selectedProviderId);

    return {
        fileInputRef,
        acceptAttr: acceptAttrFor(model),
        pasteHandlerRef,
        openFilePicker,
        handleFilePickerChange,
        handleDrop,
        handleDragOver
    };
}

/** `accept` for the file input: what `model` reads natively, plus SVGs and text files, which every model gets as text. */
export function acceptAttrFor(model: LlmModelInfo | undefined): string {
    const images = readsAttachmentKind(model, "image") ? ACCEPTED_IMAGE_TYPES : [ "image/svg+xml" ];
    const files = readsAttachmentKind(model, "file") ? ACCEPTED_BINARY_FILE_TYPES : [];
    return [ ...images, ...files, ...ACCEPTED_TEXT_EXTENSIONS ].join(",");
}

/** Why `model` can't read an attachment of `kind`. */
export function unreadableReason(model: LlmModelInfo, kind: LlmAttachmentKind): string {
    return t(`llm_chat.attachment_model_cannot_read_${kind}`, { model: model.name });
}

/** Why `model` can't read each of `attachments`, by attachment ID; readable ones are left out. */
export function getUnreadableReasons(
    model: LlmModelInfo | undefined,
    attachments: AttachmentBlock[]
): Map<string, string> {
    const reasons = new Map<string, string>();
    for (const att of unreadableAttachments(model, attachments)) {
        const kind = nativeAttachmentKind(att.type, att.mime);
        if (model && kind) {
            reasons.set(att.attachmentId, unreadableReason(model, kind));
        }
    }
    return reasons;
}

/** The error for a file `model` can't read, which is then not uploaded; undefined when it can. */
export function uploadRefusal(model: LlmModelInfo | undefined, file: File, kind: Exclude<UploadKind, null>): string | undefined {
    const nativeKind = nativeAttachmentKind(kind === "binary_file" ? "file" : kind, file.type);
    if (!model || !nativeKind || readsAttachmentKind(model, nativeKind)) {
        return undefined;
    }
    return t("llm_chat.attachment_refused", { name: file.name, reason: unreadableReason(model, nativeKind) });
}

/**
 * What the lightbox shows for an attachment: an image, or a PDF read through
 * `attachments/<id>/open`. Other files have no preview and return `undefined`.
 */
export function getAttachmentLightbox(att: AttachmentBlock): LightboxOptions | undefined {
    if (att.type === "image") {
        return { src: att.url, title: att.title };
    }
    if (att.type === "file" && att.mime === "application/pdf") {
        return { src: getPdfUrl(`attachments/${att.attachmentId}/open`), kind: "pdf", title: att.title };
    }
    return undefined;
}

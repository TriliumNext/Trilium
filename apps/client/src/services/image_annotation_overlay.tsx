import { useEffect, useRef, useState } from "preact/hooks";
import { Excalidraw, exportToBlob, getSceneVersion } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

import FAttachment from "../entities/fattachment";
import type FNote from "../entities/fnote";
import { t } from "./i18n";
import { attachmentTitle, BG_ELEMENT_ID, BG_FILE_ID, buildInitialData, ownerNoteId } from "./image_annotation_utils.js";
import server from "./server";
import "./image_annotation.css";

export interface AnnotationOverlayProps {
    entity: FNote | FAttachment;
    imageUrl: string;
    onClose: () => void;
    onSaved?: (newUrl: string) => void;
}

const ATTACHMENT_ROLE = "imageAnnotations";

type SaveStatus = "saved" | "saving" | "unsaved";

interface StoredScene {
    version: 2;
    elements: object[];
    files?: Record<string, object>;
    originalImageDataUrl: string;
    bgWidth: number;
    bgHeight: number;
}

interface AttachmentMeta { attachmentId: string; title: string; role: string; }

async function loadScene(entity: FNote | FAttachment): Promise<StoredScene | null> {
    try {
        const noteId = ownerNoteId(entity);
        const title = attachmentTitle(entity);
        const list = await server.get<AttachmentMeta[]>(`notes/${noteId}/attachments`);
        const ann = list?.find((a) => a.title === title && a.role === ATTACHMENT_ROLE);
        if (!ann) return null;
        const blob = await server.get<{ content: string }>(`attachments/${ann.attachmentId}/blob`);
        if (!blob?.content) return null;
        const parsed = JSON.parse(blob.content);
        if (parsed.version !== 2) return null;
        return parsed as StoredScene;
    } catch {
        return null;
    }
}

async function persistScene(entity: FNote | FAttachment, scene: StoredScene): Promise<void> {
    await server.post(`notes/${ownerNoteId(entity)}/attachments?matchBy=title`, {
        role: ATTACHMENT_ROLE,
        title: attachmentTitle(entity),
        mime: "application/json",
        content: JSON.stringify(scene),
    });
}

interface BgData { dataUrl: string; width: number; height: number; }

function loadBgImage(url: string): Promise<BgData> {
    return new Promise((resolve, reject) => {
        function tryLoad(cors: boolean) {
            const img = new Image();
            if (cors) img.crossOrigin = "Anonymous";
            img.onload = () => {
                const c = document.createElement("canvas");
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext("2d")!.drawImage(img, 0, 0);
                resolve({ dataUrl: c.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => cors ? tryLoad(false) : reject(new Error("Cannot load image"));
            img.src = url;
        }
        tryLoad(true);
    });
}

export function AnnotationOverlay({ entity, imageUrl, onClose, onSaved }: AnnotationOverlayProps) {
    const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sceneMetaRef = useRef<Pick<StoredScene, "originalImageDataUrl" | "bgWidth" | "bgHeight"> | null>(null);
    const lastSavedUrlRef = useRef<string | null>(null);

    const sceneVersionRef = useRef<number | null>(null);

    useEffect(() => {
        async function init() {
            const existing = await loadScene(entity);

            let originalDataUrl: string;
            let width: number;
            let height: number;
            let elements: object[];

            let storedFiles: Record<string, object> = {};

            if (existing) {
                ({ originalImageDataUrl: originalDataUrl, bgWidth: width, bgHeight: height } = existing);
                elements = existing.elements;
                storedFiles = existing.files ?? {};
            } else {
                const bg = await loadBgImage(imageUrl);
                originalDataUrl = bg.dataUrl;
                width = bg.width;
                height = bg.height;
                elements = [];
            }

            sceneMetaRef.current = { originalImageDataUrl: originalDataUrl, bgWidth: width, bgHeight: height };
            setInitialData(buildInitialData(originalDataUrl, width, height, elements, storedFiles));
        }
        init().catch(() => setLoadError(true));
    }, [entity, imageUrl]);

    async function doSave(): Promise<void> {
        if (!sceneMetaRef.current || !apiRef.current) return;
        setSaveStatus("saving");
        try {
            const allElements = apiRef.current.getSceneElements();
            const annElements = (allElements as any[]).filter((e) => e.id !== BG_ELEMENT_ID && !e.isDeleted);
            const files = apiRef.current.getFiles();

            const annFiles: Record<string, object> = {};
            for (const [id, file] of Object.entries(files)) {
                if (id !== BG_FILE_ID) annFiles[id] = file;
            }

            await persistScene(entity, { version: 2, elements: annElements, files: annFiles, ...sceneMetaRef.current! });

            const { bgWidth: width, bgHeight: height } = sceneMetaRef.current;

            const blob = await exportToBlob({
                elements: allElements.filter((e) => !e.isDeleted) as any,
                files,
                appState: { exportBackground: true, viewBackgroundColor: "#121212", theme: "dark" } as any,
                mimeType: "image/png",
                exportPadding: 0,
                getDimensions: () => ({ width, height, scale: 1 }),
            });

            const file = new File([blob], entity.title, { type: "image/png" });
            let newUrl: string;

            if (entity instanceof FAttachment) {
                await server.upload(`attachments/${entity.attachmentId}/file`, file);
                newUrl = `api/attachments/${entity.attachmentId}/image/${encodeURIComponent(entity.title)}?${Date.now()}`;
            } else {
                await server.upload(`images/${entity.noteId}`, file);
                newUrl = `api/images/${entity.noteId}/${encodeURIComponent(entity.title)}?${Date.now()}`;
            }

            lastSavedUrlRef.current = newUrl;
            setSaveStatus("saved");
        } catch (err) {
            console.error("Auto-save failed:", err);
            setSaveStatus("unsaved");
        }
    }

    function handleChange() {
        if (!sceneMetaRef.current || !apiRef.current) return;

        const newVersion = getSceneVersion(apiRef.current.getSceneElements());

        if (sceneVersionRef.current === null) {
            sceneVersionRef.current = newVersion;
            return;
        }

        if (newVersion === sceneVersionRef.current) return;
        sceneVersionRef.current = newVersion;

        setSaveStatus("unsaved");
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(doSave, 1500);
    }

    async function handleBack() {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        if (saveStatus !== "saved") {
            await doSave();
        }
        if (lastSavedUrlRef.current) onSaved?.(lastSavedUrlRef.current);
        onClose();
    }

    const handleBackRef = useRef(handleBack);
    useEffect(() => { handleBackRef.current = handleBack; });

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            handleBackRef.current();
        };
        document.addEventListener("keydown", onKey, { capture: true });
        return () => document.removeEventListener("keydown", onKey, { capture: true });
    }, []);

    const saveLabel = saveStatus === "saving"
        ? t("image_annotation.saving")
        : saveStatus === "unsaved"
            ? t("image_annotation.unsaved")
            : t("image_annotation.saved");

    return (
        <div className="embedded-ann-overlay">
            <div className="embedded-ann-header">
                <button
                    type="button"
                    className="embedded-ann-back"
                    onClick={handleBack}
                    disabled={saveStatus === "saving"}
                    title={t("image_annotation.back")}
                >
                    <span className="bx bx-arrow-back" />
                </button>
                <span className="embedded-ann-title">{entity.title}</span>
                <span className={`embedded-ann-save-status embedded-ann-save-status--${saveStatus}`}>
                    {saveLabel}
                </span>
            </div>

            <div className="embedded-ann-body">
                {loadError ? (
                    <span className="embedded-ann-status">Failed to load image.</span>
                ) : !initialData ? (
                    <span className="embedded-ann-status">Loading…</span>
                ) : (
                    <Excalidraw
                        theme="light"
                        initialData={initialData}
                        excalidrawAPI={(api) => {
                            apiRef.current = api;
                            setTimeout(() => {
                                const bg = api.getSceneElements().find((el) => el.id === BG_ELEMENT_ID);
                                if (bg) api.scrollToContent(bg, { fitToViewport: true, viewportZoomFactor: 0.95 });
                            }, 50);
                        }}
                        onChange={handleChange}
                        UIOptions={{
                            canvasActions: { export: false, saveToActiveFile: false, loadScene: false },
                        }}
                    />
                )}
            </div>
        </div>
    );
}

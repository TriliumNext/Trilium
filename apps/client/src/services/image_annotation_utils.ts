import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

import FAttachment from "../entities/fattachment.js";
import type FNote from "../entities/fnote.js";

export const BG_ELEMENT_ID = "ann-bg-el";
export const BG_FILE_ID = "ann-bg-img";

export function attachmentTitle(entity: FNote | FAttachment): string {
    return entity instanceof FAttachment
        ? `excalidraw-annotations-${entity.attachmentId}.json`
        : "excalidraw-annotations.json";
}

export function ownerNoteId(entity: FNote | FAttachment): string {
    return entity instanceof FAttachment ? entity.ownerId : entity.noteId;
}

export function buildInitialData(
    originalDataUrl: string,
    width: number,
    height: number,
    elements: object[],
    storedFiles: Record<string, object> = {}
): ExcalidrawInitialDataState {
    return {
        elements: [
            {
                type: "image", id: BG_ELEMENT_ID,
                x: 0, y: 0, width, height,
                fileId: BG_FILE_ID as any, status: "saved", locked: true,
                strokeColor: "transparent", backgroundColor: "transparent",
                fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
                roughness: 0, roundness: null, opacity: 100, angle: 0 as any,
                seed: 1, version: 1, versionNonce: 0, isDeleted: false,
                boundElements: null, updated: Date.now(), link: null,
                groupIds: [], frameId: null, index: "a0" as any, scale: [1, 1] as any,
            } as any,
            ...elements,
        ],
        files: {
            [BG_FILE_ID]: {
                id: BG_FILE_ID as any,
                dataURL: originalDataUrl as any,
                mimeType: "image/png" as any,
                created: Date.now(),
            },
            ...storedFiles,
        } as any,
        appState: { viewBackgroundColor: "#121212" },
    };
}

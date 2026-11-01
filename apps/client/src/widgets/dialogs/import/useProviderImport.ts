import type { NativeImportOptions, NativeImportPickedFile } from "@triliumnext/commons";
import { useCallback, useState } from "preact/hooks";

import importService from "../../../services/import.js";
import utils from "../../../services/utils.js";

interface ProviderImportArgs {
    /** Importer tag (e.g. "obsidian") routing both the upload and the native import. */
    format: string;
    parentNoteId: string;
    shrinkImages: boolean;
    closeDialog: () => void;
}

interface ProviderImport {
    /** Whether a file is selected (either route), used to enable the Import button. */
    hasSelection: boolean;
    /** Native-pick filename(s) to show in the drop zone; undefined when using the upload route. */
    displayNames?: string[];
    onChange: (files: File[] | null) => void;
    /** Desktop-only native browse (reads the zip in place); undefined elsewhere. */
    onBrowse?: () => void;
    /** Desktop-only native drop (reads the dropped zip in place); undefined elsewhere. */
    onNativeDrop?: (files: File[]) => Promise<boolean>;
    /** Removes the selection — a provider holds a single file, so the index is irrelevant (the drop zone's per-file [X]). */
    onRemove: () => void;
    doImport: () => Promise<void>;
}

/**
 * Selection + import logic shared by the zip-based provider panels (Obsidian/Anytype/Notion/Keep). They all
 * take a single tagged `.zip`: on desktop, "browse" opens the native dialog so the archive is read in place
 * (streamed, memory-bounded), while drag-and-drop keeps the upload route. The two selections are mutually
 * exclusive — choosing one clears the other.
 */
export default function useProviderImport({ format, parentNoteId, shrinkImages, closeDialog }: ProviderImportArgs): ProviderImport {
    const [file, setFile] = useState<File | null>(null);
    const [nativeFile, setNativeFile] = useState<NativeImportPickedFile | null>(null);

    const onChange = useCallback((files: File[] | null) => {
        setFile(files?.[0] ?? null);
        if (files?.length) {
            setNativeFile(null);
        }
    }, []);

    const browse = useCallback(async () => {
        const pick = await window.electronApi?.nativeImport.pickFiles();
        if (pick?.status !== "selected" || !pick.files?.length) {
            return;
        }
        setFile(null);
        setNativeFile(pick.files[0]);
    }, []);

    // Desktop: route a dropped archive through the native in-place path. A provider takes a single file, so
    // resolve just the first; fall back to upload if it didn't resolve to a real path.
    const nativeDrop = useCallback(async (dropped: File[]) => {
        const pick = await window.electronApi?.nativeImport.grantDroppedFiles(dropped.slice(0, 1));
        if (pick?.status !== "selected" || !pick.files?.length) {
            return false;
        }
        setFile(null);
        setNativeFile(pick.files[0]);
        return true;
    }, []);

    const onRemove = useCallback(() => {
        setFile(null);
        setNativeFile(null);
    }, []);

    const doImport = useCallback(async () => {
        // Close immediately and let the shared import toasts (registered in import.ts) report progress,
        // completion and any error. Swallow rejections so these void-ed calls don't raise unhandled ones.
        if (nativeFile) {
            const options: NativeImportOptions = {
                safeImport: true, shrinkImages, textImportedAsText: true, codeImportedAsCode: true,
                spreadsheetImportedAsSpreadsheet: true, explodeArchives: true, replaceUnderscoresWithSpaces: true
            };
            closeDialog();
            await window.electronApi?.nativeImport.importFromToken({
                token: nativeFile.token, parentNoteId, taskId: utils.randomString(10), options, last: true, format
            }).catch(() => {});
            return;
        }
        if (!file) {
            return;
        }
        closeDialog();
        await importService.uploadFiles("notes", parentNoteId, [file], { format, safeImport: "true", shrinkImages: shrinkImages ? "true" : "false" }).catch(() => {});
    }, [file, nativeFile, shrinkImages, format, parentNoteId, closeDialog]);

    return {
        hasSelection: !!file || !!nativeFile,
        displayNames: nativeFile ? [nativeFile.fileName] : undefined,
        onChange,
        onBrowse: utils.isElectron() ? () => void browse() : undefined,
        onNativeDrop: utils.isElectron() ? nativeDrop : undefined,
        onRemove,
        doImport
    };
}

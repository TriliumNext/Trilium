import "./FileDropZone.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";

export interface FileDropZoneProps {
    name?: string;
    onChange: (files: FileList | null) => void;
    multiple?: boolean;
    /** Optional `accept` attribute forwarded to the underlying file input (e.g. `".zip"`). */
    accept?: string;
}

/**
 * A styled drop region for selecting files: drag-and-drop onto it or click it to open the native file
 * picker. Selected files are listed inside. Drop-in replacement for {@link FormFileUpload} — same
 * `onChange(files)` / `multiple` contract.
 */
export default function FileDropZone({ name, onChange, multiple, accept }: FileDropZoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [dragging, setDragging] = useState(false);
    // Tracks dragenter/dragleave depth so moving the cursor over child elements doesn't flicker the
    // highlight (dragleave fires when crossing between nested children, not just on leaving the zone).
    const dragDepth = useRef(0);

    // Reset any stale selection carried over from a previous mount of this widget.
    useEffect(() => { onChange(null); }, []);

    const update = useCallback((list: FileList | null) => {
        const selected = list && list.length ? (multiple ? Array.from(list) : [list[0]]) : [];
        setFiles(selected);
        onChange(selected.length ? list : null);
    }, [multiple, onChange]);

    const onDragEnter = useCallback((e: DragEvent) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
    }, []);

    const onDragLeave = useCallback(() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
            setDragging(false);
        }
    }, []);

    const onDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const dropped = e.dataTransfer?.files;
        if (dropped && dropped.length) {
            update(dropped);
        }
    }, [update]);

    return (
        <label
            className={`file-drop-zone ${dragging ? "dragging" : ""} ${files.length ? "has-files" : ""}`}
            onDragEnter={onDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <input
                ref={inputRef}
                name={name}
                type="file"
                className="file-drop-zone-input"
                multiple={multiple}
                accept={accept}
                onChange={(e) => update((e.target as HTMLInputElement).files)}
            />
            {files.length ? (
                <div className="file-drop-zone-selection">
                    {files.length > 1 && <div className="file-drop-zone-count">{t("file_upload.selected", { count: files.length })}</div>}
                    <ul className="file-drop-zone-files">
                        {files.map((file, index) => (
                            <li key={index}><span className="bx bx-file-blank" /> <span className="file-drop-zone-filename">{file.name}</span></li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="file-drop-zone-prompt">
                    <span className="bx bx-cloud-upload file-drop-zone-icon" />
                    <span>{isMobile()
                        ? (multiple ? t("file_upload.browse_multiple") : t("file_upload.browse_single"))
                        : (multiple ? t("file_upload.drop_or_browse_multiple") : t("file_upload.drop_or_browse_single"))}</span>
                </div>
            )}
        </label>
    );
}

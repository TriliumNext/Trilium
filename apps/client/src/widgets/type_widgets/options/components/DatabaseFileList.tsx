import { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import open from "../../../../services/open";
import { formatSize } from "../../../../services/utils";
import { formatDateTime } from "../../../../utils/formatters";
import ActionButton from "../../../react/ActionButton";
import NoItems from "../../../react/NoItems";
import OptionsRow from "./OptionsRow";
import OptionsSection from "./OptionsSection";

export interface DatabaseFile {
    fileName: string;
    filePath: string;
    mtime: Date;
    /** Size of the file, in bytes. */
    fileSize: number;
}

interface DatabaseFileListProps {
    title: string;
    /** Sentence describing where the files are stored; omitted when there is no user-accessible location. */
    locationDescription?: string | null;
    /** Displayed sorted by modification date & time in a descending order. */
    files: DatabaseFile[];
    /** Endpoint the per-file download links point to; the file path is appended as a query parameter. */
    downloadEndpoint: string;
    rowName: string;
    downloadText: string;
    emptyIcon: string;
    emptyText: string;
    /** Extra content rendered below the list (e.g. an action button). */
    children?: ComponentChildren;
}

export default function DatabaseFileList({ title, locationDescription, files, downloadEndpoint, rowName, downloadText, emptyIcon, emptyText, children }: DatabaseFileListProps) {
    const sortedFiles = useMemo(() => [...files].sort((a, b) => {
        if (a.mtime < b.mtime) return 1;
        if (a.mtime > b.mtime) return -1;
        return 0;
    }), [files]);

    return (
        <OptionsSection
            title={title}
            description={locationDescription && (
                <span className="selectable-text">{locationDescription}</span>
            )}
        >
            {sortedFiles.length > 0 ? (
                sortedFiles.map(({ fileName, filePath, mtime, fileSize }) => (
                    <OptionsRow
                        key={filePath}
                        name={rowName}
                        label={<span className="selectable-text">{fileName}</span>}
                        description={`${mtime ? formatDateTime(mtime) : "-"} • ${formatSize(fileSize)}`}
                    >
                        <ActionButton
                            icon="bx bx-download"
                            text={downloadText}
                            onClick={() => open.download(open.getUrlForDownload(`${downloadEndpoint}?filePath=${encodeURIComponent(filePath)}`))}
                        />
                    </OptionsRow>
                ))
            ) : (
                <NoItems icon={emptyIcon} text={emptyText} />
            )}

            {children}
        </OptionsSection>
    );
}

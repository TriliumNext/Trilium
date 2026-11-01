import "./DatabaseFileList.css";

import { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import { type DatabaseFile, describeDatabaseFile } from "../../../../services/database_files";
import { t } from "../../../../services/i18n";
import open from "../../../../services/open";
import ActionButton from "../../../react/ActionButton";
import { Card, CardSection, OptionCardSection } from "../../../react/Card";
import DatabaseFileBadges from "../../../react/DatabaseFileBadges";
import NoItems from "../../../react/NoItems";

export type { DatabaseFile };

interface DatabaseFileListProps<T extends DatabaseFile> {
    title: string;
    /** Sentence introducing the list — what it holds, or where the files are stored. */
    description?: ComponentChildren;
    /** Displayed sorted by modification date & time in a descending order. */
    files: T[];
    /** Endpoint the per-file download links point to; the file path is appended as a query parameter. */
    downloadEndpoint: string;
    downloadText: string;
    /**
     * Offers to remove a file, beside the download of it. Left out where the files are not the
     * user's to remove — the backups, which the schedule that made them also clears out.
     *
     * The caller confirms and deletes: only it knows what the file is, and the list is redrawn from
     * whatever it fetches afterwards.
     */
    onDelete?: (file: T) => void;
    emptyIcon: string;
    emptyText: string;
    /** Labels individual files, for the ones that need telling apart — e.g. one kept somewhere else. */
    fileBadges?: (file: T) => string[];
    /** Extra card sections rendered below the list (e.g. an action button). */
    children?: ComponentChildren;
}

export default function DatabaseFileList<T extends DatabaseFile>(props: DatabaseFileListProps<T>) {
    const { title, description, files, downloadEndpoint, downloadText, onDelete } = props;
    const { emptyIcon, emptyText, fileBadges, children } = props;

    const sortedFiles = useMemo(() => [...files].sort((a, b) => {
        if (a.mtime < b.mtime) return 1;
        if (a.mtime > b.mtime) return -1;
        return 0;
    }), [files]);

    return (
        <Card className="database-file-list" heading={title} description={description}>
            {sortedFiles.length > 0 ? (
                sortedFiles.map((file) => (
                    <OptionCardSection
                        key={file.filePath}
                        label={
                            <span className="database-file-label">
                                <span className="selectable-text">{file.fileName}</span>
                                <DatabaseFileBadges badges={fileBadges?.(file) ?? []} />
                            </span>
                        }
                        description={describeDatabaseFile(file)}
                    >
                        <ActionButton
                            icon="bx bx-download"
                            text={downloadText}
                            onClick={() => downloadFile(downloadEndpoint, file.filePath)}
                        />

                        {/* Labelled from the shared catalogue rather than per list: removing a
                            file is the same act whichever list it is in. */}
                        {onDelete && (
                            <ActionButton
                                className="destructive-action-icon"
                                icon="bx bx-trash"
                                text={t("database_file_list.delete")}
                                onClick={() => onDelete(file)}
                            />
                        )}
                    </OptionCardSection>
                ))
            ) : (
                <CardSection>
                    <NoItems icon={emptyIcon} text={emptyText} size="small" />
                </CardSection>
            )}

            {children}
        </Card>
    );
}

function downloadFile(downloadEndpoint: string, filePath: string) {
    const url = `${downloadEndpoint}?filePath=${encodeURIComponent(filePath)}`;

    open.download(open.getUrlForDownload(url));
}

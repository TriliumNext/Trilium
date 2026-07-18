import "./BlobStub.css";

import { t } from "../../services/i18n";
import options from "../../services/options";
import Button from "../react/Button";
import NoItems from "../react/NoItems";
import { TypeWidgetProps } from "./type_widget";

/**
 * Shown in place of the content when a note's blob was not synced to this device because it exceeded
 * the device's blob size limit (`syncMaxBlobContentSize`, set on mobile). The blob is a stub with
 * empty content, so there is nothing to render or edit; offer to open the note on the sync server
 * instead. Rendering this instead of an editor is also a data-safety guard: it prevents the empty
 * stub content from being saved back over the real content on the server.
 */
export default function BlobStub({ note }: TypeWidgetProps) {
    const syncServerHost = options.get("syncServerHost");
    const url = syncServerHost ? `${syncServerHost.replace(/\/+$/, "")}/#root/${note.noteId}` : null;

    return (
        <NoItems className="note-detail-blob-stub" icon="bx bx-cloud-download" text={t("blob_stub.not_synced")}>
            {url && (
                <Button
                    kind="primary"
                    text={t("blob_stub.open_on_server")}
                    onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                />
            )}
        </NoItems>
    );
}

import { t } from "../services/i18n.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import server from "../services/server.js";
import fileWatcher from "../services/file_watcher.js";
import { dayjs } from "@triliumnext/commons";
import type { EventData } from "../components/app_context.js";
import type FNote from "../entities/fnote.js";

const TPL = /*html*/`
<div class="dropdown watched-file-update-status-widget alert alert-warning">
    <style>
        .watched-file-update-status-widget {
            margin: 10px;
            contain: none;
        }
    </style>

    <p>${t("watched_file_update_status.file_last_modified")}</p>

    <div style="display: flex; flex-direction: row; justify-content: flex-start; gap: 8px;">
        <button class="btn btn-sm file-upload-button">${t("watched_file_update_status.upload_modified_file")}</button>

        <button class="btn btn-sm ignore-this-change-button">${t("watched_file_update_status.ignore_this_change")}</button>
    </div>
</div>`;

export default class WatchedFileUpdateStatusWidget extends NoteContextAwareWidget {

    private $filePath!: JQuery<HTMLElement>;
    private $fileLastModified!: JQuery<HTMLElement>;
    private $fileUploadButton!: JQuery<HTMLElement>;
    private $ignoreThisChangeButton!: JQuery<HTMLElement>;

    isEnabled() {
        const { entityType, entityId } = this.getEntity();

        return super.isEnabled()
            && !!entityType
            && !!entityId
            && !!fileWatcher.getFileModificationStatus(entityType, entityId);
    }

    doRender() {
        this.$widget = $(TPL);

        this.$filePath = this.$widget.find(".file-path");
        this.$fileLastModified = this.$widget.find(".file-last-modified");
        this.$fileUploadButton = this.$widget.find(".file-upload-button");

        this.$fileUploadButton.on("click", async () => {
            const { entityType, entityId } = this.getEntity();

            await server.post(`${entityType}/${entityId}/upload-modified-file`, {
                filePath: this.$filePath.text()
            });

            if (entityType && entityId) {
                fileWatcher.fileModificationUploaded(entityType, entityId);
            }
            this.refresh();
        });

        this.$ignoreThisChangeButton = this.$widget.find(".ignore-this-change-button");
        this.$ignoreThisChangeButton.on("click", () => {
            const { entityType, entityId } = this.getEntity();

            if (entityType && entityId) {
                fileWatcher.ignoreModification(entityType, entityId);
            }
            this.refresh();
        });
    }

    async refreshWithNote(note: FNote) {
        const { entityType, entityId } = this.getEntity();
        if (!entityType || !entityId) return;
        const status = fileWatcher.getFileModificationStatus(entityType, entityId);

        this.$filePath.text(status.filePath);
        if (status.lastModifiedMs) {
            this.$fileLastModified.text(dayjs.unix(status.lastModifiedMs / 1000).format("HH:mm:ss"));
        }
    }

    getEntity() {
        if (!this.noteContext) {
            return {};
        }

        const { viewScope } = this.noteContext;

        if (viewScope?.viewMode === "attachments" && viewScope.attachmentId) {
            return {
                entityType: "attachments",
                entityId: viewScope.attachmentId
            };
        } else {
            return {
                entityType: "notes",
                entityId: this.noteId
            };
        }
    }

    openedFileUpdatedEvent(data: EventData<"openedFileUpdated">) {
        console.log(data);
        const { entityType, entityId } = this.getEntity();

        if (data.entityType === entityType && data.entityId === entityId) {
            this.refresh();
        }
    }
}

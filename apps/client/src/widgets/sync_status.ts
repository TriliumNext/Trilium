import { t } from "../services/i18n.js";
import BasicWidget from "./basic_widget.js";
import ws from "../services/ws.js";
import options from "../services/options.js";
import syncService from "../services/sync.js";
import { escapeQuotes, handleRightToLeftPlacement } from "../services/utils.js";
import { Tooltip } from "bootstrap";
import { WebSocketMessage } from "@triliumnext/commons";

const TPL = /*html*/`
<div class="sync-status-widget launcher-button">
    <style>
    .sync-status-widget {
    }

    .sync-status {
        box-sizing: border-box;
    }

    .sync-status .sync-status-icon {
        display: inline-block;
        position: relative;
        top: -5px;
        font-size: 110%;
    }

    .sync-status .sync-status-sub-icon {
        font-size: 40%;
        position: absolute;
        inset-inline-start: 0;
        top: 16px;
    }

    .sync-status .sync-status-icon span {
        border: none !important;
    }

    .sync-status-icon:not(.sync-status-in-progress):hover {
        background-color: var(--hover-item-background-color);
        cursor: pointer;
    }
    </style>

    <div class="sync-status">
        <span class="sync-status-icon sync-status-unknown bx bx-time"
              data-bs-toggle="tooltip"
              title="${escapeQuotes(t("sync_status.unknown"))}">
        </span>
        <span class="sync-status-icon sync-status-connected-with-changes bx bx-wifi"
              data-bs-toggle="tooltip"
              title="${escapeQuotes(t("sync_status.connected_with_changes"))}">
            <span class="bx bxs-star sync-status-sub-icon"></span>
        </span>
        <span class="sync-status-icon sync-status-connected-no-changes bx bx-wifi"
              data-bs-toggle="tooltip"
              title="${escapeQuotes(t("sync_status.connected_no_changes"))}">
        </span>
        <span class="sync-status-icon sync-status-disconnected-with-changes bx bx-wifi-off"
              data-bs-toggle="tooltip"
              title="${escapeQuotes(t("sync_status.disconnected_with_changes"))}">
            <span class="bx bxs-star sync-status-sub-icon"></span>
        </span>
        <span class="sync-status-icon sync-status-disconnected-no-changes bx bx-wifi-off"
              data-bs-toggle="tooltip"
              title="${escapeQuotes(t("sync_status.disconnected_no_changes"))}">
        </span>
        <span class="sync-status-icon sync-status-in-progress bx bx-analyse bx-spin"
              data-bs-toggle="tooltip"
              title="${escapeQuotes(t("sync_status.in_progress"))}">
        </span>
    </div>
</div>
`;

export default class SyncStatusWidget extends BasicWidget {

    syncState: "unknown" | "in-progress" | "connected" | "disconnected";
    allChangesPushed: boolean;
    lastSyncedPush!: number;
    settings: {
        // TriliumNextTODO: narrow types and use TitlePlacement Type
        titlePlacement: string;
    };

    constructor() {
        super();

        this.syncState = "unknown";
        this.allChangesPushed = false;
        this.settings = {
            titlePlacement: "right"
        };
    }

    doRender() {
        this.$widget = $(TPL);
        this.$widget.hide();

        this.$widget.find(".sync-status-icon:not(.sync-status-in-progress)").on("click", () => syncService.syncNow());

        ws.subscribeToMessages((message) => this.processMessage(message));
    }

    showIcon(className: string) {
        if (!options.get("syncServerHost")) {
            this.toggleInt(false);
            return;
        }

        Tooltip.getOrCreateInstance(this.$widget.find(`.sync-status-${className}`)[0], {
            html: true,
            placement: handleRightToLeftPlacement(this.settings.titlePlacement),
            fallbackPlacements: [ handleRightToLeftPlacement(this.settings.titlePlacement) ]
        });

        this.$widget.show();
        this.$widget.find(".sync-status-icon").hide();
        this.$widget.find(`.sync-status-${className}`).show();
    }

    processMessage(message: WebSocketMessage) {
        if (message.type === "sync-pull-in-progress") {
            this.syncState = "in-progress";
            this.lastSyncedPush = message.lastSyncedPush;
        } else if (message.type === "sync-push-in-progress") {
            this.syncState = "in-progress";
            this.lastSyncedPush = message.lastSyncedPush;
        } else if (message.type === "sync-finished") {
            this.syncState = "connected";
            this.lastSyncedPush = message.lastSyncedPush;
        } else if (message.type === "sync-failed") {
            this.syncState = "disconnected";
            this.lastSyncedPush = message.lastSyncedPush;
        } else if (message.type === "frontend-update") {
            this.lastSyncedPush = message.data.lastSyncedPush;
        }

        this.allChangesPushed = this.lastSyncedPush === ws.getMaxKnownEntityChangeSyncId();

        if (["unknown", "in-progress"].includes(this.syncState)) {
            this.showIcon(this.syncState);
        } else {
            this.showIcon(`${this.syncState}-${this.allChangesPushed ? "no-changes" : "with-changes"}`);
        }
    }
}

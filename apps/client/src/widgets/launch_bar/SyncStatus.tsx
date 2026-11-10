import "./SyncStatus.css";

import { SyncPullProgress, WebSocketMessage } from "@triliumnext/commons";
import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import sync from "../../services/sync";
import { escapeQuotes } from "../../services/utils";
import ws, { subscribeToMessages, unsubscribeToMessage } from "../../services/ws";
import { useStaticTooltip, useTriliumOption, useTriliumOptionBool } from "../react/hooks";
import { launcherContextMenuHandler, LauncherNoteProps } from "./launch_bar_widgets";

type SyncState = "unknown" | "in-progress"
    | "connected-with-changes" | "connected-no-changes"
    | "disconnected-with-changes" | "disconnected-no-changes";

interface StateMapping {
    title: string;
    icon: string;
    hasChanges?: boolean;
}

const STATE_MAPPINGS: Record<SyncState, StateMapping> = {
    unknown: {
        title: t("sync_status.unknown"),
        icon: "bx bx-time"
    },
    "connected-with-changes": {
        title: t("sync_status.connected_with_changes"),
        icon: "bx bx-wifi",
        hasChanges: true
    },
    "connected-no-changes": {
        title: t("sync_status.connected_no_changes"),
        icon: "bx bx-wifi"
    },
    "disconnected-with-changes": {
        title: t("sync_status.disconnected_with_changes"),
        icon: "bx bx-wifi-off",
        hasChanges: true
    },
    "disconnected-no-changes": {
        title: t("sync_status.disconnected_no_changes"),
        icon: "bx bx-wifi-off"
    },
    "in-progress": {
        title: t("sync_status.in_progress"),
        icon: "bx bx-analyse bx-spin"
    }
};

export default function SyncStatus({ launcherNote }: LauncherNoteProps) {
    const { syncState, pullProgress } = useSyncStatus();
    const { title, icon, hasChanges } = STATE_MAPPINGS[syncState];
    const spanRef = useRef<HTMLSpanElement>(null);
    const [ storedSyncServerHost ] = useTriliumOption("syncServerHost");
    const [ effectiveSyncServerHost ] = useTriliumOption("effectiveSyncServerHost");
    const [ isSyncServerHostOverridden ] = useTriliumOptionBool("syncServerHostOverridden");

    useStaticTooltip(spanRef, {
        html: true,
        title: escapeQuotes(title)
    });

    // config.ini and environment variables hold still for the life of the process, so only the
    // stored option can change while the app runs. Reading it directly makes the button appear as
    // soon as sync is configured, without waiting for a reload.
    const showSyncStatus = isSyncServerHostOverridden
        ? !!effectiveSyncServerHost
        : !!storedSyncServerHost && storedSyncServerHost !== "disabled";

    return (showSyncStatus &&
        <div
            class="sync-status-widget launcher-button"
            onContextMenu={launcherContextMenuHandler(launcherNote)}
        >
            <div class="sync-status">
                <span
                    key={syncState} // Force re-render when state changes to update tooltip content.
                    ref={spanRef}
                    className={clsx("sync-status-icon", `sync-status-${syncState}`, icon)}
                    onClick={() => {
                        if (syncState === "in-progress") return;
                        sync.syncNow();
                    }}
                >
                    {hasChanges && (
                        <span class="bx bxs-star sync-status-sub-icon" />
                    )}
                </span>
            </div>
            {pullProgress && <SyncPullProgressBar {...pullProgress} />}
        </div>
    );
}

function SyncPullProgressBar({ pulled, total }: SyncPullProgress) {
    const percent = Math.min(100, Math.round(pulled / total * 100));

    return (
        <div
            class="sync-status-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            style={{ "--sync-progress": `${percent}%` }}
        />
    );
}

function useSyncStatus() {
    const [ syncState, setSyncState ] = useState<SyncState>("unknown");
    const [ pullProgress, setPullProgress ] = useState<SyncPullProgress>();

    useEffect(() => {
        let connection: "unknown" | "in-progress" | "connected" | "disconnected" = "unknown";
        let lastSyncedPush: number | undefined;
        let maxKnownSyncId = 0;

        function onMessage(message: WebSocketMessage) {
            if ("lastSyncedPush" in message) {
                lastSyncedPush = message.lastSyncedPush;
            }

            switch (message.type) {
                case "sync-pull-in-progress":
                    connection = "in-progress";
                    if (message.progress && message.progress.total > 0) {
                        setPullProgress(message.progress);
                    }
                    break;
                case "sync-push-in-progress":
                    connection = "in-progress";
                    setPullProgress(undefined);
                    break;
                case "sync-finished":
                    connection = "connected";
                    setPullProgress(undefined);
                    break;
                case "sync-failed":
                    connection = "disconnected";
                    setPullProgress(undefined);
                    break;
                case "frontend-update":
                    lastSyncedPush = message.data.lastSyncedPush;
                    // Subscribers run before `ws` records these changes, so the message's own
                    // synced changes are counted here.
                    for (const entityChange of message.data.entityChanges) {
                        if (entityChange.isSynced && entityChange.id) {
                            maxKnownSyncId = Math.max(maxKnownSyncId, entityChange.id);
                        }
                    }
                    break;
            }

            maxKnownSyncId = Math.max(maxKnownSyncId, ws.getMaxKnownEntityChangeSyncId());

            if (connection === "unknown" || connection === "in-progress") {
                setSyncState(connection);
            } else {
                const allChangesPushed = lastSyncedPush === maxKnownSyncId;
                setSyncState(`${connection}-${allChangesPushed ? "no-changes" : "with-changes"}`);
            }
        }

        subscribeToMessages(onMessage);
        return () => unsubscribeToMessage(onMessage);
    }, []);

    return { syncState, pullProgress };
}

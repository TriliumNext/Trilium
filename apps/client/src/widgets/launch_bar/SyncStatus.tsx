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
        let lastSyncedPush: number;

        function onMessage(message: WebSocketMessage) {
            // First, read last synced push.
            if ("lastSyncedPush" in message) {
                lastSyncedPush = message.lastSyncedPush;
            } else if ("data" in message && message.data && "lastSyncedPush" in message.data && lastSyncedPush !== undefined) {
                lastSyncedPush = message.data.lastSyncedPush;
            }

            // Determine if all changes were pushed.
            const allChangesPushed = lastSyncedPush === ws.getMaxKnownEntityChangeSyncId();

            switch (message.type) {
                case "sync-pull-in-progress":
                    setSyncState("in-progress");
                    if (message.progress && message.progress.total > 0) {
                        setPullProgress(message.progress);
                    }
                    break;
                case "sync-push-in-progress":
                    setSyncState("in-progress");
                    setPullProgress(undefined);
                    break;
                case "sync-finished":
                    setSyncState(allChangesPushed ? "connected-no-changes" : "connected-with-changes");
                    setPullProgress(undefined);
                    break;
                case "sync-failed":
                    setSyncState(allChangesPushed ? "disconnected-no-changes" : "disconnected-with-changes");
                    setPullProgress(undefined);
                    break;
                case "frontend-update":
                    lastSyncedPush = message.data.lastSyncedPush;
                    break;
            }
        }

        subscribeToMessages(onMessage);
        return () => unsubscribeToMessage(onMessage);
    }, []);

    return { syncState, pullProgress };
}

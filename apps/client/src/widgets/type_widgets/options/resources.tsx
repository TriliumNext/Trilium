import "./resources.css";

import type {
    ForeignResourceEntry, ResourceInfo, ResourcesStatusResponse, WebSocketMessage
} from "@triliumnext/commons";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import dialogService from "../../../services/dialog";
import { t } from "../../../services/i18n";
import openService from "../../../services/open";
import server from "../../../services/server";
import { formatSize, isElectron } from "../../../services/utils";
import { subscribeToMessages, unsubscribeToMessage } from "../../../services/ws";
import { ResourceCredits } from "../../dialogs/resource_download";
import ActionButton from "../../react/ActionButton";
import { Card, CardSection } from "../../react/Card";
import Icon from "../../react/Icon";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";

/**
 * Lists the resources installed on this device, the ones an interrupted download left partly
 * fetched, and whatever else is in the resources directory.
 */
export default function ResourcesSettings() {
    const [ status, refresh ] = useResources();

    return (
        <>
            <OptionsPageHeader helpUrl="ebyr7ES2SwOW" />
            {status && (
                <Card
                    className="resources-list"
                    heading={t("resources_options.list_title")}
                    description={t("resources_options.list_description")}
                >
                    {status.resources.length > 0 || status.foreign.length > 0 ? (
                        <ResourceRows {...status} onDeleted={refresh} />
                    ) : (
                        <CardSection>
                            <NoItems icon="bx bx-download" text={t("resources_options.no_resources")} size="small" />
                        </CardSection>
                    )}
                </Card>
            )}
        </>
    );
}

interface ResourcesStatus {
    resources: ResourceInfo[];
    foreign: ForeignResourceEntry[];
    freeBytes: number | null;
}

/**
 * The resources installed or partly downloaded, the foreign entries and the free space where they
 * are stored, fetched again whenever a download ends.
 */
function useResources() {
    const [ status, setStatus ] = useState<ResourcesStatus>();
    const refresh = useCallback(() => {
        void server.get<ResourcesStatusResponse>("resources").then(({ resources, foreign, freeBytes }) => setStatus({
            resources: resources.filter((resource) => getSizeOnDisk(resource) > 0),
            foreign: foreign ?? [],
            freeBytes
        }));
    }, []);

    useEffect(() => {
        const handler = (message: WebSocketMessage) => {
            if (message.type === "resource-download" && message.download.status !== "downloading") {
                refresh();
            }
        };
        refresh();
        subscribeToMessages(handler);
        return () => unsubscribeToMessage(handler);
    }, [ refresh ]);

    return [ status, refresh ] as const;
}

interface ResourceRowsProps extends ResourcesStatus {
    onDeleted: () => void;
}

/** The entries and the space they use, every size in one unit so that the column adds up. */
function ResourceRows({ resources, foreign, freeBytes, onDeleted }: ResourceRowsProps) {
    const used = resources.reduce((total, resource) => total + getSizeOnDisk(resource), 0)
        + foreign.reduce((total, { size }) => total + size, 0);
    const unitOf = Math.max(used, ...resources.map(({ size }) => size));
    return (
        <>
            {resources.map((resource) => (
                <ResourceRow key={resource.id} resource={resource} unitOf={unitOf} onDeleted={onDeleted} />
            ))}
            {foreign.map((entry) => (
                <ForeignRow key={entry.name} entry={entry} unitOf={unitOf} onDeleted={onDeleted} />
            ))}
            <CardSection className="tn-card-option resources-total">
                <div className="tn-card-option-label">
                    <span className="tn-card-option-title">{t("resources_options.space_used")}</span>
                    {freeBytes !== null && (
                        <small className="tn-card-option-description">
                            {t("resource_download.free_space", { size: formatSize(freeBytes) })}
                        </small>
                    )}
                </div>
                <span className="tn-card-option-value resources-size">{formatSize(used, 2, unitOf)}</span>
                <div className="resources-actions" />
            </CardSection>
        </>
    );
}

interface ResourceRowProps {
    resource: ResourceInfo;
    unitOf: number;
    onDeleted: () => void;
}

function ResourceRow({ resource, unitOf, onDeleted }: ResourceRowProps) {
    const { directory } = resource;
    async function remove() {
        if (!await dialogService.confirm(t("resources_options.delete_confirmation", { title: resource.title }))) {
            return;
        }
        await server.remove(`resources/${encodeURIComponent(resource.id)}`);
        onDeleted();
    }

    return (
        <EntryRow
            icon={resource.icon}
            title={resource.title}
            size={formatSize(getSizeOnDisk(resource), 2, unitOf)}
            status={getStatusText(resource)}
            onOpen={directory ? () => void openService.openDirectory(directory) : undefined}
            onDelete={() => void remove()}
        >
            <small className="tn-card-option-description">{resource.description}</small>
            <ResourceCredits resource={resource} />
        </EntryRow>
    );
}

interface ForeignRowProps {
    entry: ForeignResourceEntry;
    unitOf: number;
    onDeleted: () => void;
}

/** An entry of the resources directory that no registered resource accounts for. */
function ForeignRow({ entry, unitOf, onDeleted }: ForeignRowProps) {
    async function remove() {
        if (!await dialogService.confirm(t("resources_options.delete_foreign_confirmation", { name: entry.name }))) {
            return;
        }
        await server.remove(`resources/foreign/${encodeURIComponent(entry.name)}`);
        onDeleted();
    }

    function open() {
        void (entry.isDirectory ? openService.openDirectory(entry.path) : openService.revealFile(entry.path));
    }

    return (
        <EntryRow
            className="resources-foreign"
            icon={entry.icon ?? (entry.isDirectory ? "bx bx-folder" : "bx bx-file")}
            title={entry.title ?? entry.name}
            size={formatSize(entry.size, 2, unitOf)}
            status={t(`resources_options.${entry.kind}`)}
            onOpen={open}
            onDelete={() => void remove()}
        >
            <small className="tn-card-option-description">
                {t(`resources_options.${entry.kind}_description`)}
            </small>
            {entry.title && <small className="tn-card-option-description">{entry.name}</small>}
        </EntryRow>
    );
}

interface EntryRowProps {
    className?: string;
    icon: string;
    title: string;
    /** The lines below the title. */
    children: ComponentChildren;
    size: string;
    status: string;
    /** Opens the entry in the file manager, which only the desktop app can do. */
    onOpen?: () => void;
    onDelete: () => void;
}

/** One row of the list: icon, title and description, size and status, then its actions. */
function EntryRow({ className, icon, title, children, size, status, onOpen, onDelete }: EntryRowProps) {
    return (
        <CardSection className={clsx("tn-card-option resources-item", className)}>
            <Icon icon={icon} className="resources-icon" />
            <div className="tn-card-option-label">
                <span className="tn-card-option-title">{title}</span>
                {children}
            </div>
            <div className="tn-card-option-value resources-status">
                <span className="resources-size">{size}</span>
                <small className="tn-card-option-description">{status}</small>
            </div>
            <div className="resources-actions">
                {onOpen && isElectron() && (
                    <ActionButton
                        icon="bx bx-folder-open"
                        text={t("resources_options.open_folder")}
                        onClick={onOpen}
                    />
                )}
                <ActionButton
                    className="destructive-action-icon"
                    icon="bx bx-trash"
                    text={t("resources_options.delete")}
                    onClick={onDelete}
                />
            </div>
        </CardSection>
    );
}

function getStatusText({ installed, size, downloadedSize, unverifiedSize }: ResourceInfo) {
    if (installed) {
        return t("resources_options.installed");
    }
    if (unverifiedSize > 0) {
        return t("resources_options.unverified");
    }
    return t("resources_options.partially_downloaded", {
        downloaded: formatSize(downloadedSize, 2, size),
        size: formatSize(size)
    });
}

/** The bytes of `resource` on disk: downloaded, kept from an interrupted download, or copied in. */
function getSizeOnDisk({ downloadedSize, unverifiedSize }: ResourceInfo) {
    return downloadedSize + unverifiedSize;
}

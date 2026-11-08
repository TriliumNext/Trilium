import "./resource_download.css";

import type {
    ResourceDownloadProgress, ResourceDownloadState, ResourceInfo, ResourcesStatusResponse,
    WebSocketMessage
} from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Trans } from "react-i18next";

import { t } from "../../services/i18n";
import server from "../../services/server";
import { formatSize } from "../../services/utils";
import { subscribeToMessages, unsubscribeToMessage } from "../../services/ws";
import { ExtendedAdmonition } from "../react/Admonition";
import Button from "../react/Button";
import { Card, CardSection } from "../react/Card";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import Modal from "../react/Modal";
import ProgressBar from "../react/ProgressBar";

export interface ResourceDownloadDialogOptions {
    ids: string[];
    status: ResourcesStatusResponse;
    /** Called once the dialog closes, with whether every resource is now installed. */
    callback: (installed: boolean) => void;
}

/**
 * Asks to download the resources a feature needs, then shows the download until it finishes.
 * Closing the dialog cancels a running download. A download the dialog joined can end without
 * every resource it asks for, so each success is checked against the server before the dialog
 * closes, and what is still missing is downloaded next. A response that returns after the dialog
 * closed is dropped, and a download it started is canceled.
 */
export default function ResourceDownloadDialog() {
    const [ opts, setOpts ] = useState<ResourceDownloadDialogOptions>();
    const [ shown, setShown ] = useState(false);
    const [ download, setDownload ] = useState<ResourceDownloadProgress | null>(null);
    const downloadRef = useRef(download);
    downloadRef.current = download;
    const installedRef = useRef(false);
    /** Counts openings and closings, so a response can tell whether its dialog is still open. */
    const sessionRef = useRef(0);

    useTriliumEvent("showResourceDownloadDialog", (newOpts) => {
        sessionRef.current++;
        installedRef.current = false;
        setOpts(newOpts);
        setDownload(newOpts.status.download);
        setShown(true);
    });

    useEffect(() => {
        if (!shown || !opts) {
            return;
        }
        // Matched by resource rather than by download ID, which a fast download can report
        // before the request that started it returns.
        const handler = (message: WebSocketMessage) => {
            if (message.type === "resource-download"
                && message.download.resourceIds.some((id) => opts.ids.includes(id))) {
                setDownload(message.download);
            }
        };
        subscribeToMessages(handler);
        return () => unsubscribeToMessage(handler);
    }, [ shown, opts ]);

    const succeededId = download?.status === "succeeded" ? download.downloadId : null;
    useEffect(() => {
        if (!succeededId || !opts) {
            return;
        }
        const session = sessionRef.current;
        void server.get<ResourcesStatusResponse>(`resources?ids=${opts.ids.map(encodeURIComponent).join(",")}`)
            .then((status) => {
                if (session !== sessionRef.current) {
                    return;
                }
                if (status.resources.every(({ installed }) => installed)) {
                    installedRef.current = true;
                    setShown(false);
                } else {
                    setOpts({ ...opts, status });
                    void startDownload(opts.ids);
                }
            });
    }, [ succeededId ]);

    async function startDownload(ids: string[]) {
        const session = sessionRef.current;
        setDownload(null);
        const started = await server.post<ResourceDownloadProgress>("resources/download", { ids });
        if (session !== sessionRef.current) {
            if (started.status === "downloading") {
                void server.post(`resources/download/${started.downloadId}/cancel`);
            }
            return;
        }
        setDownload((current) => current?.downloadId === started.downloadId ? current : started);
    }

    function cancelDownload() {
        const running = downloadRef.current;
        if (running?.status === "downloading") {
            void server.post(`resources/download/${running.downloadId}/cancel`);
        }
    }

    const isDownloading = download?.status === "downloading";
    const isFailed = download?.status === "failed";
    const remaining = opts ? getRemainingSize(opts.status) : 0;
    const freeBytes = opts?.status.freeBytes ?? null;
    const lacksSpace = freeBytes !== null && freeBytes < remaining;
    const startText = isFailed
        ? t("resource_download.retry")
        : remaining === 0 ? t("resource_download.verify") : t("resource_download.download");

    return (
        <Modal
            className="resource-download-dialog"
            size="lg"
            title={t("resource_download.title")}
            show={shown}
            onHidden={() => {
                sessionRef.current++;
                cancelDownload();
                opts?.callback(installedRef.current);
                setShown(false);
            }}
            footer={<>
                <Button text={t("resource_download.cancel")} onClick={() => setShown(false)} />
                {!isDownloading && (
                    <Button
                        text={startText}
                        icon={remaining === 0 ? "bx bx-check-shield" : "bx bx-download"}
                        kind="primary"
                        disabled={lacksSpace}
                        disabledTooltip={t("resource_download.not_enough_space_title")}
                        onClick={() => opts && startDownload(opts.ids)}
                    />
                )}
            </>}
        >
            {opts && (
                <ResourceList status={opts.status} remaining={remaining} download={download} />
            )}
            {lacksSpace && (
                <ExtendedAdmonition
                    type="caution"
                    icon="bx bx-error-circle"
                    title={t("resource_download.not_enough_space_title")}
                >
                    {t("resource_download.not_enough_space", {
                        size: formatSize(remaining),
                        free: formatSize(freeBytes)
                    })}
                </ExtendedAdmonition>
            )}
            {isFailed && (
                <ExtendedAdmonition
                    type="caution"
                    icon="bx bx-error-circle"
                    title={t("resource_download.failed_title")}
                >
                    {download.error}
                </ExtendedAdmonition>
            )}
        </Modal>
    );
}

interface ResourceListProps {
    status: ResourcesStatusResponse;
    remaining: number;
    download: ResourceDownloadProgress | null;
}

function ResourceList({ status, remaining, download }: ResourceListProps) {
    const missing = status.resources.filter(({ installed }) => !installed);
    const activeId = download?.status === "downloading"
        ? download.resources.find(({ done }) => !done)?.id
        : undefined;

    return (
        <>
            <p>{t("resource_download.intro")}</p>
            <Card className="resource-download-list">
                {missing.map((resource) => (
                    <ResourceItem
                        key={resource.id}
                        resource={resource}
                        unitOf={remaining}
                        state={download?.resources.find(({ id }) => id === resource.id)}
                        file={resource.id === activeId ? download?.file ?? null : undefined}
                    />
                ))}
                <CardSection className="tn-card-option resource-download-total">
                    <div className="tn-card-option-label">
                        <span className="tn-card-option-title">{t("resource_download.total")}</span>
                        {status.freeBytes !== null && (
                            <small className="tn-card-option-description">
                                {t("resource_download.free_space", {
                                    size: formatSize(status.freeBytes)
                                })}
                            </small>
                        )}
                    </div>
                    <span className="tn-card-option-value resource-download-size">
                        {formatSize(remaining, 2, remaining)}
                    </span>
                </CardSection>
            </Card>
        </>
    );
}

interface ResourceItemProps {
    resource: ResourceInfo;
    unitOf: number;
    /** How far a download has got with the resource, once one has started. */
    state?: ResourceDownloadState;
    /** The file being downloaded, `null` before the first one, while this resource downloads. */
    file?: string | null;
}

/**
 * One resource as a settings row: its icon, what it is and where it comes from, and what is left
 * to download of it, so that the rows add up to the download size. Once a download starts, the
 * icon shows whether the resource is done, downloading or waiting, as the setup's sync steps do.
 * The resource downloading carries a progress bar, and so does one an earlier download left
 * partly fetched, filled as far as it got. Files already in place but not yet checked, such as
 * ones copied from another device, are named in the source line and left out of the size.
 */
function ResourceItem({ resource, unitOf, state, file }: ResourceItemProps) {
    const isActive = file !== undefined;
    const isPartial = !state?.done && resource.downloadedSize > 0;
    return (
        <CardSection className="tn-card-option resource-download-item">
            <Icon icon={getRowIcon(resource, state, isActive)} className="resource-download-icon" />
            <div className="tn-card-option-label">
                <span className="tn-card-option-title">{resource.title}</span>
                <small className="tn-card-option-description">{resource.description}</small>
                <ResourceCredits resource={resource}>
                    {resource.unverifiedSize > 0 && <>
                        {" · "}
                        {t("resource_download.unverified", { size: formatSize(resource.unverifiedSize) })}
                    </>}
                </ResourceCredits>
                {isActive && state && (
                    <RowProgress
                        received={state.receivedBytes}
                        total={state.totalBytes}
                        label={file && t("resource_download.current_file", { file })}
                    />
                )}
                {!isActive && isPartial && (
                    <RowProgress
                        received={resource.downloadedSize}
                        total={resource.size}
                        label={t("resource_download.partially_downloaded")}
                    />
                )}
            </div>
            <span className="tn-card-option-value resource-download-size">
                {formatSize(getMissingSize(resource), 2, unitOf)}
            </span>
        </CardSection>
    );
}

/**
 * Who made a resource and where its files come from, then its license, as the license asks a
 * resource to be credited: the author links to the original work and the license to its text.
 */
export function ResourceCredits({ resource, children }: {
    resource: ResourceInfo;
    children?: ComponentChildren;
}) {
    return (
        <small className="tn-card-option-description resource-download-meta">
            <Trans
                i18nKey="resource_download.credits"
                values={{ author: resource.author, sources: resource.sources.join(", ") }}
                components={{
                    Author: <ExternalLink className="resource-download-author" href={resource.homepage} />
                }}
            />
            {" · "}
            <ExternalLink className="resource-download-license" href={resource.licenseUrl}>
                {t("resource_download.license", { license: resource.license })}
            </ExternalLink>
            {children}
        </small>
    );
}

interface ExternalLinkProps {
    className: string;
    href: string;
    children?: ComponentChildren;
}

function ExternalLink({ className, href, children }: ExternalLinkProps) {
    return (
        <a className={`tn-link external ${className}`} href={href} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}

interface RowProgressProps {
    received: number;
    total: number;
    /** What the bar shows, on its leading edge below it. */
    label: string | null;
}

function RowProgress({ received, total, label }: RowProgressProps) {
    return (
        <div className="resource-download-progress">
            <ProgressBar value={received} max={total} />
            <small className="tn-card-option-description resource-download-progress-detail">
                <span>{label}</span>
                <span>
                    {t("resource_download.progress", {
                        received: formatSize(received, 2, total),
                        total: formatSize(total)
                    })}
                </span>
            </small>
        </div>
    );
}

function getRowIcon(resource: ResourceInfo, state: ResourceDownloadState | undefined,
    isActive: boolean) {
    if (!state) {
        return resource.icon;
    }
    if (state.done) {
        return "bx bx-check-circle";
    }
    return isActive ? "bx bx-loader-circle bx-spin" : "bx bx-circle";
}

/** The bytes still to download for the resources not installed. */
function getRemainingSize(status: ResourcesStatusResponse) {
    return status.resources
        .filter(({ installed }) => !installed)
        .reduce((total, resource) => total + getMissingSize(resource), 0);
}

/** The bytes of `resource` neither downloaded nor already in place waiting to be checked. */
function getMissingSize({ size, downloadedSize, unverifiedSize }: ResourceInfo) {
    return size - downloadedSize - unverifiedSize;
}

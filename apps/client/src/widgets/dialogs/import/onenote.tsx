import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import onenoteImport, { buildSectionSelections, collectSectionIds, extractServerMessage, type OneNoteAccount, type OneNoteContainer, type OneNoteDeviceLogin, type OneNoteNotebook, orderedChildren } from "../../../services/onenote_import.js";
import toast from "../../../services/toast.js";
import { isElectron, randomString } from "../../../services/utils.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import CheckboxTree, { type CheckboxTreeNode } from "../../react/CheckboxTree.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import LoadingSpinner from "../../react/LoadingSpinner.js";
import NoItems from "../../react/NoItems.js";
import OptionsRow, { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/onenote.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";

type Phase = "checking" | "disconnected" | "connecting" | "ready";

function OneNotePanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [phase, setPhase] = useState<Phase>("checking");
    const [account, setAccount] = useState<OneNoteAccount | null>(null);
    const [notebooks, setNotebooks] = useState<OneNoteNotebook[]>([]);
    // Set when listing the notebooks failed, so the panel can say so instead of reporting an empty
    // account — an expired connection or a Graph error is not "you have no notebooks".
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // Set while a user-triggered notebook reload is in flight, to spin and disable the refresh button.
    const [refreshing, setRefreshing] = useState(false);
    const [debug, setDebug] = useState(false);
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    // Set while a web (device-flow) sign-in is pending; null on desktop, whose sign-in needs no code.
    const [deviceLogin, setDeviceLogin] = useState<OneNoteDeviceLogin | null>(null);
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Bumped whenever polling stops; an in-flight poll compares against it to know it has been
    // superseded (cancelled, or the sign-in already completed) and must not reschedule.
    const pollGenRef = useRef(0);

    const stopPolling = useCallback(() => {
        pollGenRef.current++;
        if (pollRef.current) {
            clearTimeout(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const loadNotebooks = useCallback(async () => {
        setLoadError(null);
        try {
            const { notebooks } = await onenoteImport.getNotebooks();
            setNotebooks(notebooks);
            // Drop selected ids whose section no longer exists (deleted/moved in OneNote since the
            // last load), so a refresh can't leave the import button counting phantom sections.
            const validIds = collectSectionIds(notebooks);
            setSelectedIds((prev) => new Set([...prev].filter((id) => validIds.has(id))));
        } catch (e) {
            // The server's wording is the useful part (an expired sign-in says to sign in again, a
            // Graph failure names the Graph error); fall back to the generic message only when the
            // response carried none. The stale list is cleared: a tree that can't import (the same
            // dead connection would fail the import too) is worse than the explanation.
            setNotebooks([]);
            setLoadError(extractServerMessage(e) ?? t("onenote_import.load_failed"));
        }
    }, []);

    // User-triggered reload of the notebook list, e.g. after creating a section in OneNote while the
    // dialog is open. Wraps loadNotebooks purely to drive the refresh button's spinner/disabled state.
    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await loadNotebooks();
        } finally {
            setRefreshing(false);
        }
    }, [loadNotebooks]);

    // On mount, see whether this session is already connected.
    useEffect(() => {
        void onenoteImport.getStatus().then(async (status) => {
            if (status.connected) {
                setAccount(status.account);
                await loadNotebooks();
                setPhase("ready");
            } else {
                setPhase("disconnected");
            }
        }).catch((e) => {
            toast.showError(extractServerMessage(e) ?? t("onenote_import.load_failed"));
            setPhase("disconnected");
        });
        return stopPolling;
    }, [loadNotebooks, stopPolling]);

    const connect = useCallback(async () => {
        try {
            // Desktop runs the whole OAuth flow in the main process via a loopback redirect (the
            // browser-callback-into-session approach can't bridge Electron's split sessions), so the
            // sign-in resolves directly rather than being polled for.
            if (isElectron() && window.electronApi) {
                setPhase("connecting");
                const result = await window.electronApi.onenote.login();
                if (!result.connected) {
                    if (result.error) {
                        toast.showError(result.error);
                    }
                    setPhase("disconnected");
                    return;
                }
                setAccount(result.account ?? null);
                await loadNotebooks();
                setPhase("ready");
                return;
            }

            // Web uses the device flow: a self-hosted server's domain cannot be registered as an OAuth
            // redirect URI, so instead of a callback the user enters a short code at Microsoft's
            // sign-in page while we poll the server until the sign-in completes.
            const login = await onenoteImport.deviceLogin();
            setDeviceLogin(login);
            setPhase("connecting");

            // Self-scheduling poll (not setInterval): the next poll is queued only after the current one
            // resolves, so slow responses never overlap — overlapping polls could race and one clearing
            // its pending state could wipe another's completed sign-in.
            stopPolling();
            const generation = pollGenRef.current;
            let intervalMs = (login.intervalSeconds || 5) * 1000;

            const poll = async () => {
                let result: Awaited<ReturnType<typeof onenoteImport.devicePoll>> | null = null;
                try {
                    result = await onenoteImport.devicePoll();
                } catch (e) {
                    // A transient poll failure shouldn't surface a toast on every tick; keep polling.
                    console.error("Failed to poll OneNote sign-in:", e);
                }

                // Bail if this poll loop was superseded (cancelled, or a prior poll already finished).
                if (pollGenRef.current !== generation) {
                    return;
                }
                if (result?.status === "connected") {
                    stopPolling();
                    setDeviceLogin(null);
                    setAccount(result.account);
                    await loadNotebooks();
                    setPhase("ready");
                    return;
                }
                if (result?.status === "failed") {
                    stopPolling();
                    setDeviceLogin(null);
                    toast.showError(result.error);
                    setPhase("disconnected");
                    return;
                }
                // RFC 8628: on slow_down the provider is asking us to poll less often.
                if (result?.status === "pending" && result.slowDown) {
                    intervalMs += 5000;
                }
                pollRef.current = setTimeout(() => void poll(), intervalMs);
            };
            pollRef.current = setTimeout(() => void poll(), intervalMs);
        } catch (e) {
            toast.showError(extractServerMessage(e) ?? String(e));
            setPhase("disconnected");
        }
    }, [loadNotebooks, stopPolling]);

    const cancelSignIn = useCallback(() => {
        stopPolling();
        setDeviceLogin(null);
        setPhase("disconnected");
    }, [stopPolling]);

    const disconnect = useCallback(async () => {
        stopPolling();
        await onenoteImport.disconnect();
        setAccount(null);
        setNotebooks([]);
        setLoadError(null);
        setSelectedIds(new Set());
        setPhase("disconnected");
    }, [stopPolling]);

    const treeNodes = useMemo(() => notebooks.map((notebook): CheckboxTreeNode => ({
        id: notebook.id,
        label: notebook.title,
        children: buildTreeNodes(notebook)
    })), [notebooks]);

    const doImport = useCallback(async () => {
        const sections = buildSectionSelections(notebooks, selectedIds);
        if (!sections.length) {
            return;
        }

        // Close immediately and let the shared import toasts report progress, completion and any error.
        // The request returns as soon as the server accepts it (the import runs in the background), so
        // the only errors caught here are upfront ones like a lost connection or an invalid selection.
        closeDialog();
        try {
            await onenoteImport.runImport({ parentNoteId, sections, taskId: randomString(10), debug, shrinkImages: compressImages && shrinkImages });
        } catch (e) {
            toast.showError(extractServerMessage(e) ?? String(e));
        }
    }, [notebooks, selectedIds, parentNoteId, debug, compressImages, shrinkImages, closeDialog]);

    // Keep the latest import handler in a ref so the footer effect below depends only on the values the
    // footer actually shows (all primitives), never on doImport's identity. Depending on doImport — which
    // changes on every selection — would re-push a new footer to the parent on each keystroke, and since
    // the parent re-renders us back, that closes an infinite update loop.
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    // Surface the import button in the dialog's pinned footer once notebooks are loaded; the other
    // phases set it to null so the connect screens show no footer. The button carries the selection
    // count as feedback that a bulk (notebook/group) toggle selected what the user expected.
    const selectedCount = selectedIds.size;
    useEffect(() => {
        setFooter(phase !== "ready" ? null : (
            <Button
                text={selectedCount > 0 ? t("onenote_import.import_count", { count: selectedCount }) : t("onenote_import.import")}
                kind="primary"
                disabled={selectedCount === 0}
                onClick={() => void doImportRef.current()}
            />
        ));
    }, [phase, selectedCount, setFooter]);

    if (phase === "checking") {
        return (
            <Card heading={t("onenote_import.section_heading")}>
                <CardSection className="onenote-panel">
                    <NoItems icon="bx bx-loader-circle bx-spin" text={t("onenote_import.checking")} />
                </CardSection>
            </Card>
        );
    }

    if (phase === "disconnected" || phase === "connecting") {
        return (
            <Card heading={t("onenote_import.section_heading")}>
                <CardSection className="onenote-panel">
                    <p>{t("onenote_import.connect_description")}</p>
                    {phase === "connecting" && deviceLogin
                        ? (
                            <div className="onenote-device-signin">
                                <p>{t("onenote_import.device_instructions")}</p>
                                <div className="onenote-device-code">{deviceLogin.userCode}</div>
                                <div className="onenote-device-actions">
                                    <Button
                                        text={t("onenote_import.device_open_page")}
                                        kind="primary"
                                        icon="bx-link-external"
                                        onClick={() => window.open(deviceLogin.verificationUri, "_blank", "noopener,noreferrer")}
                                    />
                                    <Button text={t("onenote_import.device_cancel")} kind="lowProfile" onClick={cancelSignIn} />
                                </div>
                                <p className="onenote-status"><LoadingSpinner /> {t("onenote_import.connecting")}</p>
                            </div>
                        )
                        : phase === "connecting"
                            ? <p className="onenote-status"><LoadingSpinner /> {t("onenote_import.connecting")}</p>
                            : <Button text={t("onenote_import.connect")} kind="primary" icon="bxl-microsoft" onClick={connect} />}
                </CardSection>
            </Card>
        );
    }

    return (
        <Card heading={t("onenote_import.section_heading")}>
            <CardSection className="onenote-panel">
                <div className="onenote-account">
                    <span>{t("onenote_import.connected_as", { name: account?.name ?? "" })}</span>
                    <div className="onenote-account-actions">
                        <Button
                            text={t("onenote_import.refresh")}
                            kind="lowProfile"
                            size="small"
                            icon={refreshing ? "bx-refresh bx-spin" : "bx-refresh"}
                            disabled={refreshing}
                            onClick={() => void refresh()}
                        />
                        <Button text={t("onenote_import.disconnect")} kind="lowProfile" size="small" onClick={disconnect} />
                    </div>
                </div>

                {loadError && (
                    <NoItems icon="bx bx-error-circle" text={loadError}>
                        <Button
                            text={t("onenote_import.load_retry")}
                            kind="primary"
                            disabled={refreshing}
                            onClick={() => void refresh()}
                        />
                    </NoItems>
                )}

                {!loadError && notebooks.length === 0 && (
                    <>
                        <p>{t("onenote_import.no_notebooks")}</p>
                        <p className="onenote-hint">{t("onenote_import.no_notebooks_hint")}</p>
                    </>
                )}

                {!loadError && notebooks.length > 0 && (
                    <>
                        <OptionsRow name="onenote-sections" label={t("onenote_import.select_sections")} description={t("onenote_import.select_sections_hint")} stacked>
                            <div className="onenote-notebooks">
                                <CheckboxTree nodes={treeNodes} selectedIds={selectedIds} onChange={setSelectedIds} />
                            </div>
                        </OptionsRow>
                        <OptionsRowWithToggle
                            name="onenote-shrink-images"
                            label={t("import.shrinkImages")}
                            description={t("import.shrinkImagesProviderTooltip")}
                            currentValue={compressImages && shrinkImages}
                            onChange={setShrinkImages}
                            disabled={!compressImages}
                        />
                        <OptionsRowWithToggle
                            name="onenote-debug"
                            label={t("onenote_import.attach_source")}
                            description={t("onenote_import.attach_source_hint")}
                            currentValue={debug}
                            onChange={setDebug}
                        />
                    </>
                )}
            </CardSection>
        </Card>
    );
}

/** Maps a notebook's (or section group's) children onto picker tree nodes: sections become leaves,
 *  section groups become (recursed) containers. Sections and groups are interleaved in creation-date
 *  order so the picker mirrors the OneNote left rail (which the API can't reproduce exactly — see the
 *  order caveat above the list). */
function buildTreeNodes(container: OneNoteContainer): CheckboxTreeNode[] {
    return orderedChildren(container).map((child) => (child.type === "section"
        ? { id: child.section.id, label: child.section.title }
        : { id: child.group.id, label: child.group.title, children: buildTreeNodes(child.group) }));
}

const provider: ImportProvider = {
    id: "onenote",
    helpPage: "GnhlmrATVqcH",
    name: t("onenote_import.name"),
    iconUrl,
    description: t("onenote_import.description"),
    Panel: OneNotePanel
};

export default provider;

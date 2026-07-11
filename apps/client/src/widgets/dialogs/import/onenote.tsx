import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import onenoteImport, { buildSectionSelections, type OneNoteAccount, type OneNoteContainer, type OneNoteNotebook, orderedChildren } from "../../../services/onenote_import.js";
import toast from "../../../services/toast.js";
import { isElectron, randomString } from "../../../services/utils.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FormCheckbox from "../../react/FormCheckbox.js";
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
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [debug, setDebug] = useState(false);
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const loadNotebooks = useCallback(async () => {
        try {
            const { notebooks } = await onenoteImport.getNotebooks();
            setNotebooks(notebooks);
        } catch {
            toast.showError(t("onenote_import.load_failed"));
        }
    }, []);

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
            toast.showError(e instanceof Error ? e.message : String(e));
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

            const { authUrl } = await onenoteImport.getAuthUrl();
            window.open(authUrl, "_blank", "noopener,noreferrer");

            setPhase("connecting");
            stopPolling();
            pollRef.current = setInterval(async () => {
                try {
                    const status = await onenoteImport.getStatus();
                    if (status.connected) {
                        stopPolling();
                        setAccount(status.account);
                        await loadNotebooks();
                        setPhase("ready");
                    }
                } catch (e) {
                    // A transient poll failure shouldn't surface a toast on every tick; keep polling.
                    console.error("Failed to poll OneNote status:", e);
                }
            }, 2000);
        } catch (e) {
            toast.showError(e instanceof Error ? e.message : String(e));
            setPhase("disconnected");
        }
    }, [loadNotebooks, stopPolling]);

    const disconnect = useCallback(async () => {
        stopPolling();
        await onenoteImport.disconnect();
        setAccount(null);
        setNotebooks([]);
        setSelectedIds(new Set());
        setPhase("disconnected");
    }, [stopPolling]);

    const toggleSection = useCallback((id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);

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
            toast.showError(e instanceof Error ? e.message : String(e));
        }
    }, [notebooks, selectedIds, parentNoteId, debug, compressImages, shrinkImages, closeDialog]);

    // Keep the latest import handler in a ref so the footer effect below depends only on the values the
    // footer actually shows (all primitives), never on doImport's identity. Depending on doImport — which
    // changes on every selection — would re-push a new footer to the parent on each keystroke, and since
    // the parent re-renders us back, that closes an infinite update loop.
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    // Surface the import button in the dialog's pinned footer once notebooks are loaded; the other
    // phases set it to null so the connect screens show no footer.
    const importDisabled = selectedIds.size === 0;
    useEffect(() => {
        setFooter(phase !== "ready" ? null : (
            <Button
                text={t("onenote_import.import")}
                kind="primary"
                disabled={importDisabled}
                onClick={() => void doImportRef.current()}
            />
        ));
    }, [phase, importDisabled, setFooter]);

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
                    {phase === "connecting"
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
                    <Button text={t("onenote_import.disconnect")} kind="lowProfile" size="small" onClick={disconnect} />
                </div>

                {notebooks.length === 0
                    ? <p>{t("onenote_import.no_notebooks")}</p>
                    : (
                        <>
                            <OptionsRow name="onenote-sections" label={t("onenote_import.select_sections")} description={t("onenote_import.select_sections_hint")} stacked>
                                <div className="onenote-notebooks">
                                    {notebooks.map((notebook) => (
                                        <div className="onenote-notebook" key={notebook.id}>
                                            <strong>{notebook.title}</strong>
                                            <SectionTree container={notebook} selectedIds={selectedIds} onToggle={toggleSection} />
                                        </div>
                                    ))}
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

/** Renders a notebook's (or section group's) sections as checkboxes and recurses into nested section
 *  groups. Sections and groups are interleaved in creation-date order so the picker mirrors the OneNote
 *  left rail (which the API can't reproduce exactly — see the order caveat above the list). */
function SectionTree({ container, selectedIds, onToggle }: {
    container: OneNoteContainer;
    selectedIds: Set<string>;
    onToggle: (id: string, checked: boolean) => void;
}) {
    return (
        <>
            {orderedChildren(container).map((child) => (child.type === "section"
                ? (
                    <FormCheckbox
                        key={child.section.id}
                        name={`onenote-section-${child.section.id}`}
                        label={child.section.title}
                        currentValue={selectedIds.has(child.section.id)}
                        onChange={(checked) => onToggle(child.section.id, checked)}
                    />
                )
                : (
                    <div className="onenote-section-group" key={child.group.id}>
                        <span className="onenote-section-group-title">{child.group.title}</span>
                        <SectionTree container={child.group} selectedIds={selectedIds} onToggle={onToggle} />
                    </div>
                )))}
        </>
    );
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

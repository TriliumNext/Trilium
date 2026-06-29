import "./setup.css";

import { LOCALES, NetworkAddressesResponse, SetupSyncFromServerResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";

import logo from "./assets/icon-color.svg?url";
import { getCurrentLanguage, initLocale, t } from "./services/i18n";
import server from "./services/server";
import { isElectron, isMobileApp } from "./services/utils";
import Admonition, { ExtendedAdmonition } from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardFrame, CardSection } from "./widgets/react/Card";
import FormGroup from "./widgets/react/FormGroup";
import { FormListItem } from "./widgets/react/FormList";
import FormTextBox from "./widgets/react/FormTextBox";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";

async function main() {
    await initLocale();

    const bodyWrapper = document.createElement("div");
    bodyWrapper.classList.add("setup-outer-wrapper");
    document.body.classList.add("setup", window.glob.device || "desktop");
    if (isElectron()) {
        document.body.classList.add("electron", `platform-${window.glob.platform}`, "background-effects");
    }
    render(<App />, bodyWrapper);
    document.body.replaceChildren(bodyWrapper);
}

type State = "selectLanguage" | "firstOptions" | "createNewDocumentOptions" | "createNewDocumentWithDemo" | "createNewDocumentEmpty" | "syncFromDesktop" | "syncFromServer" | "syncFromServerInProgress" | "syncFromDesktopInProgress" | "syncFailed";

const STATE_ORDER: State[] = ["selectLanguage", "firstOptions", "createNewDocumentOptions", "createNewDocumentWithDemo", "createNewDocumentEmpty", "syncFromDesktop", "syncFromServer", "syncFromServerInProgress", "syncFromDesktopInProgress", "syncFailed"];

function renderState(state: State, setState: (state: State) => void) {
    switch (state) {
        case "selectLanguage": return <SelectLanguage setState={setState} />;
        case "firstOptions": return <SetupOptions setState={setState} />;
        case "createNewDocumentOptions": return <CreateNewDocumentOptions setState={setState} />;
        case "createNewDocumentWithDemo": return <CreateNewDocumentInProgress withDemo />;
        case "createNewDocumentEmpty": return <CreateNewDocumentInProgress />;
        case "syncFromServer": return <SyncFromServer setState={setState} />;
        case "syncFromDesktop": return <SyncFromDesktop setState={setState} />;
        case "syncFromServerInProgress": return <SyncInProgress device="server" />;
        case "syncFromDesktopInProgress": return <SyncInProgress device="desktop" />;
        default: return null;
    }
}

function App() {
    const [state, setState] = useState<State>("selectLanguage");
    const [prevState, setPrevState] = useState<State | null>(null);
    const [transitioning, setTransitioning] = useState(false);
    const prevStateRef = useRef<State>(state);

    function handleSetState(newState: State) {
        setPrevState(prevStateRef.current);
        prevStateRef.current = newState;
        setTransitioning(true);
        setState(newState);
    }

    const direction = prevState !== null
        ? STATE_ORDER.indexOf(state) > STATE_ORDER.indexOf(prevState) ? "forward" : "backward"
        : "forward";

    return (
        <div class="setup-container">
            <div class="drag-region" />
            {transitioning && prevState !== null && (
                <div
                    class={`slide-page slide-out-${direction}`}
                    onAnimationEnd={() => {
                        setTransitioning(false);
                        setPrevState(null);
                    }}
                >
                    {renderState(prevState, handleSetState)}
                </div>
            )}
            <div class={`slide-page ${transitioning ? `slide-in-${direction}` : "slide-current"}`} key={state}>
                {renderState(state, handleSetState)}
            </div>
        </div>
    );
}

function SelectLanguage({ setState }: { setState: (state: State) => void }) {
    const { t, i18n } = useTranslation();
    const [ currentLocale, setCurrentLocale ] = useState(i18n.language);
    const filteredLocales = useMemo(() => LOCALES.filter(l => !l.contentOnly), []);

    return (
        <SetupPage
            title={t("setup.language")}
            className="select-language"
            illustration={<Icon icon="bx bx-globe" className="illustration-icon" />}
            footer={<Button text={t("setup.continue")} kind="primary" onClick={() => setState("firstOptions")} />}
        >
            <Card>
                <CardSection>
                    {filteredLocales.map(locale => (
                        <FormListItem
                            key={locale.id}
                            value={locale.id}
                            active={locale.id === currentLocale}
                            rtl={locale.rtl}
                            onClick={async () => {
                                await i18n.changeLanguage(locale.id);
                                setCurrentLocale(locale.id);
                                document.body.dir = locale.rtl ? "rtl" : "ltr";
                            }}
                        >
                            {locale.name}
                        </FormListItem>
                    ))}
                </CardSection>
            </Card>
        </SetupPage>
    );
}

function SetupOptions({ setState }: { setState: (state: State) => void }) {
    return (
        <SetupPage
            title={t("setup.heading")}
            className="setup-options-container"
            illustration={<img src={logo} alt="Setup illustration" className="illustration-logo" />}
            onBack={() => setState("selectLanguage")}
        >
            <div class="setup-options">
                <SetupOptionCard
                    icon="bx bx-file-blank"
                    title={t("setup.new-document")}
                    description={t("setup.new-document-description")}
                    onClick={() => setState("createNewDocumentOptions")}
                />

                <SetupOptionCard
                    icon="bx bx-server"
                    title={t("setup.sync-from-server")}
                    description={t("setup.sync-from-server-description")}
                    onClick={() => setState("syncFromServer")}
                />

                <SetupOptionCard
                    icon="bx bx-desktop"
                    title={t("setup.sync-from-desktop")}
                    description={t("setup.sync-from-desktop-description")}
                    disabled={glob.isStandalone}
                    onClick={() => setState("syncFromDesktop")}
                />
            </div>
        </SetupPage>
    );
}

type SyncStep = "connecting" | "syncing" | "finalizing";

function getSyncStep(stats: { outstandingPullCount: number; totalPullCount: number | null; initialized: boolean }): SyncStep {
    if (stats.initialized) {
        return "finalizing"; // will reload momentarily
    }
    if (stats.totalPullCount !== null && stats.outstandingPullCount > 0) {
        return "syncing";
    }
    if (stats.totalPullCount !== null && stats.outstandingPullCount === 0) {
        return "finalizing";
    }
    return "connecting";
}

function useWakeLock() {
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);

    useEffect(() => {
        if (!("wakeLock" in navigator)) return;

        let released = false;

        const acquireLock = () => {
            navigator.wakeLock.request("screen").then((lock) => {
                if (released) {
                    lock.release();
                } else {
                    wakeLockRef.current = lock;
                }
            }).catch(() => {
                // Wake Lock not supported or permission denied — ignore silently.
            });
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === "visible" && !released) {
                acquireLock();
            }
        };

        acquireLock();
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            released = true;
            document.removeEventListener("visibilitychange", onVisibilityChange);
            wakeLockRef.current?.release();
            wakeLockRef.current = null;
        };
    }, []);
}

function SyncInProgress({ device }: { device: "server" | "desktop" }) {
    const stats = useOutstandingSyncInfo();
    const step = getSyncStep(stats);
    useWakeLock();

    useEffect(() => {
        if (stats.initialized) {
            onSetupFinished();
        }
    }, [stats.initialized]);

    const steps: { key: SyncStep; label: string }[] = [
        { key: "connecting", label: t("setup.sync-step-connecting") },
        { key: "syncing", label: t("setup.sync-step-syncing") },
        { key: "finalizing", label: t("setup.sync-step-finalizing") }
    ];

    const currentIndex = steps.findIndex((s) => s.key === step);

    const syncingDone = currentIndex > steps.findIndex((s) => s.key === "syncing");
    let progress = 0;
    if (syncingDone) {
        progress = 100;
    } else if (stats.totalPullCount) {
        progress = Math.round(((stats.totalPullCount - stats.outstandingPullCount) / stats.totalPullCount) * 100);
    }

    return (
        <SetupPage
            className="sync-in-progress"
            illustration={<SyncIllustration targetDevice={device} />}
            title={t("setup.sync-in-progress-title")}
        >
            <Card className="sync-steps">
                {steps.map((s, i) => (
                    <CardSection className={i < currentIndex ? "completed" : i === currentIndex ? "active" : ""} key={s.key}>
                        <Icon icon={i < currentIndex ? "bx bx-check-circle" : i === currentIndex ? "bx bx-loader-circle bx-spin" : "bx bx-circle"} />{" "}
                        {s.label}
                        {s.key === "syncing" && (
                            <div class="sync-progress">
                                <progress value={syncingDone ? 1 : stats.totalPullCount! - stats.outstandingPullCount} max={syncingDone ? 1 : stats.totalPullCount!} />
                                <span>{progress}%</span>
                            </div>
                        )}
                    </CardSection>
                ))}
            </Card>

            {isMobileApp() && (
                <Admonition type="note" className="sync-banner">
                    {t("setup.sync-in-progress-banner")}
                </Admonition>
            )}
        </SetupPage>
    );
}

function useOutstandingSyncInfo() {
    const [ outstandingPullCount, setOutstandingPullCount ] = useState(0);
    const [ totalPullCount, setTotalPullCount ] = useState<number | null>(null);
    const [ initialized, setInitialized ] = useState(false);

    async function refresh() {
        const resp = await server.get<{ outstandingPullCount: number; totalPullCount: number | null; initialized: boolean }>("sync/stats");
        setOutstandingPullCount(resp.outstandingPullCount);
        setTotalPullCount(resp.totalPullCount);
        setInitialized(resp.initialized);
    }

    useEffect(() => {
        const interval = setInterval(refresh, 1000);
        refresh();

        return () => clearInterval(interval);
    }, []);
    return { outstandingPullCount, totalPullCount, initialized };
}

function CreateNewDocumentOptions({ setState }: { setState: (state: State) => void }) {
    return (
        <SetupPage
            className="create-new-document-options"
            title={t("setup.create-new-document-options-title")}
            illustration={<Icon icon="bx bx-star" className="illustration-icon" />}
            onBack={() => setState("firstOptions")}
        >
            <div class="setup-options">
                <SetupOptionCard icon="bx bx-book-open" title={t("setup.create-new-document-options-with-demo")} description={t("setup.create-new-document-options-with-demo-description")} onClick={() => setState("createNewDocumentWithDemo")} />
                <SetupOptionCard icon="bx bx-file-blank" title={t("setup.create-new-document-options-empty")} description={t("setup.create-new-document-options-empty-description")} onClick={() => setState("createNewDocumentEmpty")} />
            </div>
        </SetupPage>
    );
}

function CreateNewDocumentInProgress({ withDemo = false }: { withDemo?: boolean }) {
    useEffect(() => {
        server.post(`setup/new-document${withDemo ? "" : "?skipDemoDb"}`, { locale: getCurrentLanguage() }).then(onSetupFinished);
    }, [ withDemo ]);

    return (
        <SetupPage
            className="create-new-document"
            title={t("setup.create-new-document-title")}
            description={t("setup.create-new-document-description")}
            illustration={<Icon icon="bx bx-loader-circle bx-spin" className="illustration-icon" />}
        />
    );
}

function SyncFromServer({ setState }: { setState: (state: State) => void }) {
    const [ syncServerHost, setSyncServerHost ] = useState("");
    const [ password, setPassword ] = useState("");
    const [ syncProxy, setSyncProxy ] = useState("");
    const [ error, setError ] = useState<string | null>(null);
    const [ errorId, setErrorId ] = useState(0);
    const [ isWrongPassword, setIsWrongPassword ] = useState(false);
    const isValid = syncServerHost.trim() !== "" && password !== "";

    function raiseError(message: string) {
        setError(message);
        setErrorId(id => id + 1);
    }

    async function handleFinishSetup() {
        try {
            const resp = await server.post<SetupSyncFromServerResponse>("setup/sync-from-server", {
                syncServerHost: syncServerHost.trim().replace(/\/+$/, ""),
                syncProxy: syncProxy.trim(),
                password
            });

            if (resp.result === "success") {
                setState("syncFromServerInProgress");
            } else if (resp.error.includes("Incorrect password")) {
                setIsWrongPassword(true);
            } else {
                raiseError(t("setup.sync-failed", { message: resp.error }));
            }
        } catch (e) {
            raiseError(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <SetupPage
            className="sync-from-server top-aligned"
            title={t("setup.sync-from-server")}
            description={t("setup.sync-from-server-page-description")}
            illustration={<SyncIllustration targetDevice="server" />}
            error={error}
            errorId={errorId}
            onBack={() => setState("firstOptions")}
            footer={<Button text={t("setup.button-finish-setup")} kind="primary" onClick={handleFinishSetup} disabled={!isValid} />}
        >
            <form>
                <Card>
                    <CardSection>
                        <FormGroup label={t("setup.server-host")} name="serverHost">
                            <FormTextBox
                                placeholder={t("setup.server-host-placeholder")}
                                currentValue={syncServerHost} onChange={setSyncServerHost}
                                autocomplete="trilium-sync-server-host"
                                required
                            />
                        </FormGroup>
                    </CardSection>

                    <CardSection>
                        <FormGroup
                            label={t("setup.server-password")} name="serverPassword"
                            error={isWrongPassword ? t("setup.wrong-password") : undefined}
                        >
                            <FormTextBox
                                type="password"
                                currentValue={password} onChange={setPassword}
                                autocomplete="trilium-sync-server-password"
                                required
                            />
                        </FormGroup>
                    </CardSection>
                </Card>

                <Card heading={t("setup.advanced-options")}>
                    <CardSection>
                        <FormGroup
                            name="proxyServer"
                            label={t("setup.proxy-server")}
                            description={isElectron() ? t("setup.proxy-instruction") : undefined}
                        >
                            <FormTextBox placeholder={t("setup.proxy-server-placeholder")} currentValue={syncProxy} onChange={setSyncProxy} />
                        </FormGroup>
                    </CardSection>
                </Card>
            </form>
        </SetupPage>
    );
}

function SyncFromDesktop({ setState }: { setState: (state: State) => void }) {
    const [ networkInfo, setNetworkInfo ] = useState<NetworkAddressesResponse | null>(null);

    useEffect(() => {
        getNetworkAddresses().then(setNetworkInfo);
    }, []);

    // Don't wait for an incoming connection that can't arrive: when the host is
    // only bound to loopback the advertised addresses are unreachable, so the
    // other device will never connect. Hold off polling until reachability is
    // confirmed.
    const reachable = networkInfo?.reachableOnNetwork ?? false;

    useEffect(() => {
        if (!reachable) {
            return;
        }
        const interval = setInterval(async () => {
            const status = await server.get<{ schemaExists: boolean }>("setup/status");
            if (status.schemaExists) {
                setState("syncFromDesktopInProgress");
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [setState, reachable]);

    return (
        <SetupPage
            className="sync-from-desktop"
            title={t("setup.sync-from-desktop")}
            illustration={<SyncIllustration targetDevice="desktop" />}
            onBack={() => setState("firstOptions")}
        >
            {networkInfo && !networkInfo.reachableOnNetwork ? (
                <ExtendedAdmonition
                    type="caution"
                    className="sync-from-desktop-unreachable"
                    icon="bx bx-wifi-off"
                    title={t("setup.sync-from-desktop-unreachable-title")}
                >
                    <p>{t("setup.sync-from-desktop-unreachable-description")}</p>
                    {isElectron() && (
                        <div class="unreachable-actions">
                            <Button
                                kind="primary"
                                icon="bx bx-broadcast"
                                text={t("setup.sync-from-desktop-allow-access")}
                                onClick={() => void allowLanAccessAndRestart()}
                            />
                        </div>
                    )}
                </ExtendedAdmonition>
            ) : (
                <>
                    <div class="card-columns">
                        <Card heading="On the other device">
                            <CardSection>1. {t("setup.sync-from-desktop-step1")}</CardSection>
                            <CardSection>2. {t("setup.sync-from-desktop-step2")}</CardSection>
                            <CardSection>3. {t("setup.sync-from-desktop-step3")}</CardSection>
                            <CardSection>4. {t("setup.sync-from-desktop-step4")}</CardSection>
                            <CardSection>5. {t("setup.sync-from-desktop-step5")}</CardSection>
                        </Card>

                        {networkInfo && networkInfo.addresses.length > 0 && (
                            <Card heading={t("setup.your-ip-addresses")} className="ip-addresses">
                                {networkInfo.addresses.map((addr) => (
                                    <CardSection key={addr}>{addr}</CardSection>
                                ))}
                            </Card>
                        )}
                    </div>

                    <div class="sync-from-desktop-waiting">
                        <div class="main"><Icon icon="bx bx-loader-circle bx-spin" />{" "} {t("setup.sync-from-desktop-waiting")}</div>
                        <div class="subtle">{t("setup.sync-from-desktop-warning")}</div>
                    </div>
                </>
            )}
        </SetupPage>
    );
}

function SyncIllustration({ targetDevice }: { targetDevice: "desktop" | "server" }) {
    let icon = "bx bx-globe";
    if (isMobileApp()) {
        icon = "bx bx-mobile-alt";
    } else if (isElectron()) {
        icon = "bx bx-desktop";
    }

    return (
        <div class="sync-illustration">
            <div>
                <Icon icon={icon} />
                {t("setup.sync-illustration-this-device")}
            </div>
            <div class="sync-illustration-arrows" />
            <div>
                <Icon icon={targetDevice === "desktop" ? "bx bx-desktop" : "bx bx-server"} />
                {targetDevice === "desktop" ? t("setup.sync-illustration-desktop-app") : t("setup.sync-illustration-server")}
            </div>
        </div>
    );
}

function SetupOptionCard({ title, description, icon, onClick, disabled }: { title: string; description: string, icon: string, onClick?: () => void, disabled?: boolean }) {
    return (
        <CardFrame
            className={clsx("setup-option-card", { disabled })}
            onClick={disabled ? undefined : onClick}
        >
            <Icon icon={icon} />

            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </CardFrame>
    );
}

async function getNetworkAddresses(): Promise<NetworkAddressesResponse> {
    if (!isElectron()) {
        // The browser already reached this server over the network, so the
        // address it's using is reachable by definition.
        return { addresses: [`${location.protocol}//${location.host}`], reachableOnNetwork: true };
    }

    // Node's `os` module isn't available in the renderer (node integration is
    // disabled), and the desktop renderer's `location` points at the internal
    // `trilium-app://` protocol rather than the real HTTP listener. So the
    // server enumerates its interfaces and builds the reachable URLs (correct
    // protocol and port included), and reports whether it's actually bound to a
    // network-reachable interface.
    return await server.get<NetworkAddressesResponse>("network-addresses");
}

async function allowLanAccessAndRestart() {
    // Shows a native confirmation dialog (LAN exposure is a security tradeoff)
    // and persists the choice to security.json. Only restart once the user has
    // actually confirmed — otherwise the binding wouldn't change anyway.
    const confirmed = await window.electronApi?.security.setLanAccessEnabled(true);
    if (confirmed) {
        window.electronApi?.window.restartApp();
    }
}

function onSetupFinished() {
    if (isElectron()) {
        // On Electron we need to use the setup route because it handles the closing of the setup window and opening the main app window.
        location.href = "setup";
    } else {
        location.reload();
    }
}

main();

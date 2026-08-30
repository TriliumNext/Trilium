import "./setup.css";

import { LOCALES, MOBILE_SYNC_MAX_BLOB_CONTENT_SIZE, NetworkAddressesResponse, SetupSyncFromServerResponse, type SetupTargetScreen } from "@triliumnext/commons";
import clsx from "clsx";
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";

import logo from "./assets/icon-color.svg?url";
import { getCurrentLanguage, initLocale, t } from "./services/i18n";
import server from "./services/server";
import { isElectron, isMobileApp } from "./services/utils";
import SetupBackupDatabase from "./setup_backup";
import ExistingData, {
    deleteExistingData,
    hasExistingData,
    keepExistingData,
    refreshExistingData
} from "./setup_existing";
import RestoreFromBackup from "./setup_restore";
import SetupUnlock from "./setup_unlock";
import Admonition, { ExtendedAdmonition } from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardFrame, CardSection } from "./widgets/react/Card";
import FormGroup from "./widgets/react/FormGroup";
import { FormListItem } from "./widgets/react/FormList";
import FormTextBox from "./widgets/react/FormTextBox";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";
import SlidePages from "./widgets/react/SlidePages";

async function main() {
    await initLocale("en", "entry");

    const bodyWrapper = document.createElement("div");
    bodyWrapper.classList.add("setup-outer-wrapper");
    document.body.classList.add("setup", window.glob.device || "desktop");
    if (isElectron()) {
        document.body.classList.add("electron", `platform-${window.glob.platform}`);
        // Going transparent is only safe where the window actually has a backdrop material
        // (Windows 11 22H2+ Mica / macOS vibrancy) — elsewhere the window composites to
        // black, making light-theme text unreadable (#10590).
        if (window.glob.hasBackgroundEffects) {
            document.body.classList.add("background-effects");
        }
    }
    render(<App />, bodyWrapper);
    document.body.replaceChildren(bodyWrapper);
}

type State = "unlock" | "backupDatabase" | "existingData" | "selectLanguage" | "firstOptions" | "createNewDocumentOptions" | "createNewDocumentWithDemo" | "createNewDocumentEmpty" | "restoreFromBackup" | "syncFromDesktop" | "syncFromServer" | "syncFromServerInProgress" | "syncFromDesktopInProgress" | "syncFailed";

const STATE_ORDER: State[] = ["unlock", "backupDatabase", "selectLanguage", "existingData", "firstOptions", "createNewDocumentOptions", "createNewDocumentWithDemo", "createNewDocumentEmpty", "restoreFromBackup", "syncFromDesktop", "syncFromServer", "syncFromServerInProgress", "syncFromDesktopInProgress", "syncFailed"];

export function renderState(state: State, setState: (state: State) => void) {
    switch (state) {
        // Nothing else in the wizard can be reached until this is answered, which is the point.
        case "unlock": return <SetupUnlock onUnlocked={() => setState(afterUnlock(window.glob))} />;
        // Leads nowhere by design: the wizard was opened to take a backup of the database it is
        // sitting on, so the only way out of it is back into that database.
        case "backupDatabase": return <SetupBackupDatabase onDone={() => void onExistingDataKept()} />;
        case "existingData": return (
            <ExistingData
                onProceed={() => setState(afterExistingData(window.glob))}
                onKept={onSetupFinished}
            />
        );
        case "selectLanguage": return <SelectLanguage setState={setState} />;
        case "firstOptions": return <SetupOptions setState={setState} onKeep={() => void onExistingDataKept()} />;
        case "createNewDocumentOptions": return <CreateNewDocumentOptions setState={setState} />;
        case "createNewDocumentWithDemo": return <CreateNewDocumentInProgress withDemo setState={setState} />;
        case "createNewDocumentEmpty": return <CreateNewDocumentInProgress setState={setState} />;
        // No way back where the wizard was opened for this and nothing else: the menu it would
        // return to was never shown, and on an instance that had a database it is not a menu the
        // user asked for. Nothing is erased on the way in either — a restore checks the backup and
        // only then swaps the database, so an unusable file leaves the user with what they had.
        case "restoreFromBackup": return (
            <RestoreFromBackup
                onBack={openedAtRestore(window.glob) ? undefined : () => setState("firstOptions")}
                onRestored={onSetupFinished}
            />
        );
        case "syncFromServer": return <SyncFromServer setState={setState} />;
        case "syncFromDesktop": return <SyncFromDesktop setState={setState} />;
        case "syncFromServerInProgress": return <SyncInProgress device="server" setState={setState} />;
        case "syncFromDesktopInProgress": return <SyncInProgress device="desktop" setState={setState} />;
        case "syncFailed": return <SyncFailed setState={setState} />;
        default: return null;
    }
}

function App() {
    // A sync that already created the schema but was interrupted before finishing
    // resumes straight on the progress screen instead of restarting the wizard.
    const resuming = window.glob.syncInProgress === true;
    const [state, setState] = useState<State>(initialState(window.glob));

    useEffect(() => {
        if (!resuming) {
            return;
        }
        // The background sync timer stays gated behind DB initialization, so nothing
        // restarts the interrupted sync on its own — kick it off like the launch-bar
        // button does. sync/now is a no-op if a sync is somehow already running.
        server.post("sync/now").catch(() => {
            // Ignore — the progress screen keeps polling sync/stats regardless.
        });
    }, [resuming]);

    return (
        <div class="setup-container">
            <div class="drag-region" />

            <SlidePages current={state} order={STATE_ORDER}>
                {(page) => renderState(page, setState)}
            </SlidePages>
        </div>
    );
}

/** What the wizard needs to know from the bootstrap to decide where it opens and where it goes next. */
interface SetupGlob {
    syncInProgress?: boolean;
    hasExistingData?: boolean;
    setupAuthRequired?: boolean;
    setupTargetScreen?: SetupTargetScreen;
}

/**
 * Where the wizard opens.
 *
 * Every run starts at the language step and works forward from there. Three things come in already
 * knowing better: a wizard with a knowledge base behind it that has to be unlocked before it will do
 * anything, a sync interrupted after it created the schema, and an instance sent to a particular
 * screen through a `setup.json` marker.
 */
export function initialState(glob: SetupGlob): State {
    // First of all, because everything below it acts on a knowledge base that is still there.
    if (glob.setupAuthRequired) {
        return "unlock";
    }

    if (glob.syncInProgress) {
        return "syncFromServerInProgress";
    }

    return afterUnlock(glob);
}

/** The rest of the wizard, once there is nothing left standing in front of it. */
function afterUnlock(glob: SetupGlob): State {
    // Asked for by a running instance that wants its database held still long enough to be copied.
    // Straight there, past the language: the instance already runs in one, and the copy is the whole
    // errand rather than a step on the way to a menu the user never asked for.
    if (glob.setupTargetScreen === "backup-database" && glob.hasExistingData) {
        return "backupDatabase";
    }

    return "selectLanguage";
}

/**
 * Where the language step leads.
 *
 * The offer of a copy comes after it rather than before, so that a question about the user's own
 * knowledge base is put in the language they have just chosen rather than in whichever one the
 * instance happened to be running in.
 */
export function afterLanguage(glob: SetupGlob): State {
    // The one moment the database is open with nothing running against it, which is what taking a
    // copy of it needs.
    if (glob.hasExistingData) {
        return "existingData";
    }

    return afterExistingData(glob);
}

/**
 * Whether the restore screen is where this wizard was sent, rather than somewhere the user walked
 * to through it. A marker naming it is the only way that happens.
 */
export function openedAtRestore(glob: SetupGlob): boolean {
    return glob.setupTargetScreen === "restore-backup";
}

/**
 * Where the wizard goes once there is nothing left to lose.
 *
 * The same answer a first run gets, which is the point: by the time this is reached the instance has
 * no database, so it is being set up exactly as a new one would be, except that it may have been
 * told which screen the user was heading for.
 */
function afterExistingData(glob: SetupGlob): State {
    switch (glob.setupTargetScreen) {
        case "restore-backup": return "restoreFromBackup";
        // Deliberately not a lookup table: two of the states below create a document the moment they
        // are shown, and nothing outside this file should be able to name one.
        default: return "firstOptions";
    }
}

function SelectLanguage({ setState }: { setState: (state: State) => void }) {
    const { t, i18n } = useTranslation();
    const [ currentLocale, setCurrentLocale ] = useState(i18n.language);
    const filteredLocales = useMemo(() => LOCALES.filter(l => !l.contentOnly), []);
    // The row the user chose last, which is not the last bundle to arrive: each language is a
    // 160-290 KB fetch, so two taps in a row are answered in whichever order the two loads finish.
    const chosen = useRef(currentLocale);

    return (
        <SetupPage
            title={t("setup.language")}
            className="select-language"
            illustration={<Icon icon="bx bx-globe" className="illustration-icon" />}
            footer={<Button text={t("setup.continue")} kind="primary" onClick={() => setState(afterLanguage(window.glob))} />}
        >
            <Card>
                <CardSection>
                    {filteredLocales.map(locale => (
                        <FormListItem
                            key={locale.id}
                            value={locale.id}
                            active={locale.id === currentLocale}
                            rtl={locale.rtl}
                            onClick={() => {
                                // Marked chosen on the press rather than once its bundle has
                                // loaded: on a phone that wait is seconds long, and a row that
                                // does not light up reads as a tap that missed.
                                chosen.current = locale.id;
                                setCurrentLocale(locale.id);
                                document.body.dir = locale.rtl ? "rtl" : "ltr";

                                void i18n.changeLanguage(locale.id).then(() => {
                                    // An earlier, larger bundle landing after this one would
                                    // otherwise leave the app speaking a language the user has
                                    // already tapped away from.
                                    if (chosen.current !== locale.id) {
                                        void i18n.changeLanguage(chosen.current);
                                    }
                                });
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

function SetupOptions({ setState, onKeep }: { setState: (state: State) => void; onKeep: () => void }) {
    const [ error, setError ] = useState<string | null>(null);
    const [ errorId, setErrorId ] = useState(0);

    /**
     * Clears the way for a knowledge base that another desktop will push, then waits for it.
     *
     * The one path that cannot erase at the moment the database is created, because that moment
     * belongs to the other device rather than to anything pressed here: this instance only waits,
     * and it decides it has a database by seeing a schema appear, which the old one would satisfy on
     * its own. So arriving on the screen is what commits, and it is asked about with the browser's
     * own dialog for the same reason every other erasure in the wizard is.
     */
    async function syncFromDesktop() {
        if (hasExistingData()) {
            if (!window.confirm(t("setup.existing-data-erase-confirm"))) {
                return;
            }

            try {
                await deleteExistingData();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setErrorId((previous) => previous + 1);
                return;
            }
        }

        setState("syncFromDesktop");
    }

    return (
        <SetupPage
            title={t("setup.heading")}
            className="setup-options-container"
            illustration={<img src={logo} alt="Setup illustration" className="illustration-logo" />}
            error={error}
            errorId={errorId}
            // Back to whichever step actually came before this one: the offer of a copy where there
            // is still something to copy, and the language where that offer was never made.
            onBack={() => setState(hasExistingData() ? "existingData" : "selectLanguage")}
        >
            <div class="setup-options">
                {/* First, and offered only while there is something to go back to. Set apart from
                    the four below rather than made one of them: those replace the knowledge base
                    and this one is how the user leaves it exactly as they found it. */}
                {hasExistingData() && (
                    <CardFrame className="setup-option-card setup-keep-card" onClick={onKeep}>
                        <Icon icon="bx bx-log-in-circle" />

                        <div>
                            <h3>{t("setup.keep-existing")}</h3>
                            <p>{t("setup.keep-existing-description")}</p>
                        </div>
                    </CardFrame>
                )}

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
                    onClick={() => void syncFromDesktop()}
                />

                <SetupOptionCard
                    icon="bx bx-archive-in"
                    title={t("setup.restore-from-backup")}
                    description={t("setup.restore-from-backup-description")}
                    onClick={() => setState("restoreFromBackup")}
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

export function SyncInProgress({ device, setState }: { device: "server" | "desktop"; setState: (state: State) => void }) {
    const stats = useOutstandingSyncInfo();
    const step = getSyncStep(stats);
    useWakeLock();

    useEffect(() => {
        if (stats.initialized) {
            onSetupFinished();
        }
    }, [stats.initialized]);

    useEffect(() => {
        // Only the sync-from-server flow runs sync attempts on this instance; in the
        // sync-from-desktop flow the OTHER device pushes to us, so no local error can occur.
        if (device === "server" && stats.lastSyncError && !stats.initialized) {
            setState("syncFailed");
        }
    }, [device, stats.lastSyncError, stats.initialized, setState]);

    const steps: { key: SyncStep; label: string }[] = [
        { key: "connecting", label: t("setup.sync-step-connecting") },
        { key: "syncing", label: t("setup.sync-step-syncing") },
        { key: "finalizing", label: t("setup.sync-step-finalizing") }
    ];

    const currentIndex = steps.findIndex((s) => s.key === step);

    const syncingDone = currentIndex > steps.findIndex((s) => s.key === "syncing");
    // Pulled-so-far, clamped: the remote can gain changes mid-sync, briefly pushing the
    // outstanding count above the frozen total, which would otherwise show a negative bar.
    const pulled = stats.totalPullCount ? Math.max(0, stats.totalPullCount - stats.outstandingPullCount) : 0;
    let progress = 0;
    if (syncingDone) {
        progress = 100;
    } else if (stats.totalPullCount) {
        progress = Math.min(100, Math.round((pulled / stats.totalPullCount) * 100));
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
                                <progress value={syncingDone ? 1 : pulled} max={syncingDone ? 1 : (stats.totalPullCount ?? 1)} />
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

export function SyncFailed({ setState }: { setState: (state: State) => void }) {
    const stats = useOutstandingSyncInfo();
    // Freeze the last seen error: when a retry starts, the server clears it before the
    // attempt runs, and the text must not blank out while this page transitions away.
    const [ message, setMessage ] = useState<string | null>(null);

    useEffect(() => {
        if (stats.initialized) {
            // The retry converged before we even switched back to the progress screen.
            onSetupFinished();
        } else if (stats.lastSyncError) {
            setMessage(stats.lastSyncError);
        } else if (message !== null) {
            // The error was cleared server-side — a new sync attempt is underway, so hand
            // back to the progress screen. Driven by the polled server state rather than the
            // button click, which avoids racing the sync/now request against the next poll.
            setState("syncFromServerInProgress");
        }
    }, [stats.lastSyncError, stats.initialized, message, setState]);

    return (
        <SetupPage
            className="sync-failed"
            title={t("setup.sync-failed-title")}
            description={t("setup.sync-failed-description")}
            illustration={<Icon icon="bx bx-error-circle" className="illustration-icon" />}
            onBack={() => setState("syncFromServer")}
            footer={
                <Button
                    text={t("setup.button-retry")}
                    kind="primary"
                    icon="bx bx-refresh"
                    onClick={() => {
                        // Fire-and-forget: the polling effect above notices the attempt
                        // starting (error cleared) and switches to the progress screen.
                        server.post("sync/now").catch(() => {});
                    }}
                />
            }
        >
            {message && (
                <ExtendedAdmonition
                    type="caution"
                    icon="bx bx-error-circle"
                    title={t("setup.sync-failed-admonition-title")}
                >
                    {/* Kept fully visible (not collapsed): bug reports are often just a
                        screenshot of this screen, and the raw error is what matters. */}
                    <pre>{message}</pre>
                    <p>{t("setup.sync-failed-hint")}</p>
                </ExtendedAdmonition>
            )}
        </SetupPage>
    );
}

function useOutstandingSyncInfo() {
    const [ outstandingPullCount, setOutstandingPullCount ] = useState(0);
    const [ totalPullCount, setTotalPullCount ] = useState<number | null>(null);
    const [ initialized, setInitialized ] = useState(false);
    const [ lastSyncError, setLastSyncError ] = useState<string | null>(null);

    async function refresh() {
        const resp = await server.get<{ outstandingPullCount: number; totalPullCount: number | null; initialized: boolean; lastSyncError?: string | null }>("sync/stats");
        setOutstandingPullCount(resp.outstandingPullCount);
        setTotalPullCount(resp.totalPullCount);
        setInitialized(resp.initialized);
        setLastSyncError(resp.lastSyncError ?? null);
    }

    useEffect(() => {
        const interval = setInterval(refresh, 1000);
        refresh();

        return () => clearInterval(interval);
    }, []);
    return { outstandingPullCount, totalPullCount, initialized, lastSyncError };
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

/**
 * The wait while the database is created, and what became of it if it was not.
 *
 * A failure has to be said out loud rather than left to the spinner: this screen has nothing to
 * poll and no other way of ending, so a request that comes back with an error would otherwise leave
 * it turning for as long as the user was willing to watch it.
 */
function CreateNewDocumentInProgress({ withDemo = false, setState }: {
    withDemo?: boolean;
    setState: (state: State) => void;
}) {
    const [ error, setError ] = useState<string | null>(null);

    useEffect(() => {
        server.post(`setup/new-document${withDemo ? "" : "?skipDemoDb"}`, { locale: getCurrentLanguage() })
            .then(onSetupFinished)
            .catch(async (e: unknown) => {
                // The knowledge base is erased server-side as the first step of this, so a failure
                // may well have left nothing behind the wizard. Asked again before the menu is
                // shown once more, which decides from that answer what it may still offer.
                await refreshExistingData();
                setError(messageOf(e));
            });
    }, [ withDemo ]);

    return (
        <SetupPage
            className="create-new-document"
            title={error ? t("setup.create-new-document-failed") : t("setup.create-new-document-title")}
            description={error ? undefined : t("setup.create-new-document-description")}
            illustration={
                <Icon
                    icon={error ? "bx bx-error-circle" : "bx bx-loader-circle bx-spin"}
                    className="illustration-icon"
                />
            }
            error={error}
            // Only once there is something to go back from: while it is running there is nothing to
            // return to that would not leave a half-created database behind.
            onBack={error ? () => setState("createNewDocumentOptions") : undefined}
        />
    );
}

/**
 * Whatever the failure has to say for itself.
 *
 * A rejected request is not an `Error`: the client's own layer rejects with the response body as a
 * string, or with a bare word when the browser dropped the request.
 */
function messageOf(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    if (typeof e === "string") {
        try {
            const parsed: unknown = JSON.parse(e);
            if (typeof parsed === "object" && parsed !== null && "message" in parsed
                && typeof parsed.message === "string") {
                return parsed.message;
            }
        } catch {
            // Not JSON, so it is already whatever the server had to say.
        }

        return e;
    }

    return String(e);
}

export function SyncFromServer({ setState }: { setState: (state: State) => void }) {
    const [ syncServerHost, setSyncServerHost ] = useState("");
    const [ password, setPassword ] = useState("");
    const [ syncProxy, setSyncProxy ] = useState("");
    const [ error, setError ] = useState<string | null>(null);
    const [ errorId, setErrorId ] = useState(0);
    const [ isWrongPassword, setIsWrongPassword ] = useState(false);
    const isValid = syncServerHost.trim() !== "" && password !== "";

    useEffect(() => {
        // After a failed attempt the sync options are already stored in the partial DB
        // and exposed by setup/status — prefill so the user coming back from the failure
        // screen only has to correct what's wrong (the password is never stored). The
        // functional updates keep anything the user already typed.
        server.get<{ syncServerHost?: string; syncProxy?: string }>("setup/status").then((status) => {
            if (status.syncServerHost) {
                setSyncServerHost((current) => current || status.syncServerHost || "");
            }
            if (status.syncProxy) {
                setSyncProxy((current) => current || status.syncProxy || "");
            }
        }).catch(() => {
            // Prefill is best-effort only.
        });
    }, []);

    function raiseError(message: string) {
        setError(message);
        setErrorId(id => id + 1);
    }

    async function handleFinishSetup() {
        try {
            const resp = await server.post<SetupSyncFromServerResponse>("setup/sync-from-server", {
                syncServerHost: syncServerHost.trim().replace(/\/+$/, ""),
                syncProxy: syncProxy.trim(),
                password,
                // On mobile (Capacitor), don't pull blobs above the default limit — they blow the
                // WASM/native heap during sync. The server sends stubs instead; other platforms
                // send 0 (no limit).
                syncMaxBlobContentSize: isMobileApp() ? MOBILE_SYNC_MAX_BLOB_CONTENT_SIZE : 0
            });

            if (resp.result === "success") {
                setState("syncFromServerInProgress");
                return;
            }

            // A failure here is usually one the user can correct on this very form — a mistyped
            // host, a refused password — and the knowledge base is deliberately still there for
            // those. It is not for all of them: once the server has answered, the last step erases
            // before it builds, so a failure past that point leaves nothing behind the wizard. Only
            // the server knows which of the two happened, so it is asked rather than guessed at.
            await refreshExistingData();

            if (resp.error.includes("Incorrect password")) {
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

/**
 * Leaves setup and opens the database that was behind it all along.
 *
 * The way out of the backup screen, which is the one screen that changes nothing: the instance
 * comes back up on the same database it was asked to hold still. A failure here still ends in a
 * reload, because the marker that sent the instance to the wizard is consumed at start — so the
 * next start comes back to the application whatever this call did.
 */
async function onExistingDataKept() {
    try {
        await keepExistingData();
    } catch (e) {
        console.error("Could not leave setup cleanly; restarting anyway.", e);
    }

    onSetupFinished();
}

function onSetupFinished() {
    if (isElectron()) {
        // On Electron we need to use the setup route because it handles the closing of the setup window and opening the main app window.
        location.href = "setup";
    } else {
        location.reload();
    }
}

// index.ts holds the splash up until the page has rendered. The render under test imports
// the components directly, so it skips this one.
export const ready = import.meta.env.MODE !== "test" ? main() : Promise.resolve();

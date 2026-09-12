import "./setup_existing.css";

import type {
    SetupBackupDefaults,
    SetupBackupSettings,
    SetupExistingBackup,
    SetupExistingBackupStatus,
    SetupStatusResponse
} from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { isBackupDownloadSupported } from "./services/backup_download";
import { t } from "./services/i18n";
import open from "./services/open";
import server from "./services/server";
import { formatSize, isElectron } from "./services/utils";
import { BackupDownloadPanel, BackupParameters, useBackupDownload } from "./setup_backup";
import Admonition from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardSection, OptionCardSection } from "./widgets/react/Card";
import FormRadioGroup from "./widgets/react/FormRadioGroup";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";
import SlidePages from "./widgets/react/SlidePages";

/**
 * The offer to save the knowledge base that was already here.
 *
 * The wizard is normally the first thing an instance ever shows. When the app asks for it instead,
 * there is a database behind it, and most of what the menu offers will eventually replace it. So
 * this is the first screen, before the menu: the one chance to take a copy while the database is
 * open but nothing is running against it.
 *
 * Nothing here is destructive. The copy is taken or it is not, and either way the instance still
 * has everything it had; the erasure happens later, inside whichever path the user picks, and only
 * for the paths that create a database. Cancel, available on every screen, puts the instance back.
 *
 * @module
 */

/** What the user decided about a copy of the database that is already here. */
type Choice = "back-up" | "skip";

const CHOICES: { value: Choice; label: string }[] = [
    { value: "back-up", label: "setup.existing-data-back-up" },
    { value: "skip", label: "setup.existing-data-skip" }
];

/** The screens, in the order they can be reached, which is also the order they slide in. */
type Step = "choice" | "backup-parameters" | "backing-up" | "downloading" | "backed-up";
const STEP_ORDER: Step[] = [ "choice", "backup-parameters", "backing-up", "downloading", "backed-up" ];

/**
 * The whole question, as one step of the wizard.
 *
 * Owns its screens the way the restore flow owns its own: the wizard has one state for all of this,
 * and what the user has answered so far lives here rather than being spread through the wizard's own
 * state machine.
 *
 * @param onProceed the question has been answered; carry on to the menu. The knowledge base is still
 *                  there, and stays there until the user picks something that replaces it.
 * @param onKept the app is coming back; the wizard is over.
 */
export default function ExistingData({ onProceed, onKept }: { onProceed: () => void; onKept: () => void }) {
    const [ step, setStep ] = useState<Step>("choice");
    const [ backup, setBackup ] = useState<SetupExistingBackup | null>(null);
    const [ settings, setSettings ] = useState<SetupBackupSettings | null>(null);
    const [ defaults, setDefaults ] = useState<SetupBackupDefaults | null>(null);
    const [ error, setError ] = useState<string>();
    const [ errorId, setErrorId ] = useState(0);

    function raiseError(message: string) {
        setError(message);
        setErrorId((previous) => previous + 1);
    }

    /**
     * Asks what the backup should be before taking it, which every platform does.
     *
     * What can be asked differs: the standalone platform's backup is a download and has no format
     * to choose, while everywhere else the instance has settings of its own that the screen offers
     * back as its answers.
     */
    async function backUp() {
        if (!isBackupDownloadSupported()) {
            setDefaults(await getBackupDefaults());
        }

        setStep("backup-parameters");
    }

    /** Writes it where the platform keeps backups, which is everywhere but standalone. */
    async function runBackup(chosen: SetupBackupSettings) {
        setStep("backing-up");

        try {
            setBackup(await backUpExistingData(chosen));
            setStep("backed-up");
        } catch (e) {
            // Back to the question with nothing done: there is no continuing past a backup that was
            // asked for and did not happen.
            setStep("choice");
            raiseError(messageOf(e) ?? t("setup.existing-data-backup-failed"));
        }
    }

    async function keep() {
        try {
            await keepExistingData();
            onKept();
        } catch (e) {
            setStep("choice");
            raiseError(messageOf(e) ?? t("setup.existing-data-keep-failed"));
        }
    }

    return (
        <SlidePages current={step} order={STEP_ORDER}>
            {(shown) => (
                <>
                    {shown === "choice" && (
                        <ExistingDataChoice
                            error={error}
                            errorId={errorId}
                            onBackUp={() => void backUp()}
                            onSkip={onProceed}
                            onCancel={() => void keep()}
                        />
                    )}
                    {shown === "backup-parameters" && (
                        <BackupParameters
                            defaults={defaults}
                            onContinue={(chosen) => {
                                setSettings(chosen);

                                // Standalone streams the backup straight into a browser download:
                                // the browser's own storage may not have room for a second copy of
                                // the database, but the disk does. It is downloaded from its own
                                // button, so nothing lands in the downloads bar unannounced.
                                if (isBackupDownloadSupported()) {
                                    setStep("downloading");
                                } else {
                                    void runBackup(chosen);
                                }
                            }}
                            footer={<Button text={t("setup.existing-data-cancel")} onClick={() => void keep()} />}
                        />
                    )}
                    {shown === "backing-up" && <ExistingDataBackingUp />}
                    {shown === "downloading" && settings && (
                        <ExistingDataDownloading
                            settings={settings}
                            onContinue={onProceed}
                            onCancel={() => void keep()}
                        />
                    )}
                    {shown === "backed-up" && backup && (
                        <ExistingDataBackedUp
                            backup={backup}
                            onContinue={onProceed}
                            onCancel={() => void keep()}
                        />
                    )}
                </>
            )}
        </SlidePages>
    );
}

/**
 * Whatever the failure has to say for itself.
 *
 * A rejected request is not an `Error`: the client's own layer rejects with the response body as a
 * string, or with a bare word when the browser dropped the request. Taking only `Error` here left
 * every server-side failure showing the generic sentence and nothing else.
 */
function messageOf(e: unknown): string | undefined {
    if (e instanceof Error) {
        return e.message;
    }
    if (typeof e === "string" && e) {
        return messageOfBody(e);
    }
    if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") {
        return e.message;
    }

    return undefined;
}

/** The sentence out of a JSON error body, or the body itself where it is not one. */
function messageOfBody(body: string): string {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null && "message" in parsed
            && typeof parsed.message === "string") {
            return parsed.message;
        }
    } catch {
        // Not JSON, so it is already whatever the server had to say.
    }

    return body;
}

export function ExistingDataChoice({ error, errorId, onBackUp, onSkip, onCancel }: {
    error?: string;
    errorId?: number;
    onBackUp: () => void;
    onSkip: () => void;
    onCancel: () => void;
}) {
    const [ choice, setChoice ] = useState<Choice | null>(null);

    return (
        <SetupPage
            className="existing-data"
            // A question and nothing else: this is the one offer of a copy the user will get, and a
            // paragraph above it is the part someone in a hurry reads past.
            title={t("setup.existing-data")}
            illustration={<Icon icon="bx bx-data" className="illustration-icon" />}
            error={error}
            errorId={errorId}
            footer={
                <>
                    <Button text={t("setup.existing-data-cancel")} onClick={onCancel} />
                    <Button
                        text={t("setup.continue")}
                        kind="primary"
                        // Neither is chosen to begin with: a default would make the backup the
                        // answer of anyone who pressed on without reading, either way round.
                        disabled={choice === null}
                        onClick={() => (choice === "back-up" ? onBackUp() : onSkip())}
                    />
                </>
            }
        >
            <Card className="existing-data-choices">
                {/* A segment each, rather than two rows in one: this is the question the whole
                    screen is for. Which is checked is held here rather than by the browser's own
                    grouping, so the two stay exclusive. */}
                {CHOICES.map(({ value, label }) => (
                    // Going on without a copy is coloured as the app colours what cannot be taken
                    // back: nothing is erased by choosing it, but it is the answer that leaves the
                    // user with nothing to go back to once they pick a path from the menu after it.
                    <CardSection key={value} className={value === "skip" ? "existing-data-destructive" : undefined}>
                        <FormRadioGroup
                            name="existing-data-choice"
                            currentValue={choice ?? ""}
                            onChange={(chosen) => setChoice(chosen as Choice)}
                            values={[ { value, label: t(label) } ]}
                        />
                    </CardSection>
                ))}
            </Card>

            {choice === "skip" && (
                <Admonition type="note" className="existing-data-warning">
                    {t("setup.existing-data-skip-warning")}
                </Admonition>
            )}
        </SetupPage>
    );
}

/**
 * The wait while the backup is written, which for a large knowledge base is minutes.
 *
 * Asks how far along it is rather than only spinning: most of that time is spent inside a single
 * write, and a screen that says nothing for six minutes is indistinguishable from one that has
 * stopped. The number is polled because the answer is one number and this is the only thing asking.
 */
export function ExistingDataBackingUp() {
    const [ fraction, setFraction ] = useState<number | null>(null);

    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const { fraction } = await server.get<SetupExistingBackupStatus>("setup/existing/status");
                setFraction(fraction);
            } catch {
                // The backup is what matters here; a missed reading is worth nothing being said about.
            }
        }, PROGRESS_INTERVAL_MS);

        return () => clearInterval(interval);
    }, []);

    return (
        <SetupPage
            className="existing-data-backing-up top-aligned"
            title={t("setup.existing-data-backing-up")}
            illustration={<Icon icon="bx bx-archive-out" className="illustration-icon" />}
        >
            <div class="existing-data-progress">
                <div class="existing-data-progress-message">
                    {/* The spinner is what stands in for a bar until the writer has said anything.
                        Once the bar is there it has nothing left to add, and two things moving at
                        once only compete. */}
                    {fraction === null && <span class="spinner-border" role="status" aria-hidden="true" />}
                    <span>{t("setup.existing-data-backing-up-message")}</span>
                </div>

                {fraction !== null && (
                    <div class="existing-data-progress-bar">
                        <progress value={fraction} max={1} />
                        <span>{Math.floor(fraction * 100)}%</span>
                    </div>
                )}
            </div>
        </SetupPage>
    );
}

/** How often the screen asks how far along the backup is. */
const PROGRESS_INTERVAL_MS = 1000;

/**
 * The download step of the standalone platform, where the backup goes straight into a browser
 * download rather than into the browser's own storage.
 *
 * The download starts from its own button rather than on arrival, so nothing appears in the
 * downloads bar unannounced, and Continue stays disabled until the stream behind the download has
 * been fully produced — the closest thing to "finished" the application can see, with the
 * browser's own download UI carrying the transfer itself.
 */
export function ExistingDataDownloading({ settings, onContinue, onCancel }: {
    settings: SetupBackupSettings;
    onContinue: () => void;
    onCancel: () => void;
}) {
    const download = useBackupDownload(settings);

    return (
        <SetupPage
            className="existing-data-downloading top-aligned"
            title={t("setup.backup-data")}
            illustration={<Icon icon="bx bx-download" className="illustration-icon" />}
            footer={
                <>
                    <Button text={t("setup.existing-data-cancel")} onClick={onCancel} />
                    <Button
                        text={t("setup.continue")}
                        kind="primary"
                        disabled={download.state !== "done"}
                        onClick={onContinue}
                    />
                </>
            }
        >
            <BackupDownloadPanel download={download} />
        </SetupPage>
    );
}

/**
 * What was written, and where.
 *
 * The path is shown in full and not abbreviated: a custom backup directory is an option in a
 * database the user is on their way to replacing, so this may be the last time they can see where
 * their backup actually went.
 */
export function ExistingDataBackedUp({ backup, onContinue, onCancel }: {
    backup: SetupExistingBackup;
    onContinue: () => void;
    onCancel: () => void;
}) {
    return (
        <SetupPage
            className="existing-data-backed-up top-aligned"
            title={t("setup.existing-data-backed-up")}
            description={t("setup.existing-data-backed-up-description")}
            illustration={<Icon icon="bx bx-check-circle" className="illustration-icon" />}
            footer={
                <>
                    <Button text={t("setup.existing-data-cancel")} onClick={onCancel} />
                    <Button text={t("setup.continue")} kind="primary" onClick={onContinue} />
                </>
            }
        >
            <Card>
                <OptionCardSection label={t("setup.existing-data-file-name")}>
                    <span class="existing-data-file-name">{backup.fileName}</span>
                </OptionCardSection>

                <OptionCardSection label={t("setup.existing-data-file-path")}>
                    <BackupDirectory path={backup.directoryPath} />
                </OptionCardSection>

                <OptionCardSection label={t("setup.existing-data-file-size")}>
                    {formatSize(backup.fileSize)}
                </OptionCardSection>

                <CardSection className="existing-data-actions">
                    <Button
                        text={isElectron() ? t("setup.existing-data-save-as") : t("setup.existing-data-download")}
                        icon="bx bx-download"
                        onClick={() => downloadBackup(backup.filePath)}
                    />
                </CardSection>
            </Card>
        </SetupPage>
    );
}

/**
 * How long the backup is given before the client stops asking after it.
 *
 * The default minute is nothing next to what this takes: a large knowledge base is copied, and
 * compressed and encrypted where the instance is set up for that, which runs into minutes. Giving up
 * early would not stop any of it, only lose the answer and report a failure for something that was
 * still succeeding.
 */
const BACKUP_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Where the backup went, as something the user can act on.
 *
 * The directory rather than the whole path: the file name is on the line above, and what a user
 * wants from this line is to go and look. Only the desktop can open it, so everywhere else it stays
 * a plain, selectable line of text.
 */
function BackupDirectory({ path }: { path: string }) {
    if (!isElectron()) {
        return <span class="existing-data-path">{path}</span>;
    }

    return (
        <a
            class="existing-data-path existing-data-path-link"
            href="#"
            title={t("setup.existing-data-open-folder")}
            onClick={(e) => {
                e.preventDefault();
                void window.electronApi?.shell.openPath(path);
            }}
        >
            {path}
        </a>
    );
}

/** Saves a copy of the backup wherever the user says, through the platform's own download. */
function downloadBackup(filePath: string) {
    open.download(open.getUrlForDownload(
        `api/database/backup/download?filePath=${encodeURIComponent(filePath)}`));
}

/**
 * Backs the existing database up, answering with what was written.
 *
 * Started with one request and followed through the status endpoint rather than waited for on the
 * request itself: on the standalone platform a request rides the service worker, and the browser
 * reclaims a fetch held open for the minutes a large database needs. A poll that fails is retried
 * rather than believed, because the write blocks the standalone worker for long stretches in which
 * it answers nothing, and the backup is running all the while.
 */
export async function backUpExistingData(
    settings: SetupBackupSettings
): Promise<SetupExistingBackup> {
    await server.post("setup/existing/backup", settings);

    const deadline = Date.now() + BACKUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await sleep(PROGRESS_INTERVAL_MS);

        let status: SetupExistingBackupStatus;
        try {
            status = await server.get<SetupExistingBackupStatus>("setup/existing/status");
        } catch {
            continue;
        }

        if (status.state === "done" && status.result) {
            return status.result;
        }
        if (status.state === "failed") {
            throw new Error(status.error ?? t("setup.existing-data-backup-failed"));
        }
    }

    throw new Error(t("setup.existing-data-backup-failed"));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How this instance already backs up, which is what the screen offers as its answers.
 *
 * A failure here is not worth stopping a backup over: what is lost is a set of prefilled answers,
 * not the ability to give them, so the screen falls back to offering the plainest backup there is.
 */
export async function getBackupDefaults(): Promise<SetupBackupDefaults> {
    try {
        return await server.get<SetupBackupDefaults>("setup/existing/backup-defaults");
    } catch {
        return { storedPassphrase: false, encrypt: false, compress: false };
    }
}

/**
 * Erases it, which is the point of no return.
 *
 * Called from the wizard only where the erasure cannot ride along with the thing that replaces the
 * database: creating a document and syncing from a server both erase server-side as their first
 * step, but a database pushed by another desktop arrives on its own schedule, so that path has to
 * clear the way before it starts waiting.
 */
export async function deleteExistingData(): Promise<void> {
    await server.post("setup/existing/delete");
    // The wizard's own account of what is behind it, kept in step with what now is. Written back
    // onto the bootstrap's own answer rather than tracked beside it: the two can never disagree,
    // since the only erasure any of these screens can cause is the one just above.
    window.glob.hasExistingData = false;
}

/** Leaves it alone and opens it, which is what every Cancel in the wizard does. */
export function keepExistingData(): Promise<void> {
    return server.post("setup/existing/keep");
}

/**
 * Whether there is still a knowledge base behind the wizard.
 *
 * What the start of the wizard reported, until something here erases it. Not re-read from the
 * server: a reload would ask the server again anyway, and within one run of the wizard this is the
 * only thing that changes the answer.
 */
export function hasExistingData(): boolean {
    return window.glob.hasExistingData === true;
}

/**
 * Asks the server again, for the paths that erase without going through this page.
 *
 * Creating a document and syncing from a server both erase server-side, at the last moment before
 * the database that replaces this one is built. Where that replacement then fails, the wizard stays
 * open on a screen that came from a start which still believed there was something behind it — and
 * would go on offering a way back to it. Never throws: a wizard that cannot reach its own server has
 * a larger problem than a stale flag, and the screens read the flag while rendering.
 */
export async function refreshExistingData(): Promise<void> {
    try {
        const { hasExistingData } = await server.get<SetupStatusResponse>("setup/status");
        window.glob.hasExistingData = hasExistingData === true;
    } catch {
        // Left as it was, which is the answer the page already had.
    }
}

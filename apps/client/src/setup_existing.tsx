import "./setup_existing.css";

import type {
    SetupBackupDefaults,
    SetupBackupSettings,
    SetupExistingBackup,
    SetupExistingBackupStatus
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
import { Card, CardOption, CardSection } from "./widgets/react/Card";
import FormRadioGroup from "./widgets/react/FormRadioGroup";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";
import SlidePages from "./widgets/react/SlidePages";

/**
 * What happens to the knowledge base that was already here.
 *
 * The wizard is normally the first thing an instance ever shows. When the app asks for it instead,
 * there is a database behind it, and every path onwards from here replaces or erases that database.
 * So this is the first screen, before the menu, and nothing else can be reached until it is answered.
 *
 * Three screens, one question. The choice, the wait while a backup is written, and what was written.
 * Every one of them can be left through Cancel, which puts the instance back the way it was: nothing
 * is touched until the last Continue.
 *
 * @module
 */

/** What the user decided to do with the database that is already here. */
type Choice = "back-up" | "delete";

const CHOICES: { value: Choice; label: string }[] = [
    { value: "back-up", label: "setup.existing-data-back-up" },
    { value: "delete", label: "setup.existing-data-delete" }
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
 * @param onProceed the database is gone; carry on with the rest of setup.
 * @param onKept nothing was touched; the app is coming back.
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

    /** Erases the database and moves on, which is the one irreversible thing these screens do. */
    async function erase() {
        try {
            await deleteExistingData();
            onProceed();
        } catch (e) {
            setStep("choice");
            raiseError(messageOf(e) ?? t("setup.existing-data-delete-failed"));
        }
    }

    /**
     * The same, asked about first, for the screens reached by taking a backup.
     *
     * Those screens are about the copy that was just made, and the erasure is what Continue does
     * once the user is done reading about it — which is exactly the sort of thing a hand already
     * moving towards the button does not notice. The wizard has no dialog stack of its own, so this
     * is the browser's own, which is both unmissable and available on every platform.
     */
    async function confirmAndErase() {
        if (!window.confirm(t("setup.existing-data-erase-confirm"))) {
            return;
        }

        await erase();
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
                            onDelete={() => void erase()}
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
                            onContinue={() => void confirmAndErase()}
                            onCancel={() => void keep()}
                        />
                    )}
                    {shown === "backed-up" && backup && (
                        <ExistingDataBackedUp
                            backup={backup}
                            onContinue={() => void confirmAndErase()}
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

export function ExistingDataChoice({ error, errorId, onBackUp, onDelete, onCancel }: {
    error?: string;
    errorId?: number;
    onBackUp: () => void;
    onDelete: () => void;
    onCancel: () => void;
}) {
    const [ choice, setChoice ] = useState<Choice | null>(null);

    return (
        <SetupPage
            className="existing-data"
            // A question and nothing else: the answer decides whether a knowledge base survives,
            // and a paragraph above it is the part someone in a hurry reads past.
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
                        // Neither is chosen to begin with: one of them erases a knowledge base, and a
                        // default would make that the answer of anyone who pressed on without reading.
                        disabled={choice === null}
                        onClick={() => (choice === "back-up" ? onBackUp() : onDelete())}
                    />
                </>
            }
        >
            <Card className="existing-data-choices">
                {/* A segment each, rather than two rows in one: this is the question the whole screen
                    is for, and one of the answers erases a knowledge base. Which is checked is held
                    here rather than by the browser's own grouping, so the two stay exclusive. */}
                {CHOICES.map(({ value, label }) => (
                    // The answer that erases everything is coloured as such, so it is recognisable
                    // before it is read rather than after.
                    <CardSection key={value} className={value === "delete" ? "existing-data-destructive" : undefined}>
                        <FormRadioGroup
                            name="existing-data-choice"
                            currentValue={choice ?? ""}
                            onChange={(chosen) => setChoice(chosen as Choice)}
                            values={[ { value, label: t(label) } ]}
                        />
                    </CardSection>
                ))}
            </Card>

            {choice === "delete" && (
                <Admonition type="caution" className="existing-data-warning">
                    {t("setup.existing-data-delete-warning")}
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
 * What was written, before the database it was written from is erased.
 *
 * The path is shown in full and not abbreviated: a custom backup directory is an option in a
 * database that is about to stop existing, so this may be the last time the user can see where their
 * backup actually went.
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
                <CardOption label={t("setup.existing-data-file-name")}>
                    <span class="existing-data-file-name">{backup.fileName}</span>
                </CardOption>

                <CardOption label={t("setup.existing-data-file-path")}>
                    <BackupDirectory path={backup.directoryPath} />
                </CardOption>

                <CardOption label={t("setup.existing-data-file-size")}>
                    {formatSize(backup.fileSize)}
                </CardOption>

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

/** Erases it, which is the point of no return. */
export function deleteExistingData(): Promise<void> {
    return server.post("setup/existing/delete");
}

/** Leaves it alone and opens it, which is what every Cancel on these screens does. */
export function keepExistingData(): Promise<void> {
    return server.post("setup/existing/keep");
}

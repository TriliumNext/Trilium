import "./setup_restore.css";

import type { DatabaseBackup, ExistingBackupsResponse } from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { ChunkedUploadError, uploadInChunks } from "./services/chunked_upload";
import { describeDatabaseFile, describeDatabaseFormat } from "./services/database_files";
import { t } from "./services/i18n";
import server from "./services/server";
import { formatSize } from "./services/utils";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import DatabaseFileBadges from "./widgets/react/DatabaseFileBadges";
import FormGroup from "./widgets/react/FormGroup";
import FormTextBox from "./widgets/react/FormTextBox";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";
import SlidePages from "./widgets/react/SlidePages";

/**
 * The setup screen's "restore from backup" path, from picking a backup to the restored database
 * being open.
 *
 * One component rather than three wizard states, because the steps are one decision followed by its
 * consequences: which backup, the passphrase it turns out to need, and then waiting. Going back from
 * the passphrase means picking again, which is what the wizard's own back button already means.
 *
 * @module
 */

/** What the restore is waiting on, as far as this screen is concerned. */
type Step = "picking" | "uploading" | "passphrase" | "restoring";

/**
 * Where "Back" goes from each step. A step with no entry here leaves the restore flow altogether,
 * which is what the first one does and what any later step does if it has nothing to return to.
 */
const PREVIOUS_STEP: Partial<Record<Step, Step>> = {
    uploading: "picking",
    passphrase: "picking"
};

/** The steps in the order they are reached, which is what decides the way a slide goes. */
const STEP_ORDER: Step[] = [ "picking", "uploading", "passphrase", "restoring" ];

/** Failures the same backup can still get past, which send the user back to the passphrase rather than to the start. */
const PASSPHRASE_FAILURES = new Set([ "passphrase-required", "wrong-passphrase-or-damaged-header" ]);

export default function RestoreFromBackup({ onBack, onRestored }: {
    /**
     * Leaves the restore for the step of the wizard that led here. Omitted where nothing did: an
     * instance sent straight to this screen by a marker has no earlier step to be shown, so the
     * first step of the restore has nowhere to go back to and offers no way.
     */
    onBack?: () => void;
    onRestored: () => void;
}) {
    const [ step, setStep ] = useState<Step>("picking");
    const [ selection, setSelection ] = useState<Selection | null>(null);
    const [ upload, setUpload ] = useState<UploadState | null>(null);
    const [ error, setError ] = useState<ComponentChildren>(null);
    const [ errorId, setErrorId ] = useState(0);
    const [ wrongPassphrase, setWrongPassphrase ] = useState(false);
    /** Stops the upload in flight, for the one thing that can interrupt it: the user going back. */
    const uploadCancellation = useRef<AbortController | null>(null);
    /**
     * The file a standalone restore is working from, kept so a wrong passphrase can be answered
     * without picking it again. It is a reference to bytes the browser already has, not a copy.
     */
    const localBackup = useRef<File | null>(null);
    /** Where a standalone restore has got to, which it reports rather than being polled for. */
    const [ localProgress, setLocalProgress ] = useState<RestoreStatus | null>(null);
    /**
     * Fetched here rather than by the step that lists them, which is mounted afresh every time it is
     * returned to: asking again would show "looking for backups" for the length of each slide back.
     */
    const [ backups, setBackups ] = useState<DatabaseBackup[] | null>(null);

    useEffect(() => {
        // Standalone keeps no backups worth offering: nothing takes them on a schedule there, and a
        // copy kept beside the database in the browser's own storage is cleared along with it.
        if (window.standaloneApi) {
            setBackups([]);
            return;
        }

        server.get<ExistingBackupsResponse>("database/backups")
            .then((response) => setBackups(response.backups))
            // An unreadable backup directory is not a reason to lose the way in from a file.
            .catch(() => setBackups([]));
    }, []);

    const raiseError = useCallback((headline: string, detail?: string) => {
        setError(<Failure headline={headline} detail={detail} />);
        setErrorId((id) => id + 1);
    }, []);

    /** Sends the restore on its way, or asks for the passphrase first where the backup needs one. */
    const restore = useCallback(async (picked: Selection, passphrase?: string) => {
        setSelection(picked);

        if (picked.encrypted && !passphrase) {
            setStep("passphrase");
            return;
        }

        try {
            await server.post("setup/restore/start", {
                source: picked.source,
                filePath: picked.filePath,
                passphrase
            });
            setStep("restoring");
        } catch (e) {
            setStep("picking");
            raiseError(t("setup.restore-error-could-not-start"), detailOf(e));
        }
    }, [ raiseError ]);

    /**
     * Restores a picked file through the standalone build's own way to the worker that owns the
     * database, which is already on this device: there is nothing to upload, and the request path
     * would serialise the whole database and give up on it besides.
     */
    async function restoreLocally(file: File, passphrase?: string) {
        setSelection({ source: "pending", fileName: file.name });
        localBackup.current = file;
        setStep("restoring");

        const result = await window.standaloneApi?.restore.importBackup({
            backup: file,
            passphrase,
            onProgress: ({ stage, fraction }) => setLocalProgress({ stage, fraction })
        });

        if (result?.status === "restored") {
            onRestored();
        } else if (result?.status === "needs-passphrase") {
            setStep("passphrase");
        } else {
            setStep("picking");
            raiseError(headlineFor(result?.reason), result?.message);
        }
    }

    async function uploadAndRestore(file: File) {
        if (window.standaloneApi) {
            await restoreLocally(file);
            return;
        }

        const cancellation = new AbortController();
        uploadCancellation.current = cancellation;

        setStep("uploading");
        setUpload({ sentBytes: 0, totalBytes: file.size, fraction: 0, bytesPerSecond: 0, reconnecting: false });

        try {
            const uploaded = await uploadInChunks<{ fileName: string; encrypted: boolean }>({
                endpoint: "setup/restore/upload",
                blob: file,
                fileName: file.name,
                signal: cancellation.signal,
                onProgress: ({ sentBytes, totalBytes, fraction, bytesPerSecond, reconnecting }) =>
                    setUpload({ sentBytes, totalBytes, fraction, bytesPerSecond, reconnecting })
            });

            await restore({ source: "pending", fileName: uploaded.fileName, encrypted: uploaded.encrypted });
        } catch (e) {
            setStep("picking");

            // An upload the user walked away from ends in a failure they chose, and being told
            // about it would read as something having gone wrong.
            if (!cancellation.signal.aborted) {
                raiseError(uploadFailureHeadline(e), detailOf(e));
            }
        } finally {
            uploadCancellation.current = null;
        }
    }

    /**
     * Goes back a step, or out of the restore altogether from the step that has nothing before it.
     *
     * An upload in flight is stopped on the way: left running it would finish in the background and
     * pull the user forward into the restore they had just walked away from.
     */
    function goBack() {
        uploadCancellation.current?.abort();
        // Belongs to the attempt being left behind, not to the next one.
        setWrongPassphrase(false);

        const previous = PREVIOUS_STEP[step];
        if (previous) {
            setStep(previous);
        } else {
            onBack?.();
        }
    }

    /**
     * Whether there is anywhere to go back to: an earlier step of the restore, or the step of the
     * wizard that led into it. The replacement itself has neither, and cannot be interrupted anyway.
     */
    const canGoBack = step !== "restoring" && (!!PREVIOUS_STEP[step] || !!onBack);

    function onRestoreFailed(failure: { error?: string; reason?: string }) {
        if (failure.reason && PASSPHRASE_FAILURES.has(failure.reason)) {
            // The backup is still on the server, so only the passphrase has to be given again.
            setWrongPassphrase(true);
            setStep("passphrase");
            return;
        }

        setStep("picking");
        raiseError(headlineFor(failure.reason), failure.error);
    }

    return (
        <SetupPage
            className="restore-from-backup top-aligned"
            title={t("setup.restore-from-backup")}
            description={step === "picking" ? t("setup.restore-from-backup-page-description") : undefined}
            illustration={<Icon icon="bx bx-archive-in" className="illustration-icon" />}
            error={error}
            errorId={errorId}
            // Offered only where there is somewhere to go: not once the database is being replaced,
            // and not from the first step of a restore that is the whole of what the wizard was
            // opened for.
            onBack={canGoBack ? goBack : undefined}
        >
            {/* In the flow rather than filling the page: each step is a different height, and the
                one arriving is what the page should be as tall as. */}
            <SlidePages current={step} order={STEP_ORDER} inFlow>
                {(shown) => (
                    <>
                        {shown === "picking" && (
                            <PickBackup backups={backups} onPick={restore} onUpload={uploadAndRestore} onFailure={raiseError} />
                        )}
                        {shown === "uploading" && upload && <UploadProgress upload={upload} />}
                        {shown === "passphrase" && selection && (
                            <AskPassphrase
                                wrong={wrongPassphrase}
                                onSubmit={(passphrase) => {
                                    setWrongPassphrase(false);

                                    // Standalone still has the file it was given, so answering the
                                    // prompt starts again from it rather than from a server's copy.
                                    const backup = localBackup.current;
                                    void (backup ? restoreLocally(backup, passphrase) : restore(selection, passphrase));
                                }}
                            />
                        )}
                        {shown === "restoring" && (
                            <RestoreProgress
                                reported={localProgress}
                                onRestored={onRestored}
                                onFailed={onRestoreFailed}
                            />
                        )}
                    </>
                )}
            </SlidePages>
        </SetupPage>
    );
}

/**
 * A failure as the user needs it: what went wrong in a sentence about backups, with the technical
 * detail kept underneath.
 *
 * The detail is not dropped, because it is what a bug report is made of and what tells two identical-
 * looking failures apart. It is just no longer the whole message: "The file is not a SQLite database"
 * answers a question nobody standing in front of this screen asked.
 */
function Failure({ headline, detail }: { headline: string; detail?: string }) {
    return (
        <>
            <span class="restore-error-headline">{headline}</span>
            {detail && <small class="restore-error-detail selectable-text">{detail}</small>}
        </>
    );
}

/**
 * The sentence for an upload that did not finish.
 *
 * A connection that goes away is waited out rather than reported, so an upload only fails here once
 * there is nothing left to wait for. The two endings differ in what the user should do next: an
 * upload the server no longer holds has to be started again, while anything else is a reason it
 * refused, and telling them to try again would be telling them to repeat it.
 */
function uploadFailureHeadline(e: unknown): string {
    const gone = e instanceof ChunkedUploadError && (e.status === 404 || e.status === 410);

    return gone ? t("setup.restore-error-upload-interrupted") : t("setup.restore-error-upload-failed");
}

/** What a thrown failure has to say for itself, for the detail line under the headline. */
function detailOf(e: unknown): string | undefined {
    const message = e instanceof Error ? e.message : String(e);

    return message || undefined;
}

/**
 * The sentence for a failure, chosen from the reason the server reported rather than from its
 * message, which is fixed English meant for the log.
 *
 * Most of the reasons say the same thing to a user: the file cannot be used. The ones listed here are
 * the ones where that would be misleading, because something other than the backup is at fault or
 * because there is something the user could go and do about it.
 */
function headlineFor(reason: string | undefined): string {
    switch (reason) {
        case "database-too-new": return t("setup.restore-error-too-new");
        case "database-too-old": return t("setup.restore-error-too-old");
        case "database-not-initialized": return t("setup.restore-error-unfinished");
        case "swap-failed": return t("setup.restore-error-swap-failed");
        case "migration-failed": return t("setup.restore-error-would-not-open");
        case "restore-refused": return t("setup.restore-error-refused");
        case "already-initialized": return t("setup.restore-error-already-initialized");
        default: return t("setup.restore-error-unusable");
    }
}

/** Which backup is being restored, and where it is. */
interface Selection {
    /** `existing` names a backup on this device; `pending` is one the server already holds. */
    source: "pending" | "existing";
    fileName: string;
    /** Only for a backup already on the server. */
    filePath?: string;
    encrypted?: boolean;
}

interface UploadState {
    sentBytes: number;
    totalBytes: number;
    fraction: number;
    /** Averaged over the transfer so far, so it settles rather than jumping about between pieces. */
    bytesPerSecond: number;
    /** Whether the upload is waiting on a connection that has gone away. */
    reconnecting: boolean;
}

/** The backups already here, and the way to a file that is not. */
function PickBackup({ backups, onPick, onUpload, onFailure }: {
    /** What was found, or `null` while that is still being asked. */
    backups: DatabaseBackup[] | null;
    onPick: (selection: Selection) => void;
    onUpload: (file: File) => void;
    onFailure: (headline: string, detail?: string) => void;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    // The desktop can read the file where it lies; a browser has to be handed it first.
    const nativePicker = window.electronApi?.restore;

    async function pickNatively() {
        const picked = await nativePicker?.pickBackup();
        if (!picked || picked.status === "cancelled") {
            return;
        }
        if (picked.status === "error" || !picked.fileName) {
            onFailure(t("setup.restore-error-could-not-start"), picked.message);
            return;
        }

        // Already waiting on the other side of the bridge, so this goes straight to restoring it.
        onPick({ source: "pending", fileName: picked.fileName, encrypted: picked.encrypted });
    }

    const sorted = [ ...(backups ?? []) ].sort((a, b) => (a.mtime < b.mtime ? 1 : -1));

    return (
        <>
            {/* A row rather than a section of its own: choosing a file and choosing one of the
                backups already here are the same decision, so they read as one list of ways in. */}
            <Card>
                <CardSection
                    className="restore-backup-row restore-choose-file"
                    onAction={nativePicker ? pickNatively : () => fileInput.current?.click()}
                >
                    <Icon icon="bx bx-folder-open" />

                    <div class="restore-backup-details">
                        <div class="restore-backup-name">{t("setup.restore-choose-file")}</div>
                        {/* One line for both ways in: selecting the file is the same act whether it
                            is then uploaded or read where it lies. */}
                        <div class="restore-backup-description">{t("setup.restore-choose-file-description")}</div>
                    </div>

                    <Icon icon="bx bx-chevron-right" />
                </CardSection>

                {/* Outside the row it belongs to: a hidden input inside it would have its own click
                    bubble back to the row that opened it, and open it again. */}
                {!nativePicker && (
                    <input
                        ref={fileInput}
                        type="file"
                        accept=".db,.tnbackup"
                        class="restore-file-input"
                        onChange={(e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file) {
                                onUpload(file);
                            }
                        }}
                    />
                )}
            </Card>

            {/* Absent until there is something to list, which on a device being set up for the first
                time is the usual case: an empty card would only take up the screen to say that a
                place the user has never been to holds nothing. */}
            {backups === null ? (
                <Card heading={t("setup.restore-existing-backups")}>
                    <CardSection className="restore-loading">
                        <Icon icon="bx bx-loader-circle bx-spin" /> {t("setup.restore-looking-for-backups")}
                    </CardSection>
                </Card>
            ) : sorted.length > 0 && (
                <Card heading={t("setup.restore-existing-backups")}>
                    {sorted.map((backup) => (
                        <CardSection
                            key={backup.filePath}
                            className="restore-backup-row"
                            onAction={() => onPick({
                                source: "existing",
                                fileName: backup.fileName,
                                filePath: backup.filePath,
                                encrypted: backup.encrypted
                            })}
                        >
                            <Icon icon={backup.encrypted ? "bx bx-lock-alt" : "bx bx-data"} />

                            <div class="restore-backup-details">
                                <div class="restore-backup-title">
                                    <span class="restore-backup-name">{backup.fileName}</span>
                                    <DatabaseFileBadges badges={describeDatabaseFormat(backup)} />
                                </div>

                                <div class="restore-backup-description">{describeDatabaseFile(backup)}</div>
                            </div>

                            <Icon icon="bx bx-chevron-right" />
                        </CardSection>
                    ))}
                </Card>
            )}
        </>
    );
}

function UploadProgress({ upload }: { upload: UploadState }) {
    return (
        <Card className="restore-progress">
            <CardSection>
                <div class="restore-progress-label">
                    <Icon icon="bx bx-loader-circle bx-spin" /> {t("setup.restore-uploading")}
                </div>

                <progress value={upload.sentBytes} max={upload.totalBytes} />

                <div class="restore-progress-detail">
                    <span>
                        {t("setup.restore-uploaded-so-far", {
                            sent: formatSize(upload.sentBytes),
                            total: formatSize(upload.totalBytes)
                        })}
                    </span>

                    {/* In place of the speed while the connection is gone, which is where the eye
                        already is and where a rate averaged over a transfer that has stopped would
                        otherwise sit unchanged, saying everything is fine. */}
                    {upload.reconnecting ? (
                        <span class="restore-upload-reconnecting">
                            <Icon icon="bx bx-wifi-off" /> {t("setup.restore-upload-reconnecting")}
                        </span>
                    ) : (
                        // Only once something has actually gone out: before the first piece lands
                        // there is no elapsed time to divide by, and a rate of nothing says nothing.
                        upload.bytesPerSecond > 0 && (
                            <span class="restore-upload-speed">
                                {t("setup.restore-upload-speed", { speed: formatSize(upload.bytesPerSecond) })}
                            </span>
                        )
                    )}
                </div>
            </CardSection>
        </Card>
    );
}

function AskPassphrase({ wrong, onSubmit }: { wrong: boolean; onSubmit: (passphrase: string) => void }) {
    const [ passphrase, setPassphrase ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    // Without `preventScroll` the browser scrolls the page to reveal a field that is still sliding
    // in from off-screen, which drags the heading along with it and fights the animation the whole
    // way. The field is about to be in view on its own.
    useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

    return (
        <form onSubmit={(e) => {
            e.preventDefault();
            if (passphrase) {
                onSubmit(passphrase);
            }
        }}>
            <Card>
                <CardSection className="restore-passphrase">
                    <FormGroup
                        name="backupPassphrase"
                        label={t("setup.restore-passphrase")}
                        description={t("setup.restore-passphrase-description")}
                        error={wrong ? t("setup.restore-wrong-passphrase") : undefined}
                    >
                        <FormTextBox
                            inputRef={inputRef}
                            type="password"
                            currentValue={passphrase}
                            onChange={setPassphrase}
                            autocomplete="off"
                        />
                    </FormGroup>
                </CardSection>
            </Card>

            <div class="restore-passphrase-actions">
                <Button kind="primary" text={t("setup.restore-continue")} disabled={!passphrase} />
            </div>
        </form>
    );
}

/** What the server says about the restore it is running. */
interface RestoreStatus {
    stage: string;
    /** How far through the current stage, where that stage can say; absent where it cannot. */
    fraction?: number;
    error?: string;
    reason?: string;
}

function RestoreProgress({ reported, onRestored, onFailed }: {
    /** Where the restore has got to, where it says so itself; polled when it does not. */
    reported?: RestoreStatus | null;
    onRestored: () => void;
    onFailed: (failure: { error?: string; reason?: string }) => void;
}) {
    const [ stage, setStage ] = useState<string>("staging");
    const [ fraction, setFraction ] = useState<number | null>(null);
    const polled = !reported;

    useEffect(() => {
        // A restore that reports itself is already telling this component everything it knows, and
        // there is nothing on the other end to ask besides.
        if (!polled) {
            return;
        }

        const interval = setInterval(async () => {
            let restore;
            try {
                ({ restore } = await server.get<{ restore: RestoreStatus | null }>("setup/restore/status"));
            } catch {
                // The database is detached for the moment it takes to exchange the files, which any
                // request landing in that moment cannot be answered through. The next one can.
                return;
            }

            if (!restore) {
                return;
            }
            if (restore.stage === "done") {
                clearInterval(interval);
                onRestored();
                return;
            }
            if (restore.stage === "failed") {
                clearInterval(interval);
                onFailed(restore);
                return;
            }

            setStage(restore.stage);
            setFraction(restore.fraction ?? null);
        }, 1000);

        return () => clearInterval(interval);
    }, [ polled, onRestored, onFailed ]);

    const shownStage = reported?.stage ?? stage;
    const shownFraction = (reported ? reported.fraction : fraction) ?? null;

    // Only what is happening now, rather than the four steps as a list. Preparing the backup is the
    // one that takes any time; the rest go by too quickly to be read, so a list of them mostly shows
    // the user three things they will never see happen.
    return (
        <div class="restore-current-step">
            <div class="restore-step-name">{t(`setup.restore-stage-${shownStage}`)}</div>

            {/* Only where the step can say how far it has got. The ones that cannot show nothing,
                rather than an empty bar that never moves. */}
            {shownFraction !== null && (
                <div class="restore-stage-progress">
                    <progress value={shownFraction} max={1} />
                    <span>{Math.floor(shownFraction * 100)}%</span>
                </div>
            )}

            <small class="restore-do-not-close">{t("setup.restore-do-not-close")}</small>
        </div>
    );
}

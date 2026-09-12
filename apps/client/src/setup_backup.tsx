import "./setup_backup.css";

import {
    defaultBackupName,
    type SetupBackupDefaults,
    type SetupBackupSettings
} from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";

import { backupFileName, startBackupDownload } from "./services/backup_download";
import { t } from "./services/i18n";
import { formatSize } from "./services/utils";
import Admonition from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardSection, OptionCardSection } from "./widgets/react/Card";
import FilesystemFriendlyName from "./widgets/react/FilesystemFriendlyName";
import FormGroup from "./widgets/react/FormGroup";
import FormPasswordWithConfirmation from "./widgets/react/FormPasswordWithConfirmation";
import FormToggle from "./widgets/react/FormToggle";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";

/**
 * Backing up by download, which on the standalone platform happens here rather than while the
 * application runs.
 *
 * A backup is streamed off the database page by page and takes minutes on a large one. Nothing may
 * write to the database in between, or the pages would come from two different versions of it — and
 * a running Trilium writes constantly. So the application restarts into setup, where the database is
 * open but nothing is loaded against it: no becca, no sync, no migration. This screen is what it
 * restarts into, and leaving it puts the application back the way it was.
 *
 * @module
 */

/** Where the download stands, and the one thing that can be done about it. */
export interface BackupDownload {
    fileName: string;
    state: "idle" | "running" | "done" | "failed";
    /** What stopped it, once `failed`. */
    error?: string;
    /** How far it has got, once the first bytes have gone. */
    progress?: { sentBytes: number; totalBytes: number };
    start: () => void;
}

/**
 * Owns a download of the file `settings` describes.
 *
 * Only the name and the password are of any use here: the standalone platform produces its backup
 * by streaming the live database into a download, and compressing that stream is more than the
 * low-end devices it exists for can afford, so there is nothing for it to read a compression answer
 * out of. Nor is there a stored passphrase anywhere in a browser to be asked for.
 */
export function useBackupDownload(settings: SetupBackupSettings): BackupDownload {
    const fileName = useMemo(() => backupFileName(settings.name), [ settings.name ]);
    const [ state, setState ] = useState<BackupDownload["state"]>("idle");
    const [ error, setError ] = useState<string>();
    const [ progress, setProgress ] = useState<BackupDownload["progress"]>();

    return {
        fileName,
        state,
        error,
        progress,
        start: () => {
            setState("running");
            setError(undefined);
            setProgress(undefined);

            const onProgress = (sentBytes: number, totalBytes: number) =>
                setProgress({ sentBytes, totalBytes });

            void startBackupDownload(fileName, settings.passphrase, onProgress).then((result) => {
                setState(result.status === "done" ? "done" : "failed");
                setError(result.status === "done" ? undefined : result.message);
            });
        }
    };
}

/**
 * What the backup is called, whether it is locked and whether it is compressed, asked before it is
 * taken.
 *
 * The name matters more than it looks: a downloads folder two months from now is a list of
 * near-identical dated files, and the one thing that tells the user why they made this one is what
 * they called it. It is prefilled so that answering nothing is a perfectly good answer, and so is
 * everything else here: a user who has already set up how this instance backs up is shown those
 * answers rather than asked to make them again.
 *
 * @param defaults how this instance already backs up, or `null` where none of it is up for
 *                 discussion — the standalone platform writes its backup by streaming it into a
 *                 download, which can be neither compressed nor locked with a stored passphrase.
 * @param onContinue the settings to back up under; the screen after this one does the work.
 */
export function BackupParameters({ defaults, onContinue, footer }: {
    defaults: SetupBackupDefaults | null;
    onContinue: (settings: SetupBackupSettings) => void;
    /** What sits beside Continue, which differs by the flow this screen was reached through. */
    footer?: ComponentChildren;
}) {
    const [ name, setName ] = useState(() => defaultBackupName(new Date()));
    // Null while the two password fields disagree, which is the one state Continue must not accept:
    // a half-typed password would otherwise be dropped and the backup written unlocked.
    const [ passphrase, setPassphrase ] = useState<string | null>("");
    const [ useStoredPassphrase, setUseStoredPassphrase ] = useState(
        () => !!defaults?.storedPassphrase && defaults.encrypt);
    const [ compress, setCompress ] = useState(() => !!defaults?.compress);

    return (
        <SetupPage
            className="setup-backup-parameters top-aligned"
            title={t("setup.backup-data")}
            illustration={<Icon icon="bx bx-archive-out" className="illustration-icon" />}
            footer={
                <>
                    {footer}
                    <Button
                        text={t("setup.continue")}
                        kind="primary"
                        disabled={passphrase === null}
                        onClick={() => onContinue({
                            name,
                            passphrase: passphrase ?? "",
                            useStoredPassphrase,
                            compress
                        })}
                    />
                </>
            }
        >
            <form>
                <Card>
                    <CardSection>
                        <FormGroup
                            name="backupName"
                            label={t("setup.backup-name")}
                            description={t("setup.backup-name-description")}
                        >
                            {/* Filtered as it is typed rather than refused afterwards: what it
                                drops are characters no filesystem would have taken anyway. */}
                            <FilesystemFriendlyName currentValue={name} onChange={setName} />
                        </FormGroup>
                    </CardSection>

                    {/* Directly above the fields it replaces, because that is the whole of what it
                        does: the stored passphrase cannot be shown, so choosing it is the only way
                        to ask for the password the user has already set up. */}
                    {defaults?.storedPassphrase && (
                        <OptionCardSection
                            name="backup-use-stored-password"
                            label={t("setup.backup-use-stored-password")}
                            description={t("setup.backup-use-stored-password-description")}
                        >
                            <FormToggle
                                currentValue={useStoredPassphrase}
                                onChange={(enabled) => {
                                    setUseStoredPassphrase(enabled);
                                    // The fields leave with it, and a pair that is gone reports
                                    // nothing: a password left half-typed in them would otherwise
                                    // go on holding Continue disabled from a segment nobody can
                                    // see, with nothing on screen to explain it.
                                    if (enabled) {
                                        setPassphrase("");
                                    }
                                }}
                            />
                        </OptionCardSection>
                    )}

                    {!useStoredPassphrase && (
                        <CardSection>
                            <FormPasswordWithConfirmation
                                optional
                                label={t("setup.backup-password")}
                                confirmationLabel={t("setup.backup-password-repeat")}
                                onChange={setPassphrase}
                            />
                            <small class="form-text">{t("setup.backup-password-description")}</small>
                        </CardSection>
                    )}

                    {defaults && (
                        <OptionCardSection
                            name="backup-compress"
                            label={t("setup.backup-compress")}
                            description={t("setup.backup-compress-description")}
                        >
                            <FormToggle currentValue={compress} onChange={setCompress} />
                        </OptionCardSection>
                    )}
                </Card>
            </form>
        </SetupPage>
    );
}

/**
 * The download itself: the button that starts it and what became of it.
 *
 * Shared by the two screens that offer one, so a backup taken before a restore and a backup taken
 * for its own sake are the same thing to a user.
 */
export function BackupDownloadPanel({ download }: { download: BackupDownload }) {
    // A download in flight takes the screen over: the file it is writing is named in the browser's
    // own downloads, and offering the button again while it runs only invites a second copy of a
    // download the user has just been asked not to disturb.
    if (download.state === "running") {
        return (
            <div class="backup-download">
                {/* The count sits with the spinner rather than apart from it: on a phone the
                    browser's own download UI is behind the notification shade, so this is the only
                    sign the application is doing anything, and a spinner alone reads as stuck. */}
                <div class="backup-download-status">
                    <span class="spinner-border" role="status" aria-hidden="true" />
                    <div class="backup-download-text">
                        <span>{t("setup.backup-downloading")}</span>
                        <DownloadProgress progress={download.progress} />
                    </div>
                </div>
                <div class="backup-download-hint">{t("setup.backup-do-not-close")}</div>
            </div>
        );
    }

    return (
        <div class="backup-download">
            {/* What became of the last attempt comes first: it is the answer to the button below
                it, and the button is what the user does next either way. */}
            {download.state === "done" && (
                <Admonition type="note" className="backup-download-outcome">
                    {t("setup.backup-downloaded")}
                </Admonition>
            )}
            {download.state === "failed" && (
                <Admonition type="warning" className="backup-download-outcome">
                    {download.error ?? t("setup.backup-download-failed")}
                </Admonition>
            )}

            <div class="backup-download-file">
                {t("setup.backup-file")} <strong>{download.fileName}</strong>
            </div>

            <Button
                text={t("setup.backup-download")}
                icon="bx bx-download"
                kind="primary"
                onClick={download.start}
            />
        </div>
    );
}

/**
 * How much of the download has gone, in the two forms a waiting user reads differently: the
 * percentage answers "how much longer", the sizes answer "is it moving at all".
 *
 * Absent until the first bytes are handed over, since a total of nothing has no percentage and
 * "0 B of 0 B" says less than the spinner does on its own.
 */
function DownloadProgress({ progress }: { progress?: BackupDownload["progress"] }) {
    if (!progress || progress.totalBytes <= 0) {
        return null;
    }

    return (
        <div class="backup-download-progress">
            {/* Its own element so a width can be held for it: the count grows from one digit to
                three, and without that the sizes beside it would be shoved along twice. */}
            <span class="backup-download-percent">
                {t("setup.backup-downloading-percent", {
                    // Rounded down, so it never reads 100% while there is still something to write.
                    percent: Math.floor(100 * progress.sentBytes / progress.totalBytes)
                })}
            </span>
            <span>
                {/* Fixed places, since these are still counting: dropping a trailing zero would
                    shorten the line on every other update. */}
                {t("setup.backup-downloading-size", {
                    done: formatSize(progress.sentBytes, 2),
                    total: formatSize(progress.totalBytes, 2)
                })}
            </span>
        </div>
    );
}

/**
 * Taking the backup, once its settings are known.
 *
 * Split from the parameters screen so that the download owns a settled name and password: a hook
 * cannot be told to forget what it started, and this component only exists once there is nothing
 * left to change.
 *
 * @param onDone the backup is over, one way or another; leave the wizard.
 */
export function BackupDownloadStep({ settings, onDone }: {
    settings: SetupBackupSettings;
    onDone: () => void;
}) {
    const download = useBackupDownload(settings);

    return (
        <SetupPage
            className="setup-backup-database top-aligned"
            title={t("setup.backup-data")}
            description={t("setup.backup-data-description")}
            illustration={<Icon icon="bx bx-archive-out" className="illustration-icon" />}
            footer={
                <Button
                    text={t("setup.backup-finish")}
                    kind="primary"
                    disabled={download.state === "running"}
                    onClick={onDone}
                />
            }
        >
            <BackupDownloadPanel download={download} />
        </SetupPage>
    );
}

/**
 * The whole of the wizard, when the wizard was opened to take a backup and nothing else.
 *
 * Unlike every other screen here, this one leads nowhere: there is no next step, because the
 * database it was opened over is the one the application is going back to. Leaving is available
 * throughout, so a user who changes their mind is not trapped on a screen that only exists to
 * offer them something.
 *
 * @param onDone leave setup and open the database that was there all along.
 */
export default function SetupBackupDatabase({ onDone }: { onDone: () => void }) {
    const [ settings, setSettings ] = useState<SetupBackupSettings | null>(null);

    if (!settings) {
        return (
            <BackupParameters
                // This screen is the standalone platform's, and its backup is a download: there is
                // no instance-wide format for it to follow and nothing stored to lock it with.
                defaults={null}
                onContinue={setSettings}
                footer={<Button text={t("setup.backup-finish")} onClick={onDone} />}
            />
        );
    }

    return <BackupDownloadStep settings={settings} onDone={onDone} />;
}

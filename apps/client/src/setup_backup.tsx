import "./setup_backup.css";

import { defaultBackupName } from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";

import { backupFileName, startBackupDownload } from "./services/backup_download";
import { t } from "./services/i18n";
import Admonition from "./widgets/react/Admonition";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import FilesystemFriendlyName from "./widgets/react/FilesystemFriendlyName";
import FormGroup from "./widgets/react/FormGroup";
import FormPasswordWithConfirmation from "./widgets/react/FormPasswordWithConfirmation";
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

/** What the user settled on before the backup was taken. */
export interface BackupSettings {
    /** What to call it, already reduced to characters a filename can hold. */
    name: string;
    /** Empty for a backup anyone can open; anything else encrypts it. */
    passphrase: string;
}

/** Where the download stands, and the one thing that can be done about it. */
export interface BackupDownload {
    fileName: string;
    state: "idle" | "running" | "done" | "failed";
    /** What stopped it, once `failed`. */
    error?: string;
    start: () => void;
}

/** Owns a download of the file `settings` describes. */
export function useBackupDownload(settings: BackupSettings): BackupDownload {
    const fileName = useMemo(() => backupFileName(settings.name), [ settings.name ]);
    const [ state, setState ] = useState<BackupDownload["state"]>("idle");
    const [ error, setError ] = useState<string>();

    return {
        fileName,
        state,
        error,
        start: () => {
            setState("running");
            setError(undefined);
            void startBackupDownload(fileName, settings.passphrase).then((result) => {
                setState(result.status === "done" ? "done" : "failed");
                setError(result.status === "done" ? undefined : result.message);
            });
        }
    };
}

/**
 * What the backup is called and whether it is locked, asked before it is taken.
 *
 * The name matters more than it looks: a downloads folder two months from now is a list of
 * near-identical dated files, and the one thing that tells the user why they made this one is what
 * they called it. It is prefilled so that answering nothing is a perfectly good answer.
 *
 * @param onContinue the settings to back up under; the screen after this one does the work.
 */
export function BackupParameters({ onContinue, footer }: {
    onContinue: (settings: BackupSettings) => void;
    /** What sits beside Continue, which differs by the flow this screen was reached through. */
    footer?: ComponentChildren;
}) {
    const [ name, setName ] = useState(() => defaultBackupName(new Date()));
    // Null while the two password fields disagree, which is the one state Continue must not accept:
    // a half-typed password would otherwise be dropped and the backup written unlocked.
    const [ passphrase, setPassphrase ] = useState<string | null>("");

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
                        onClick={() => onContinue({ name, passphrase: passphrase ?? "" })}
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

                    <CardSection>
                        <FormPasswordWithConfirmation
                            optional
                            label={t("setup.backup-password")}
                            confirmationLabel={t("setup.backup-password-repeat")}
                            onChange={setPassphrase}
                        />
                        <small class="form-text">{t("setup.backup-password-description")}</small>
                    </CardSection>
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
                <div class="backup-download-message">
                    <span class="spinner-border" role="status" aria-hidden="true" />
                    <span>{t("setup.backup-downloading")}</span>
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
 * Taking the backup, once its settings are known.
 *
 * Split from the parameters screen so that the download owns a settled name and password: a hook
 * cannot be told to forget what it started, and this component only exists once there is nothing
 * left to change.
 *
 * @param onDone the backup is over, one way or another; leave the wizard.
 */
export function BackupDownloadStep({ settings, onDone }: {
    settings: BackupSettings;
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
    const [ settings, setSettings ] = useState<BackupSettings | null>(null);

    if (!settings) {
        return (
            <BackupParameters
                onContinue={setSettings}
                footer={<Button text={t("setup.backup-finish")} onClick={onDone} />}
            />
        );
    }

    return <BackupDownloadStep settings={settings} onDone={onDone} />;
}

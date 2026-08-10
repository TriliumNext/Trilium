import "./backup.css";

import {
    BackupDatabaseNowResponse,
    BackupPassphraseStatus,
    DatabaseBackup,
    dayjs,
    ExistingBackupsResponse
} from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { isBackupDownloadSupported } from "../../../services/backup_download";
import { describeDatabaseFormat } from "../../../services/database_files";
import dialogService from "../../../services/dialog";
import { t } from "../../../services/i18n";
import options from "../../../services/options";
import server from "../../../services/server";
import { bootToSetup, canBootToSetup } from "../../../services/setup_mode";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import { Card, CardOption, CardSection } from "../../react/Card";
import DirectoryLink from "../../react/DirectoryLink";
import FormPasswordWithConfirmation from "../../react/FormPasswordWithConfirmation";
import FormText from "../../react/FormText";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import Modal from "../../react/Modal";
import SetupForm from "../helpers/SetupForm";
import DatabaseFileList from "./components/DatabaseFileList";
import OptionsPageHeader from "./components/OptionsPageHeader";

export default function BackupSettings() {
    // Standalone keeps no backups anywhere: its one backup is a manual download, streamed straight
    // off the live database, so the page reduces to that action and the way back in.
    return isBackupDownloadSupported() ? <StandaloneBackupSettings /> : <StoredBackupSettings />;
}

/** The page everywhere backups are kept as files: the server, the desktop. */
function StoredBackupSettings() {
    const [backups, setBackups] = useState<DatabaseBackup[]>([]);
    const [backupFolderPath, setBackupFolderPath] = useState<string | null>(null);

    const refreshBackups = useCallback(() => {
        server.get<ExistingBackupsResponse>("database/backups").then((response) => {
            setBackups(response.backups);
            setBackupFolderPath(response.backupFolderPath);
        });
    }, []);

    useEffect(refreshBackups, []);

    return (
        <>
            <OptionsPageHeader
                below={<BackupStatus backups={backups} refreshCallback={refreshBackups} />}
            />
            <BackupList backups={backups} backupFolderPath={backupFolderPath} />
            {/* Absent where there is no user-accessible location at all, e.g. backups kept in OPFS. */}
            {backupFolderPath && <BackupLocation backupFolderPath={backupFolderPath} refreshCallback={refreshBackups} />}
            <BackupConfiguration />
            {/* Desktop only: the passphrase needs an OS keyring to live in, which only the desktop has. */}
            {isElectron() && <BackupOptions />}
        </>
    );
}

/**
 * The whole backup page on the standalone platform: the summary says how backups work there, the
 * same "Backup now" button as everywhere else hands one to the browser as a download, and restore
 * boots to the setup screen the way it does on the other platforms. There is no list, location,
 * schedule or format to configure, because nothing is ever stored.
 */
function StandaloneBackupSettings() {
    return (
        <>
            <OptionsPageHeader />
            <StandaloneBackupSection />
        </>
    );
}

/**
 * The whole of what the standalone platform offers: back up, and restore.
 *
 * A page rather than a row of buttons, because there is nothing else on it: no list of backups, no
 * location and no schedule, since nothing is ever stored. Both actions leave for the setup screen,
 * which is where the database can be held still long enough to be copied or replaced.
 */
export function StandaloneBackupSection() {
    return (
        <div className="options-section standalone-backup">
            <SetupForm icon="bx bx-data">
                <h3>{t("backup.standalone_heading")}</h3>
                <p>{t("backup.standalone_description")}</p>

                {canBootToSetup() && (
                    <div className="standalone-backup-actions">
                        <Button
                            name="backup-database-now-button"
                            text={t("backup.create_and_download")}
                            kind="primary"
                            onClick={() => void backUpInSetup()}
                        />

                        <Button
                            name="restore-backup-button"
                            text={t("backup.upload_and_restore")}
                            onClick={() => void restoreInSetup()}
                        />
                    </div>
                )}
            </SetupForm>
        </div>
    );
}

/**
 * Restarts into the setup screen, where the backup is actually taken.
 *
 * A backup is streamed off the live database over minutes, and a page of it read after a write
 * would not match the pages read before: the copy has to come from a database nothing is touching.
 * Only setup mode gives that — the database is open, but becca, sync and migrations are all held
 * back — so the backup is taken there and the instance comes straight back here.
 */
async function backUpInSetup() {
    if (!await dialogService.confirm(t("backup.restart_for_backup"))) {
        return;
    }

    await bootToSetup({ targetScreen: "backup-database" });
}

/**
 * Restarts into the setup screen, which is where a backup can replace the database.
 *
 * Asked about on every platform that can restart itself, because the restart is the surprising part
 * and because what follows it reads as destructive until the user knows they will be offered a copy
 * of what is about to be replaced.
 */
async function restoreInSetup() {
    if (!await dialogService.confirm(t("backup.restart_for_restore"))) {
        return;
    }

    await bootToSetup({ targetScreen: "restore-backup" });
}

interface BackupStatusProps {
    backups: DatabaseBackup[];
    refreshCallback: () => void;
}

/**
 * How the backups stand, and the one action that makes one now rather than on a schedule. Part
 * of the page's own header rather than of the list below it: the list card answers for what it
 * holds, which is not the same as what the page is for.
 */
export function BackupStatus({ backups, refreshCallback }: BackupStatusProps) {
    const [backupInProgress, setBackupInProgress] = useState(false);

    return (
        <div className="backup-status">
            <span className="backup-status-summary">{summarizeBackups(backups)}</span>

            {/* Offered only where the app can start itself again, which is what a restore needs:
                it happens in the setup screen, with this database closed. */}
            {canBootToSetup() && (
                <Button
                    name="restore-backup-button"
                    text={t("backup.restore_backup")}
                    size="micro"
                    onClick={() => void restoreInSetup()}
                />
            )}

            <Button
                name="backup-database-now-button"
                text={t("backup.backup_now")}
                size="micro"
                disabled={backupInProgress}
                onClick={async () => {
                    setBackupInProgress(true);
                    try {
                        const { backupFile } = await server.post<BackupDatabaseNowResponse>(
                            "database/backup-database"
                        );

                        toast.showMessage(
                            t("backup.database_backed_up_to", { backupFilePath: backupFile }),
                            10000
                        );
                        refreshCallback();
                    } finally {
                        setBackupInProgress(false);
                    }
                }}
            />
        </div>
    );
}

/**
 * How many backups there are and how long ago the last one was made — the two things the list
 * itself only answers by being read through. Nothing is said while there are none: the list
 * stands empty right below, which states it more plainly than a sentence could.
 */
function summarizeBackups(backups: DatabaseBackup[]) {
    if (!backups.length) {
        return null;
    }

    const mostRecent = backups.reduce((latest, backup) => (
        backup.mtime > latest.mtime ? backup : latest
    ));

    return t("backup.backups_summary", {
        count: backups.length,
        age: dayjs(mostRecent.mtime).fromNow(true)
    });
}

export function BackupConfiguration() {
    const [dailyBackupEnabled, setDailyBackupEnabled] = useTriliumOptionBool("dailyBackupEnabled");
    const [weeklyBackupEnabled, setWeeklyBackupEnabled] = useTriliumOptionBool("weeklyBackupEnabled");
    const [monthlyBackupEnabled, setMonthlyBackupEnabled] = useTriliumOptionBool("monthlyBackupEnabled");

    return (
        <div className="options-section backup-configuration">
            <Card
                heading={t("backup.automatic_backups_title")}
                description={t("backup.automatic_backups_description")}
            >
                <CardOption name="daily-backup-enabled" label={t("backup.enable_daily_backup")}>
                    <FormToggle
                        currentValue={dailyBackupEnabled}
                        onChange={setDailyBackupEnabled}
                    />
                </CardOption>

                <CardOption name="weekly-backup-enabled" label={t("backup.enable_weekly_backup")}>
                    <FormToggle
                        currentValue={weeklyBackupEnabled}
                        onChange={setWeeklyBackupEnabled}
                    />
                </CardOption>

                <CardOption name="monthly-backup-enabled" label={t("backup.enable_monthly_backup")}>
                    <FormToggle
                        currentValue={monthlyBackupEnabled}
                        onChange={setMonthlyBackupEnabled}
                    />
                </CardOption>
            </Card>
        </div>
    );
}

/**
 * Where the backups go. The location can only be moved on the desktop application, which is the only
 * one with a directory picker to offer; a server is pointed elsewhere through `TRILIUM_BACKUP_DIR`.
 */
export function BackupLocation({ backupFolderPath, refreshCallback }: { backupFolderPath: string; refreshCallback: () => void }) {
    const [customDir, setCustomDir] = useTriliumOption("customDbBackupDir");
    const canSelect = isElectron();

    async function selectLocation() {
        const result = await window.electronApi?.dialog.pickDirectory({ defaultPath: backupFolderPath });
        if (result?.status !== "selected" || !result.path) {
            return;
        }

        await setCustomDir(result.path);
        refreshCallback();
    }

    async function resetToDefault() {
        if (!await dialogService.confirm(t("backup.reset_location_confirmation"))) {
            return;
        }

        await setCustomDir("");
        refreshCallback();
    }

    return (
        <div className="options-section backup-location">
            <Card heading={t("backup.location_title")}>
                <CardSection>
                    <Icon icon="bx bx-folder" className="backup-location-icon" />

                    <div className="backup-location-label">{t("backup.saved_in")}</div>
                    <div className="backup-location-path"><DirectoryLink directory={backupFolderPath} /></div>

                    <div className="backup-location-actions">
                        <Button
                            name="select-backup-location-button"
                            text={t("backup.select_location")}
                            size="micro"
                            disabled={!canSelect}
                            disabledTooltip={t("backup.select_location_desktop_only")}
                            onClick={selectLocation}
                        />

                        {customDir && (
                            <Button
                                name="reset-backup-location-button"
                                text={t("backup.reset_location")}
                                size="micro"
                                onClick={resetToDefault}
                            />
                        )}
                    </div>
                </CardSection>
            </Card>
        </div>
    );
}

/**
 * What a backup is written as: a plain database copy, or a backup container that is compressed,
 * encrypted, or both.
 *
 * Encryption hangs off a passphrase the OS keyring holds, so the controls follow what that keyring
 * can do. Without one there is nowhere safe to keep the passphrase, and an unattended backup cannot
 * ask for it, so the whole feature is unavailable rather than half-working.
 */
export function BackupOptions() {
    const [compressionEnabled, setCompressionEnabled] = useTriliumOptionBool("backupEnableCompression");
    const [encryptionEnabled, setEncryptionEnabled] = useTriliumOptionBool("backupEnableEncryption");
    const [passphrase, setPassphrase] = useState<BackupPassphraseStatus>({ available: false, set: false });
    const [passwordModalShown, setPasswordModalShown] = useState(false);

    const refreshPassphrase = useCallback(async () => {
        const status = await window.electronApi?.backupPassphrase.getStatus();
        if (status) {
            setPassphrase(status);
        }
    }, []);

    useEffect(() => { void refreshPassphrase(); }, [refreshPassphrase]);

    async function storePassword(password: string) {
        const result = await window.electronApi?.backupPassphrase.set(password);

        // Declined at the OS confirmation: the user has said no, which needs no telling back.
        if (result === "cancelled") {
            return;
        }
        if (result !== "applied") {
            toast.showError(t("backup.password_not_stored"));
            return;
        }

        await refreshPassphrase();
        await setEncryptionEnabled(true);
        setPasswordModalShown(false);

        // The password is stored either way, but saying it is encrypted when the option never
        // reached the server would send the next backup out in the clear under that belief.
        if (!options.is("backupEnableEncryption")) {
            toast.showError(t("backup.encryption_not_enabled"));
            return;
        }

        toast.showMessage(t("backup.password_stored"));
    }

    // Switching encryption off forgets the passphrase with it: there is nothing left to keep it for,
    // and leaving it behind would mean a passphrase nobody remembers setting. Backups already written
    // keep the one they were written with.
    async function disableEncryption() {
        const result = await window.electronApi?.backupPassphrase.clear();

        // Re-read either way: a declined confirmation has to put the switch back where it was.
        await refreshPassphrase();
        if (result !== "applied") {
            return;
        }

        await setEncryptionEnabled(false);

        // Saving an option swallows its own failure, and the passphrase is already gone by now. Left
        // unsaid, every later backup would quietly fall back to an unencrypted one in the default
        // directory, with nothing on this page to explain why.
        if (options.is("backupEnableEncryption")) {
            toast.showError(t("backup.encryption_not_disabled"));
        }
    }

    return (
        <div className="options-section backup-options">
            <Card heading={t("backup.options_title")}>
                <CardOption
                    label={t("backup.enable_encryption")}
                    description={passphrase.available
                        ? t("backup.enable_encryption_description")
                        : t("backup.no_keyring")}
                >
                    {passphrase.set ? (
                        <>
                            <Button
                                name="change-backup-password-button"
                                text={t("backup.change_password")}
                                size="micro"
                                onClick={() => setPasswordModalShown(true)}
                            />
                            <FormToggle
                                currentValue={encryptionEnabled}
                                onChange={(enabled) => enabled ? setEncryptionEnabled(true) : disableEncryption()}
                            />
                        </>
                    ) : (
                        <Button
                            name="turn-on-backup-encryption-button"
                            text={t("backup.turn_on_encryption")}
                            size="micro"
                            disabled={!passphrase.available}
                            onClick={() => setPasswordModalShown(true)}
                        />
                    )}
                </CardOption>

                <CardOption
                    name="backup-compression-enabled"
                    label={t("backup.enable_compression")}
                    description={t("backup.enable_compression_description")}
                >
                    <FormToggle
                        currentValue={compressionEnabled}
                        onChange={setCompressionEnabled}
                    />
                </CardOption>
            </Card>

            <BackupPasswordModal
                show={passwordModalShown}
                onHidden={() => setPasswordModalShown(false)}
                onSave={storePassword}
            />
        </div>
    );
}

/** Asks for a backup password twice over, for setting the first one or replacing the one in place. */
function BackupPasswordModal({ show, onHidden, onSave }: { show: boolean; onHidden: () => void; onSave: (password: string) => void }) {
    const [password, setPassword] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <Modal
            className="backup-password-modal"
            title={t("backup.password_modal_title")}
            size="sm"
            // Options can themselves be a dialog; without this, showing here closes the one behind.
            stackable
            show={show}
            onShown={() => inputRef.current?.focus()}
            onHidden={onHidden}
            onSubmit={() => password && onSave(password)}
            footer={<Button text={t("backup.save_password")} kind="primary" disabled={!password} />}
        >
            <FormText>{t("backup.password_modal_description")}</FormText>

            <FormPasswordWithConfirmation inputRef={inputRef} onChange={setPassword} />
        </Modal>
    );
}

interface BackupListProps {
    backups: DatabaseBackup[];
    backupFolderPath: string | null;
}

export function BackupList({ backups, backupFolderPath }: BackupListProps) {
    const [customDir] = useTriliumOption("customDbBackupDir");

    // What a row cannot say for itself: the format it was written in, and — with a custom location in
    // use, where the list also carries whatever stayed in or was redirected to the default one — which
    // directory it is in.
    const fileBadges = useCallback((file: DatabaseBackup) => {
        const badges: string[] = [];

        if (customDir && backupFolderPath && !isInsideDirectory(backupFolderPath, file.filePath)) {
            badges.push(t("backup.default_location"));
        }

        // What the file is comes from the shared description, so it reads the same here as it does
        // on the setup screen that offers to restore from it.
        return [ ...badges, ...describeDatabaseFormat(file) ];
    }, [customDir, backupFolderPath]);

    return (
        // Where the backups live is stated by the "Backup location" card above, not repeated here.
        <DatabaseFileList
            title={t("backup.existing_backups")}
            files={backups}
            fileBadges={fileBadges}
            downloadEndpoint="api/database/backup/download"
            downloadText={t("backup.download")}
            emptyIcon="bx bx-archive"
            emptyText={t("backup.no_backup_yet")}
        />
    );
}

/** Both paths come already resolved from the server, so a prefix test settles containment on either platform. */
function isInsideDirectory(directory: string, filePath: string) {
    const rest = filePath.slice(directory.length);

    return filePath.startsWith(directory) && (rest.startsWith("/") || rest.startsWith("\\"));
}

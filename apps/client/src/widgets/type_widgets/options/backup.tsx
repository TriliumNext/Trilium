import "./backup.css";

import { BackupDatabaseNowResponse, DatabaseBackup, ExistingBackupsResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import dialogService from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import { Card, CardSection } from "../../react/Card";
import DirectoryLink from "../../react/DirectoryLink";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import DatabaseFileList, { type DatabaseFile } from "./components/DatabaseFileList";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function BackupSettings() {
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
            <OptionsPageHeader />
            <BackupConfiguration />
            {/* Absent where there is no user-accessible location at all, e.g. backups kept in OPFS. */}
            {backupFolderPath && <BackupLocation backupFolderPath={backupFolderPath} refreshCallback={refreshBackups} />}
            <BackupList backups={backups} backupFolderPath={backupFolderPath} refreshCallback={refreshBackups} />
        </>
    );
}

export function BackupConfiguration() {
    const [dailyBackupEnabled, setDailyBackupEnabled] = useTriliumOptionBool("dailyBackupEnabled");
    const [weeklyBackupEnabled, setWeeklyBackupEnabled] = useTriliumOptionBool("weeklyBackupEnabled");
    const [monthlyBackupEnabled, setMonthlyBackupEnabled] = useTriliumOptionBool("monthlyBackupEnabled");

    return (
        <OptionsSection
            title={t("backup.automatic_backups_title")}
            description={t("backup.automatic_backups_description")}
        >
            <OptionsRowWithToggle
                name="daily-backup-enabled"
                label={t("backup.enable_daily_backup")}
                currentValue={dailyBackupEnabled}
                onChange={setDailyBackupEnabled}
            />

            <OptionsRowWithToggle
                name="weekly-backup-enabled"
                label={t("backup.enable_weekly_backup")}
                currentValue={weeklyBackupEnabled}
                onChange={setWeeklyBackupEnabled}
            />

            <OptionsRowWithToggle
                name="monthly-backup-enabled"
                label={t("backup.enable_monthly_backup")}
                currentValue={monthlyBackupEnabled}
                onChange={setMonthlyBackupEnabled}
            />
        </OptionsSection>
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

export function BackupList({ backups, backupFolderPath, refreshCallback }: { backups: DatabaseBackup[]; backupFolderPath: string | null; refreshCallback: () => void }) {
    const [backupInProgress, setBackupInProgress] = useState(false);
    const [customDir] = useTriliumOption("customDbBackupDir");

    // With a custom location in use the list also carries whatever stayed in — or was redirected to —
    // the default one, and a row shows only a file name, so those need telling apart.
    const fileBadge = useCallback((file: DatabaseFile) => (
        customDir && backupFolderPath && !isInsideDirectory(backupFolderPath, file.filePath)
            ? t("backup.default_location")
            : undefined
    ), [customDir, backupFolderPath]);

    return (
        // Where the backups live is stated by the "Backup location" card above, not repeated here.
        <DatabaseFileList
            title={t("backup.existing_backups")}
            files={backups}
            fileBadge={fileBadge}
            downloadEndpoint="api/database/backup/download"
            rowName="existing-backup"
            downloadText={t("backup.download")}
            emptyIcon="bx bx-archive"
            emptyText={t("backup.no_backup_yet")}
        >
            <OptionsRow name="backup-now" centered>
                <Button
                    name="backup-database-now-button"
                    text={t("backup.backup_database_now")}
                    size="micro"
                    disabled={backupInProgress}
                    onClick={async () => {
                        setBackupInProgress(true);
                        try {
                            const { backupFile } = await server.post<BackupDatabaseNowResponse>("database/backup-database");
                            toast.showMessage(t("backup.database_backed_up_to", { backupFilePath: backupFile }), 10000);
                            refreshCallback();
                        } finally {
                            setBackupInProgress(false);
                        }
                    }}
                />
            </OptionsRow>
        </DatabaseFileList>
    );
}

/** Both paths come already resolved from the server, so a prefix test settles containment on either platform. */
function isInsideDirectory(directory: string, filePath: string) {
    const rest = filePath.slice(directory.length);

    return filePath.startsWith(directory) && (rest.startsWith("/") || rest.startsWith("\\"));
}

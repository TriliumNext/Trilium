import { BackupDatabaseNowResponse, DatabaseBackup, ExistingBackupsResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import { useTriliumOptionBool } from "../../react/hooks";
import DatabaseFileList from "./components/DatabaseFileList";
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
            <BackupConfiguration />
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

export function BackupList({ backups, backupFolderPath, refreshCallback }: { backups: DatabaseBackup[]; backupFolderPath: string | null; refreshCallback: () => void }) {
    const [backupInProgress, setBackupInProgress] = useState(false);

    return (
        <DatabaseFileList
            title={t("backup.existing_backups")}
            locationDescription={backupFolderPath && t("backup.backup_location_description", { backupFolder: backupFolderPath })}
            files={backups}
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

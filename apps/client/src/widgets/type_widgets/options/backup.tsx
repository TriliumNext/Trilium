import { BackupDatabaseNowResponse, DatabaseBackup } from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { formatDateTime } from "../../../utils/formatters";
import ActionButton from "../../react/ActionButton";
import FormText from "../../react/FormText";
import { useTriliumOptionBool } from "../../react/hooks";
import { OptionsRowWithButton, OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function BackupSettings() {
    const [backups, setBackups] = useState<DatabaseBackup[]>([]);

    const refreshBackups = useCallback(() => {
        server.get<DatabaseBackup[]>("database/backups").then((backupFiles) => {
            // Sort the backup files by modification date & time in a desceding order
            backupFiles.sort((a, b) => {
                if (a.mtime < b.mtime) return 1;
                if (a.mtime > b.mtime) return -1;
                return 0;
            });

            setBackups(backupFiles);
        });
    }, [setBackups]);

    useEffect(refreshBackups, []);

    return (
        <>
            <BackupConfiguration refreshCallback={refreshBackups} />
            <BackupList backups={backups} />
        </>
    );
}

export function BackupConfiguration({ refreshCallback }: { refreshCallback: () => void }) {
    const [dailyBackupEnabled, setDailyBackupEnabled] = useTriliumOptionBool("dailyBackupEnabled");
    const [weeklyBackupEnabled, setWeeklyBackupEnabled] = useTriliumOptionBool("weeklyBackupEnabled");
    const [monthlyBackupEnabled, setMonthlyBackupEnabled] = useTriliumOptionBool("monthlyBackupEnabled");

    return (
        <OptionsSection title={t("backup.title")}>
            <FormText>{t("backup.automatic_backup_description")}</FormText>

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

            <FormText>{t("backup.backup_recommendation")}</FormText>

            <hr />

            <OptionsRowWithButton
                label={t("backup.backup_database_now")}
                onClick={async () => {
                    const { backupFile } = await server.post<BackupDatabaseNowResponse>("database/backup-database");
                    toast.showMessage(t("backup.database_backed_up_to", { backupFilePath: backupFile }), 10000);
                    refreshCallback();
                }}
            />
        </OptionsSection>
    );
}

export function BackupList({ backups }: { backups: DatabaseBackup[] }) {
    return (
        <OptionsSection title={t("backup.existing_backups")}>
            <table class="table table-stripped">
                <colgroup>
                    <col width="33%" />
                    <col />
                    <col width="1%" />
                </colgroup>
                <thead>
                    <tr>
                        <th>{t("backup.date-and-time")}</th>
                        <th>{t("backup.path")}</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    { backups.length > 0 ? (
                        backups.map(({ mtime, filePath }) => (
                            <tr>
                                <td>{mtime ? formatDateTime(mtime) : "-"}</td>
                                <td className="selectable-text">{filePath}</td>
                                <td>
                                    <a href={`api/database/backup/download?filePath=${encodeURIComponent(filePath)}`} download>
                                        <ActionButton icon="bx bx-download" text={t("backup.download")} />
                                    </a>
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td className="empty-table-placeholder" colspan={3}>{t("backup.no_backup_yet")}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </OptionsSection>
    );
}

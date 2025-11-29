import { BackupDatabaseNowResponse, DatabaseBackup } from "@triliumnext/commons";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import FormCheckbox from "../../react/FormCheckbox";
import { FormMultiGroup } from "../../react/FormGroup";
import FormText from "../../react/FormText";
import { useTriliumOptionBool } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import { useCallback, useEffect, useState } from "preact/hooks";
import { formatDateTime } from "../../../utils/formatters";

export default function BackupSettings() {
    const [ backups, setBackups ] = useState<DatabaseBackup[]>([]);

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
    }, [ setBackups ]);

    useEffect(refreshBackups, []);

    return (
        <>
            <AutomaticBackup />
            <BackupNow refreshCallback={refreshBackups} />
            <BackupList backups={backups} />
        </>
    )
}

export function AutomaticBackup() {
    const [ dailyBackupEnabled, setDailyBackupEnabled ] = useTriliumOptionBool("dailyBackupEnabled");
    const [ weeklyBackupEnabled, setWeeklyBackupEnabled ] = useTriliumOptionBool("weeklyBackupEnabled");
    const [ monthlyBackupEnabled, setMonthlyBackupEnabled ] = useTriliumOptionBool("monthlyBackupEnabled");

    return (
        <OptionsSection title={t("backup.automatic_backup")}>
            <FormMultiGroup label={t("backup.automatic_backup_description")}>
                <FormCheckbox
                    name="daily-backup-enabled"
                    label={t("backup.enable_daily_backup")}
                    currentValue={dailyBackupEnabled} onChange={setDailyBackupEnabled}
                />

                <FormCheckbox
                    name="weekly-backup-enabled"
                    label={t("backup.enable_weekly_backup")}
                    currentValue={weeklyBackupEnabled} onChange={setWeeklyBackupEnabled}
                />

                <FormCheckbox
                    name="monthly-backup-enabled"
                    label={t("backup.enable_monthly_backup")}
                    currentValue={monthlyBackupEnabled} onChange={setMonthlyBackupEnabled}
                />
            </FormMultiGroup>

            <FormText>{t("backup.backup_recommendation")}</FormText>
        </OptionsSection>
    )
}

export function BackupNow({ refreshCallback }: { refreshCallback: () => void }) {
    return (
        <OptionsSection title={t("backup.backup_now")}>
            <Button
                text={t("backup.backup_database_now")}
                onClick={async () => {
                    const { backupFile } = await server.post<BackupDatabaseNowResponse>("database/backup-database");
                    toast.showMessage(t("backup.database_backed_up_to", { backupFilePath: backupFile }), 10000);
                    refreshCallback();
                }}
            />
        </OptionsSection>
    )
}

export function BackupList({ backups }: { backups: DatabaseBackup[] }) {
    return (
        <OptionsSection title={t("backup.existing_backups")}>
            <table class="table table-stripped">
                <colgroup>
                    <col width="33%" />
                    <col />
                </colgroup>
                <thead>
                    <tr>
                        <th>{t("backup.date-and-time")}</th>
                        <th>{t("backup.path")}</th>
                    </tr>
                </thead>
                <tbody>
                    { backups.length > 0 ? (
                        backups.map(({ mtime, filePath }) => (
                            <tr>
                                <td>{mtime ? formatDateTime(mtime) : "-"}</td>
                                <td className="selectable-text">{filePath}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td className="empty-table-placeholder" colspan={2}>{t("backup.no_backup_yet")}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </OptionsSection>
    );   
}
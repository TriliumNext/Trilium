import type { DatabaseBackup } from "@triliumnext/commons";
import { BackupService } from "@triliumnext/core";

/**
 * Pool entries earlier versions could leave behind: they vacuumed a snapshot into the pool, and a
 * backup interrupted mid-vacuum left the snapshot, up to the database's own size, or its journal
 * sitting there. Swept for as long as such pools may still be around.
 */
const SNAPSHOT_LEFTOVERS = [ "/backup-snapshot.db", "/backup-snapshot.db-journal" ];

/** The slice of the SAH pool the leftover sweep needs. `SAHPoolUtil` matches it as it stands. */
export interface SnapshotPool {
    unlink(filename: string): boolean;
}

/**
 * Standalone backup service: a stub, deliberately.
 *
 * The platform keeps no backups anywhere. Its one backup is manual: the options screen and the
 * setup screen stream the live database straight into a browser download, through the service
 * worker, without a byte of it landing in the browser's own storage — which is the point, since
 * that storage holds the live database and can rarely hold a copy of it beside itself. So nothing
 * here schedules, stores, lists or serves anything.
 *
 * The pre-migration backup is skipped with a warning rather than refused: the only backup this
 * platform has needs a user at a screen, and blocking a migration on a backup nobody can take
 * would leave the application unable to start at all.
 */
export default class StandaloneBackupService extends BackupService {

    override scheduleBackups(): void {
        // Nothing is ever stored, so there is nothing to schedule.
    }

    override async backupNow(name: string): Promise<string> {
        console.warn(`[Backup] Stored backups are not supported on this platform, so "${name}" `
            + "was not created. The options screen backs up by downloading a copy instead.");
        return "";
    }

    override async getExistingBackups(): Promise<DatabaseBackup[]> {
        return [];
    }

    override async getBackupContent(): Promise<Uint8Array | null> {
        return null;
    }

}

/**
 * Removes whatever an earlier version's snapshot machinery left in the pool. Unlinking truncates
 * the pool's physical file, so the quota comes back with it.
 *
 * Called by the worker at startup: the space should not stay lost just because the machinery that
 * would have reclaimed it is gone. Never the reason anything fails.
 */
export function removeBackupLeftovers(pool: SnapshotPool): void {
    for (const name of SNAPSHOT_LEFTOVERS) {
        try {
            pool.unlink(name);
        } catch {
            // A leftover entry costs a pool slot and its bytes, which the next sweep tries again.
        }
    }
}

import backupService from "./backup.js";
import sql from "./sql.js";
import log from "./log.js";
import { crash } from "./utils.js";
import appInfo from "./app_info.js";
import cls from "./cls.js";
import { t } from "i18next";
import MIGRATIONS from "../migrations/migrations.js";

interface MigrationInfo {
    dbVersion: number;
    /**
     * If string, then the migration is an SQL script that will be executed.
     * If a function, then the migration is a JavaScript/TypeScript module that will be executed.
     */
    migration: string | (() => void);
    ignoreErrors?: boolean;
}

async function migrate() {
    const currentDbVersion = getDbVersion();

    if (currentDbVersion < 214) {
        await crash(t("migration.old_version"));
        return;
    }

    // backup before attempting migration
    if (!process.env.TRILIUM_INTEGRATION_TEST) {
        await backupService.backupNow(
            // creating a special backup for version 0.60.4, the changes in 0.61 are major.
            currentDbVersion === 214 ? `before-migration-v060` : "before-migration"
        );
    }

    const migrations = await prepareMigrations(currentDbVersion);

    // all migrations are executed in one transaction - upgrade either succeeds, or the user can stay at the old version
    // otherwise if half of the migrations succeed, user can't use any version - DB is too "new" for the old app,
    // and too old for the new app version.

    cls.setMigrationRunning(true);

    sql.transactional(() => {
        for (const mig of migrations) {
            try {
                log.info(`Attempting migration to version ${mig.dbVersion}`);

                executeMigration(mig);

                sql.execute(
                    /*sql*/`UPDATE options
                            SET value = ?
                            WHERE name = ?`,
                    [mig.dbVersion.toString(), "dbVersion"]
                );

                log.info(`Migration to version ${mig.dbVersion} has been successful.`);
            } catch (e: any) {
                if (mig.ignoreErrors) {
                    log.info(`Migration to version ${mig.dbVersion} failed, but ignoreErrors is set. Continuing. Error: ${e.message}`);
                } else {
                    console.error(e);
                    crash(t("migration.error_message", { version: mig.dbVersion, stack: e.stack }));
                    break; // crash() is sometimes async
                }
            }
        }
    });

    if (currentDbVersion === 214) {
        // special VACUUM after the big migration
        log.info("VACUUMing database, this might take a while ...");
        sql.execute("VACUUM");
    }
}

async function prepareMigrations(currentDbVersion: number): Promise<MigrationInfo[]> {
    MIGRATIONS.sort((a, b) => a.version - b.version);
    const migrations: MigrationInfo[] = [];
    for (const migration of MIGRATIONS) {
        const dbVersion = migration.version;
        if (dbVersion > currentDbVersion) {
            if ("sql" in migration) {
                migrations.push({
                    dbVersion,
                    migration: migration.sql,
                    ignoreErrors: migration.ignoreErrors
                });
            } else {
                // Due to ESM imports, the migration file needs to be imported asynchronously and thus cannot be loaded at migration time (since migration is not asynchronous).
                // As such we have to preload the ESM.
                migrations.push({
                    dbVersion,
                    migration: (await migration.module()).default,
                    ignoreErrors: migration.ignoreErrors
                });
            }
        }
    }
    return migrations;
}

function executeMigration({ migration }: MigrationInfo) {
    if (typeof migration === "string") {
        console.log(`Migration with SQL script: ${migration}`);
        sql.executeScript(migration);
    } else {
        console.log("Migration with JS module");
        migration();
    };
}

function getDbVersion() {
    return parseInt(sql.getValue("SELECT value FROM options WHERE name = 'dbVersion'"));
}

function isDbUpToDate() {
    const dbVersion = getDbVersion();

    const upToDate = dbVersion >= appInfo.dbVersion;

    if (!upToDate) {
        log.info(`App db version is ${appInfo.dbVersion}, while db version is ${dbVersion}. Migration needed.`);
    }

    return upToDate;
}

async function migrateIfNecessary() {
    const currentDbVersion = getDbVersion();

    if (isNaN(currentDbVersion)) {
        await crash(t("migration.invalid_db_version"));
        return;
    }

    if (currentDbVersion > appInfo.dbVersion && process.env.TRILIUM_IGNORE_DB_VERSION !== "true") {
        await crash(t("migration.wrong_db_version", { version: currentDbVersion, targetVersion: appInfo.dbVersion }));
    }

    if (!isDbUpToDate()) {
        await migrate();
    }
}

export default {
    migrateIfNecessary,
    isDbUpToDate
};

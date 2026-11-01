/**
 * Search benchmark against a real database.
 *
 * Boots core exactly as `main.ts` does, minus the HTTP server, and opens whatever database
 * `TRILIUM_DATA_DIR` points at. Run it read-only against a snapshot, never a live document:
 *
 *   TRILIUM_RESOURCE_DIR=$PWD/apps/server/src TRILIUM_DATA_DIR=<dir> \
 *   TRILIUM_GENERAL_READONLY=true TRILIUM_GENERAL_NOBACKUP=true \
 *     node --import tsx apps/server/bench-search.mts <query>...
 */

import fs from "fs";
import { Session } from "inspector";
import path from "path";
import { promisify } from "util";

const QUERIES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [ "a", "s", "t", "te", "tec", "tech" ];
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 5);

/** `apps/server` builds to CommonJS, so a default export arrives wrapped when tsx loads it here. */
async function loadDefault<T>(specifier: string): Promise<T> {
    const mod: any = await import(specifier);
    const outer = mod.default ?? mod;
    return (outer?.default ?? outer) as T;
}

async function boot() {
    const { initializeCore, options } = await import("@triliumnext/core");
    const config = await loadDefault<any>("./src/services/config.js");
    const dataDirs = await loadDefault<any>("./src/services/data_dir.js");

    if (!config.General.readOnly) {
        throw new Error("Refusing to run: set TRILIUM_GENERAL_READONLY=true so the snapshot is never written to.");
    }

    const BetterSqlite3Provider = await loadDefault<any>("./src/sql_provider.js");
    const ServerLogService = await loadDefault<any>("./src/log_provider.js");
    const { RESOURCE_DIR } = await import("./src/services/resource_dir.js");
    const { consumeSetupMarker, setupPlatform } = await import("./src/services/setup_marker.js");

    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromFile(dataDirs.DOCUMENT_PATH, true);

    await initializeCore({
        dbConfig: { provider: dbProvider, isReadOnly: true, onTransactionCommit() {}, onTransactionRollback() {} },
        crypto: new (await loadDefault<any>("./src/crypto_provider.js"))(),
        zip: new (await loadDefault<any>("./src/zip_provider.js"))(),
        zipExportProviderFactory: (await import("./src/services/export/zip/factory.js")).serverZipExportProviderFactory,
        request: new (await loadDefault<any>("./src/services/request.js"))(),
        executionContext: new (await loadDefault<any>("./src/cls_provider.js"))(),
        messaging: new (await loadDefault<any>("./src/services/ws_messaging_provider.js"))(),
        schema: (await import("./src/core_assets.js")).loadCoreSchema(),
        platform: new (await loadDefault<any>("./src/platform_provider.js"))(),
        log: new ServerLogService(),
        translations: (await import("./src/services/i18n.js")).initializeTranslationsWithParams,
        getDemoArchive: async () => fs.readFileSync(path.join(RESOURCE_DIR, "db", "demo.zip")),
        inAppHelp: new (await loadDefault<any>("./src/in_app_help_provider.js"))(),
        backup: new (await loadDefault<any>("./src/backup_provider.js"))(options),
        image: (await import("./src/services/image_provider.js")).serverImageProvider,
        config,
        setupMarker: consumeSetupMarker(),
        setupPlatform,
        extraAppInfo: { nodeVersion: process.version, dataDirectory: path.resolve(dataDirs.TRILIUM_DATA_DIR) }
    } as any);
}

function summarise(label: string, samples: number[]) {
    const sorted = [ ...samples ].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return `${label.padEnd(9)} min=${sorted[0].toFixed(1).padStart(7)}  med=${sorted[Math.floor(sorted.length / 2)].toFixed(1).padStart(7)}`
        + `  max=${sorted[sorted.length - 1].toFixed(1).padStart(7)}  mean=${(sum / sorted.length).toFixed(1).padStart(7)}`;
}

/** Samples only the search calls, so booting and becca loading stay out of the profile. */
async function withProfile<T>(outPath: string | undefined, run: () => Promise<T>): Promise<T> {
    if (!outPath) {
        return run();
    }

    const session = new Session();
    session.connect();
    const post = promisify(session.post.bind(session)) as (method: string, params?: unknown) => Promise<any>;

    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", { interval: 100 });
    await post("Profiler.start");

    try {
        return await run();
    } finally {
        const { profile } = await post("Profiler.stop");
        fs.writeFileSync(outPath, JSON.stringify(profile));
        session.disconnect();
        console.log(`\nprofile written to ${outPath}`);
    }
}

async function main() {
    const bootAt = performance.now();
    await boot();

    const { becca, becca_loader, cls, search: searchService, SearchContext } = await import("@triliumnext/core");

    if (Object.keys(becca.notes).length === 0) {
        cls.init(() => becca_loader.load());
    }
    console.log(`booted in ${(performance.now() - bootAt).toFixed(0)}ms, ${Object.keys(becca.notes).length} notes in becca\n`);

    await withProfile(process.env.BENCH_PROFILE, async () => {
    for (const query of QUERIES) {
        const samples: number[] = [];
        let matched = 0;

        for (let i = 0; i < ITERATIONS; i++) {
            cls.init(() => {
                const context = new SearchContext({
                    fastSearch: true,
                    includeArchivedNotes: false,
                    includeHiddenNotes: true,
                    fuzzyAttributeSearch: true,
                    ignoreInternalAttributes: true,
                    ancestorNoteId: "root",
                    // BENCH_AUTOCOMPLETE=1 takes NoteFlatTextExp's single-token path, which skips
                    // the recursive parent walk and keeps every flat-text candidate.
                    autocomplete: process.env.BENCH_AUTOCOMPLETE === "1",
                    // Mirrors `searchNotesForAutocomplete`.
                    rankInTwoPasses: process.env.BENCH_ONE_PASS !== "1"
                });

                const startedAt = performance.now();
                const results = searchService.findResultsWithQuery(query, context);
                samples.push(performance.now() - startedAt);
                matched = results.length;
            });
        }

        console.log(`${summarise(JSON.stringify(query), samples)}  matched=${matched}`);
    }
    });
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error);
        process.exit(1);
    }
);

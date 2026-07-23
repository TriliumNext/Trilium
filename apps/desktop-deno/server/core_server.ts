/**
 * Boots trilium-core natively inside the Deno process ("core + Deno
 * providers"). No Node, no Express, no WASM: SQL runs in-process through
 * node:sqlite, and the shared route table from core is dispatched by the
 * transport-agnostic BrowserRouter that the standalone app already uses.
 *
 * Platform-neutral providers are reused from apps/standalone/src/lightweight
 * (pure JS: zip, CLS context, request, image) and apps/server (node:crypto);
 * the Deno-specific ones live in ./providers.ts.
 */

import { initializeCore, options, ws } from "@triliumnext/core";
import type { ExportFormat, ZipExportProvider, ZipExportProviderData } from "@triliumnext/core";

import BrowserExecutionContext from "../../standalone/src/lightweight/cls_provider.ts";
import NodejsCryptoProvider from "../../server/src/crypto_provider.ts";
import BrowserZipProvider from "../../standalone/src/lightweight/zip_provider.ts";
import FetchRequestProvider from "../../standalone/src/lightweight/request_provider.ts";
import { createConfiguredRouter } from "../../standalone/src/lightweight/browser_routes.ts";
import type { BrowserRouter } from "../../standalone/src/lightweight/browser_router.ts";
import { standaloneImageProvider } from "../../standalone/src/services/image_provider.ts";

import DenoSqlProvider from "./sql_provider.ts";
import { createTranslationProvider, DenoBackupService, DenoMessagingProvider, DenoPlatformProvider } from "./providers.ts";

export interface CoreServer {
    router: BrowserRouter;
    messaging: DenoMessagingProvider;
    sqlProvider: DenoSqlProvider;
}

export interface CoreServerOptions {
    dbPath: string;
    dataDir: string;
    /** Standalone dist dir — used for server assets (translations, demo zip). */
    distDir: string;
}

export async function startCoreServer(opts: CoreServerOptions): Promise<CoreServer> {
    const sqlProvider = new DenoSqlProvider();
    sqlProvider.loadFromFile(opts.dbPath, false);

    const messaging = new DenoMessagingProvider();
    const schema = await Deno.readTextFile(
        new URL(import.meta.resolve("@triliumnext/core/src/assets/schema.sql"))
    );

    await initializeCore({
        dbConfig: {
            provider: sqlProvider,
            isReadOnly: false,
            onTransactionCommit: () => {
                ws.sendTransactionEntityChangesToAllClients();
            },
            onTransactionRollback: () => {
                // No-op, mirroring the standalone worker.
            }
        },
        executionContext: new BrowserExecutionContext(),
        crypto: new NodejsCryptoProvider(),
        zip: new BrowserZipProvider(),
        zipExportProviderFactory: denoZipExportProviderFactory,
        messaging,
        request: new FetchRequestProvider(),
        platform: new DenoPlatformProvider(),
        schema,
        translations: createTranslationProvider(resolveServerAsset(opts.distDir, "translations")),
        backup: new DenoBackupService(options, sqlProvider, `${opts.dataDir}/backups`),
        image: standaloneImageProvider,
        getDemoArchive: async () => {
            try {
                return await Deno.readFile(`${resolveServerAsset(opts.distDir, "db")}/demo.zip`);
            } catch {
                return null;
            }
        },
        extraAppInfo: {
            nodeVersion: `deno ${Deno.version.deno}`,
            dataDirectory: opts.dataDir
        }
    });

    ws.init();

    return {
        router: createConfiguredRouter(),
        messaging,
        sqlProvider
    };
}

/**
 * Same as the standalone factory, except the editor content CSS is read from
 * disk — the standalone version pulls it in with a Vite `?raw` import, which
 * Deno cannot load.
 */
async function denoZipExportProviderFactory(format: ExportFormat, data: ZipExportProviderData): Promise<ZipExportProvider> {
    switch (format) {
        case "html": {
            const contentCss = await Deno.readTextFile(
                new URL(import.meta.resolve("../../../packages/ckeditor5/src/theme/ck-content.css"))
            );
            const { default: HtmlExportProvider } = await import("@triliumnext/core/src/services/export/zip/html.ts");
            return new HtmlExportProvider(data, { contentCss });
        }
        case "markdown": {
            const { default: MarkdownExportProvider } = await import("@triliumnext/core/src/services/export/zip/markdown.ts");
            return new MarkdownExportProvider(data);
        }
        default:
            throw new Error(`Unsupported export format: '${format}'`);
    }
}

/**
 * Server assets (translations, demo db) come from the standalone dist copy;
 * when it has not been built yet, fall back to the repo source directory.
 */
function resolveServerAsset(distDir: string, subPath: string): string {
    const fromDist = `${distDir}/server-assets/${subPath}`;
    try {
        Deno.statSync(fromDist);
        return fromDist;
    } catch {
        return new URL(import.meta.resolve(`../../server/src/assets/${subPath}`)).pathname;
    }
}

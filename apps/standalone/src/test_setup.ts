import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { initializeCore, options } from "@triliumnext/core";
import schemaSql from "@triliumnext/core/src/assets/schema.sql?raw";
import serverEnTranslations from "../../server/src/assets/translations/en/server.json";
import { beforeAll } from "vitest";

import StandaloneBackupService from "./lightweight/backup_provider.js";
import BrowserExecutionContext from "./lightweight/cls_provider.js";
import BrowserCryptoProvider from "./lightweight/crypto_provider.js";
import StandalonePlatformProvider from "./lightweight/platform_provider.js";
import BrowserSqlProvider from "./lightweight/sql_provider.js";
import BrowserZipProvider from "./lightweight/zip_provider.js";
import { standaloneImageProvider } from "./services/image_provider.js";

// =============================================================================
// SQLite WASM compatibility shims
// =============================================================================
// The @sqlite.org/sqlite-wasm package loads its .wasm via fetch, and its
// bundled `instantiateWasm` hook overrides any user-supplied alternative.
// Two things go wrong under vitest + happy-dom:
//   1. happy-dom's `fetch()` refuses `file://` URLs.
//   2. happy-dom installs its own Response global, which Node's
//      `WebAssembly.instantiateStreaming` rejects ("Received an instance of
//      Response" — it wants undici's Response).
// We intercept fetch for file:// URLs ourselves and force instantiateStreaming
// to fall back to the ArrayBuffer path.
const fileFetchCache = new Map<string, ArrayBuffer>();

function readFileAsArrayBuffer(url: string): ArrayBuffer {
    let cached = fileFetchCache.get(url);
    if (!cached) {
        const bytes = readFileSync(fileURLToPath(url));
        cached = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        fileFetchCache.set(url, cached);
    }
    return cached;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.href
            : input.url;

    if (url.startsWith("file://")) {
        const body = readFileAsArrayBuffer(url);
        return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/wasm" }
        });
    }

    return originalFetch(input as RequestInfo, init);
}) as typeof fetch;

WebAssembly.instantiateStreaming = (async (source, importObject) => {
    const response = await source;
    const bytes = await response.arrayBuffer();
    return WebAssembly.instantiate(bytes, importObject);
}) as typeof WebAssembly.instantiateStreaming;

// =============================================================================
// happy-dom HTMLParser spec compliance patch
// =============================================================================
// Per HTML5 parsing spec, a single U+000A LINE FEED immediately after a <pre>,
// <listing>, or <textarea> start tag must be ignored ("newlines at the start
// of pre blocks are ignored as an authoring convenience"). Real browsers and
// domino (which turnish uses in Node) both implement this; happy-dom does not.
// Patch at the DOMParser boundary since turnish prefers DOMParser when it's
// available — patching via module-level HTMLParser import hits a different
// happy-dom copy than the vitest env loaded.
const LEADING_LF_IN_PRE_RE = /(<(?:pre|listing|textarea)\b[^>]*>)(\r\n|\r|\n)/gi;
const originalParseFromString = DOMParser.prototype.parseFromString;
DOMParser.prototype.parseFromString = function (source: string, type: DOMParserSupportedType) {
    const patched = typeof source === "string"
        ? source.replace(LEADING_LF_IN_PRE_RE, "$1")
        : source;
    return originalParseFromString.call(this, patched, type);
};

// =============================================================================
// Core initialization for standalone-flavored tests
// =============================================================================
// Mirror what apps/server/spec/setup.ts does: load the pre-seeded integration
// fixture DB into an in-memory sqlite-wasm instance, then initialize core
// against it with the standalone (browser) providers. Each vitest worker gets
// a fresh copy because tests run in forks (per the default pool).

const require = createRequire(import.meta.url);
const fixtureDb = readFileSync(
    require.resolve("@triliumnext/core/src/test/fixtures/document.db")
);

beforeAll(async () => {
    const sqlProvider = new BrowserSqlProvider();
    await sqlProvider.initWasm();
    sqlProvider.loadFromBuffer(fixtureDb);

    await initializeCore({
        executionContext: new BrowserExecutionContext(),
        crypto: new BrowserCryptoProvider(),
        zip: new BrowserZipProvider(),
        zipExportProviderFactory: (
            await import("./lightweight/zip_export_provider_factory.js")
        ).standaloneZipExportProviderFactory,
        // i18next must be wired up — keyboard_actions.ts and other modules
        // call `t()` and throw if translations are missing. Inline the
        // en/server.json resources via vite's JSON import so we don't need a
        // backend in tests.
        translations: async (i18nextInstance, locale) => {
            await i18nextInstance.init({
                lng: locale,
                fallbackLng: "en",
                ns: "server",
                defaultNS: "server",
                resources: {
                    en: { server: serverEnTranslations }
                }
            });
        },
        platform: new StandalonePlatformProvider(""),
        backup: new StandaloneBackupService(options),
        image: standaloneImageProvider,
        schema: schemaSql,
        dbConfig: {
            provider: sqlProvider,
            isReadOnly: false,
            onTransactionCommit: () => {},
            onTransactionRollback: () => {}
        }
    });
});

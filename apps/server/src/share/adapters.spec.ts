import type { ShareProvider, ShareReply } from "@triliumnext/core/src/share/index.js";
import type { Request, Response, Router } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const SHARE_INDEX = "@triliumnext/core/src/share/index.js";

afterEach(() => {
    vi.doUnmock(SHARE_INDEX);
    vi.doUnmock("./share_provider.js");
    vi.doUnmock("./sql.js");
    vi.doUnmock("better-sqlite3");
    vi.doUnmock("fs");
    vi.doUnmock("../services/data_dir.js");
    vi.doUnmock("../services/sql_init.js");
    vi.doUnmock("../services/utils.js");
    vi.doUnmock("../services/scripting_guard.js");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("share routes", () => {
    it("answers each route with its core handler, after the highlighter for a page", async () => {
        const replies: Record<string, ShareReply> = {
            "/page": { status: 200, headers: { "Content-Type": "text/html" }, body: "<p>page</p>" },
            "/raw": { status: 200, headers: {}, body: new Uint8Array([ 1, 2 ]) },
            "/bare": { status: 302, headers: {}, redirect: "/bare/" },
            "/empty": { status: 404, headers: {} }
        };
        const ensureShareHighlighting = vi.fn(async () => {});
        const registerShareProvider = vi.fn();
        vi.resetModules();
        vi.doMock(SHARE_INDEX, () => ({
            ensureShareHighlighting,
            getShareRoutes: () => Object.keys(replies).map((path) => ({ path })),
            handleShareRequest: (route: { path: string }) => replies[route.path],
            SHARE_PAGE_PATHS: new Set([ "/page" ])
        }));
        vi.doMock("./share_provider.js", () => ({ registerShareProvider }));
        const routes = (await import("./routes.js")).default;
        const handlers = new Map<string, (req: Request, res: Response) => Promise<void>>();
        const router = { get: (path: string, handler: never) => handlers.set(path, handler) };
        routes.register(router as unknown as Router);

        const sent: unknown[][] = [];
        const res = {
            redirect: (url: string) => sent.push([ "redirect", url ]),
            setHeader: (name: string, value: string) => sent.push([ "header", name, value ]),
            sendStatus: (status: number) => sent.push([ "sendStatus", status ]),
            status: (status: number) => ({
                send: (body: unknown) => sent.push([ "send", status, body ])
            })
        } as unknown as Response;
        const req = { path: "/x", params: {}, query: {}, header: () => undefined };
        const request = req as unknown as Request;
        for (const path of Object.keys(replies)) {
            await handlers.get(path)?.(request, res);
        }

        expect(registerShareProvider).toHaveBeenCalledOnce();
        expect(ensureShareHighlighting).toHaveBeenCalledOnce();
        expect(sent).toStrictEqual([
            [ "header", "Content-Type", "text/html" ],
            [ "send", 200, "<p>page</p>" ],
            [ "send", 200, Buffer.from([ 1, 2 ]) ],
            [ "redirect", "/bare/" ],
            [ "sendStatus", 404 ]
        ]);
    });
});

describe("share provider", () => {
    it("registers once and reads each template once, from the sources in development", async () => {
        const { provider, readFileSync } = await registerProvider("development");

        expect(provider.readTemplate("page")).toBe("template");
        expect(provider.readTemplate("page")).toBe("template");
        expect(readFileSync).toHaveBeenCalledOnce();
        expect(String(readFileSync.mock.calls[0][0]).replaceAll("\\", "/"))
            .toMatch(/packages\/share-theme\/src\/templates\/page\.ejs$/);
    });

    it("reads the templates from the resource directory outside development", async () => {
        const { provider, readFileSync } = await registerProvider("production");

        provider.readTemplate("404");

        expect(String(readFileSync.mock.calls[0][0]).replaceAll("\\", "/"))
            .toMatch(/^\/resources\/share-theme\/templates\/404\.ejs$/);
    });

    async function registerProvider(nodeEnv: string) {
        vi.stubEnv("NODE_ENV", nodeEnv);
        const readFileSync = vi.fn((_path: string) => "template");
        const initShare = vi.fn<(provider: ShareProvider) => void>();
        vi.resetModules();
        vi.doMock(SHARE_INDEX, () => ({ initShare }));
        vi.doMock("./sql.js", () => ({ default: {}, isShareDbReady: () => true }));
        vi.doMock("fs", async (importOriginal) => ({
            ...await importOriginal<object>(),
            readFileSync
        }));
        vi.doMock("../services/utils.js", () => ({ getResourceDir: () => "/resources" }));
        vi.doMock("../services/scripting_guard.js", () => ({ isScriptingEnabled: () => false }));
        const { registerShareProvider } = await import("./share_provider.js");
        registerShareProvider();
        registerShareProvider();

        expect(initShare).toHaveBeenCalledOnce();
        return { provider: initShare.mock.calls[0][0], readFileSync };
    }
});

describe("share database", () => {
    it("opens the document read-only once the database is ready, and closes it on exit", async () => {
        const { sql, isShareDbReady, databases, exitHandlers } =
            await loadSql({ documentExists: true });

        expect(isShareDbReady()).toBe(true);
        expect(databases.map(({ path, options }) => [ path, options.readonly ]))
            .toStrictEqual([ [ "/data/document.db", true ] ]);
        expect(sql.getRawRows("raw", [ "a" ])).toStrictEqual([ [ "raw", [ "a" ] ] ]);
        expect(sql.getRow("row")).toStrictEqual([ "row", [] ]);
        expect(sql.getColumn("column")).toStrictEqual([ "column", [] ]);
        expect(sql.getColumn("column", [ "b" ])).toStrictEqual([ "column", [ "b" ] ]);
        expect(sql.getRawRows("raw")).toStrictEqual([ [ "raw", [] ] ]);
        expect(sql.getRow("row", [ "c" ])).toStrictEqual([ "row", [ "c" ] ]);

        expect(exitHandlers.map(([ event ]) => event))
            .toStrictEqual([ "exit", "SIGINT", "SIGUSR1", "SIGUSR2", "SIGTERM" ]);
        exitHandlers[0][1]();
        expect(databases[0].close).toHaveBeenCalledOnce();
    });

    it("falls back to the fixture in tests, and stays closed without a document", async () => {
        const fixture = await loadSql({ documentExists: false });
        expect(fixture.databases[0].path.replaceAll("\\", "/"))
            .toMatch(/trilium-core\/src\/test\/fixtures\/document\.db$/);

        vi.restoreAllMocks();
        vi.stubEnv("TRILIUM_INTEGRATION_TEST", "");
        const missing = await loadSql({ documentExists: false });
        expect(missing.databases).toHaveLength(0);
        expect(missing.isShareDbReady()).toBe(false);
        expect(() => missing.sql.getRow("row"))
            .toThrow("Share database connection is not yet ready.");
    });

    async function loadSql({ documentExists }: { documentExists: boolean }) {
        const databases: { path: string; options: { readonly: boolean }; close: () => void }[] = [];
        const exitHandlers: [ string, () => void ][] = [];
        vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
            exitHandlers.push([ event, handler ]);
            return process;
        }) as typeof process.on);
        vi.resetModules();
        vi.doMock("better-sqlite3", () => ({
            default: class {
                close = vi.fn();
                constructor(path: string, options: { readonly: boolean }) {
                    databases.push({ path, options, close: this.close });
                }
                prepare(query: string) {
                    return {
                        raw: () => ({ all: (params: string[]) => [ [ query, params ] ] }),
                        get: (params: string[]) => [ query, params ],
                        pluck: () => ({ all: (params: string[]) => [ query, params ] })
                    };
                }
            }
        }));
        vi.doMock("fs", async (importOriginal) => ({
            ...await importOriginal<object>(),
            existsSync: () => documentExists
        }));
        vi.doMock("../services/data_dir.js", () => ({
            default: { DOCUMENT_PATH: "/data/document.db" }
        }));
        vi.doMock("../services/sql_init.js", () => ({ default: { dbReady: Promise.resolve() } }));
        const { default: sql, isShareDbReady } = await import("./sql.js");
        await Promise.resolve();
        return { sql, isShareDbReady, databases, exitHandlers };
    }
});

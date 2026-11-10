import { EventEmitter } from "events";
import fs from "fs";
import http from "http";
import https from "https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    port: 8080,
    host: "0.0.0.0",
    isElectron: false,
    cpus: [] as Array<{ model?: string; speed: number }>,
    messaging: {} as Record<string, unknown>,
    platform: {} as { crash: (message: string) => void; shouldIgnoreStartupError?: (error: Error) => boolean },
    config: {
        Network: {} as {
            https?: boolean;
            keyPath?: string;
            certPath?: string;
            trustedReverseProxy?: boolean | string;
        }
    }
}));

const mocks = vi.hoisted(() => ({
    log: { info: vi.fn(), warn: vi.fn() },
    compareVersions: vi.fn(),
    wsInit: vi.fn(),
    buildApp: vi.fn(),
    startCpuProfiler: vi.fn(),
    writeCpuProfile: vi.fn(),
    registerOcrHandlers: vi.fn(),
    registerServerLlmExtensions: vi.fn(),
    listListeningUrls: vi.fn(),
    installProcessErrorHandlers: vi.fn(),
    markAppReady: vi.fn(),
    isScriptingEnabled: vi.fn(),
    publishHealthcheckTarget: vi.fn(),
    sessionParser: vi.fn()
}));

vi.mock("@triliumnext/core", () => ({
    app_info: {
        appVersion: "1.2.3",
        dbVersion: 233,
        syncVersion: 36,
        clipperProtocolVersion: "1.0",
        buildDate: "build-date",
        buildRevision: "0123456789abcdef",
        dataDirectory: "/data",
        utcDateTime: "now"
    },
    getLog: () => mocks.log,
    getMessagingProvider: () => state.messaging,
    getPlatform: () => state.platform,
    utils: {
        compareVersions: mocks.compareVersions,
        formatUtcTime: (time: string) => `utc(${time})`,
        formatSize: (size: number) => `${size} B`
    },
    ws: { init: mocks.wsInit }
}));
vi.mock("os", async (importOriginal) => ({
    ...await importOriginal<typeof import("os")>(),
    cpus: () => state.cpus,
    networkInterfaces: () => ({ lo: [] })
}));
vi.mock("./app.js", () => ({ default: mocks.buildApp }));
vi.mock("./log_provider.js", () => ({ TRILIUM_LOGO: "LOGO" }));
vi.mock("./services/config.js", () => ({ default: state.config }));
vi.mock("./services/data_dir.js", () => ({ default: { TRILIUM_DATA_DIR: "/data" } }));
vi.mock("./services/cpu_profiler.js", () => ({
    startCpuProfiler: mocks.startCpuProfiler,
    writeCpuProfile: mocks.writeCpuProfile
}));
vi.mock("./services/handlers.js", () => ({ registerOcrHandlers: mocks.registerOcrHandlers }));
vi.mock("./services/host.js", () => ({ get default() { return state.host; } }));
vi.mock("./services/port.js", () => ({ get default() { return state.port; } }));
vi.mock("./services/llm/index.js", () => ({ registerServerLlmExtensions: mocks.registerServerLlmExtensions }));
vi.mock("./services/network_addresses.js", () => ({ listListeningUrls: mocks.listListeningUrls }));
vi.mock("./services/process_errors.js", () => ({
    installProcessErrorHandlers: mocks.installProcessErrorHandlers,
    markAppReady: mocks.markAppReady
}));
vi.mock("./services/scripting_guard.js", () => ({ isScriptingEnabled: mocks.isScriptingEnabled }));
vi.mock("./services/utils.js", () => ({ get isElectron() { return state.isElectron; } }));
vi.mock("./services/healthcheck.js", () => ({ publishHealthcheckTarget: mocks.publishHealthcheckTarget }));
vi.mock("./services/sql_init.js", () => ({ getDbSize: () => 2 }));
vi.mock("./routes/session_parser.js", () => ({ default: mocks.sessionParser }));

import startTriliumServer from "./www.js";

class FakeServer extends EventEmitter {
    keepAliveTimeout = 0;
    listen = vi.fn();
    address = vi.fn(() => ({ address: "::", family: "IPv6", port: state.port }));
}

class FakeApp {
    private settings = new Map<string, unknown>();
    set(key: string, value: unknown) {
        this.settings.set(key, value);
    }
    get(key: string) {
        return this.settings.get(key);
    }
}

describe("startTriliumServer", () => {
    let app: FakeApp;
    let servers: FakeServer[];
    let signals: Record<string, () => void>;
    let stdinListeners: Record<string, () => void>;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(state, {
            port: 8080,
            host: "0.0.0.0",
            isElectron: false,
            cpus: [ { model: "Fast CPU   ", speed: 3000 }, { model: "Fast CPU   ", speed: 3000 } ],
            messaging: { attachToHttpServer: vi.fn() },
            platform: { crash: vi.fn() }
        });
        state.config.Network = { https: false };
        mocks.compareVersions.mockReturnValue(1);
        mocks.startCpuProfiler.mockReturnValue(null);
        mocks.isScriptingEnabled.mockReturnValue(false);
        mocks.listListeningUrls.mockReturnValue({ local: "http://localhost:8080", network: [] });

        app = new FakeApp();
        mocks.buildApp.mockResolvedValue(app);

        servers = [];
        const createServer = () => {
            const server = new FakeServer();
            servers.push(server);
            return server as never;
        };
        vi.spyOn(http, "createServer").mockImplementation(createServer);
        vi.spyOn(https, "createServer").mockImplementation(createServer);
        vi.spyOn(fs, "existsSync").mockReturnValue(false);

        signals = {};
        const processOn = process.on;
        vi.spyOn(process, "on").mockImplementation(function (event: string | symbol, listener: (...args: any[]) => void) {
            if (event === "SIGINT" || event === "SIGTERM") {
                signals[event] = listener as () => void;
                return process;
            }
            return processOn.call(process, event, listener);
        } as typeof process.on);
        stdinListeners = {};
        vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
        vi.spyOn(process.stdin, "on").mockImplementation(function (event: string | symbol, listener: () => void) {
            stdinListeners[String(event)] = listener;
            return process.stdin;
        } as typeof process.stdin.on);
        vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    function infoLines() {
        return mocks.log.info.mock.calls.map(([ line ]) => line as string);
    }

    function lastServer() {
        const server = servers.at(-1);
        expect(server).toBeDefined();
        return server as FakeServer;
    }

    it("introduces itself, serves HTTP on the configured port and finishes startup", async () => {
        expect(await startTriliumServer()).toBe(app);

        expect(infoLines()).toEqual([
            "\nLOGO 1.2.3\n",
            "📦 Versions:    app=1.2.3 db=233 sync=36 clipper=1.0",
            "🔧 Build:       utc(build-date) (0123456789)",
            "📂 Data dir:    /data",
            "⏰ UTC time:    utc(now)",
            "💻 CPU:         Fast CPU (2-core @ 3000 Mhz)",
            "💾 DB size:     2048 B",
            expect.stringMatching(/^Backend script execution is DISABLED/),
            "",
            "Trusted reverse proxy: undefined",
            "App HTTP server starting up at port 8080"
        ]);
        expect(mocks.log.warn).not.toHaveBeenCalled();

        const server = lastServer();
        expect(http.createServer).toHaveBeenCalledWith(app);
        expect(server.listen).toHaveBeenCalledWith(8080, "0.0.0.0");
        expect(server.keepAliveTimeout).toBe(600_000);
        expect(app.get("port")).toBe(8080);
        expect(app.get("host")).toBe("0.0.0.0");

        expect(state.messaging.attachToHttpServer).toHaveBeenCalledWith(server, mocks.sessionParser);
        expect(mocks.installProcessErrorHandlers.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.buildApp.mock.invocationCallOrder[0]);
        for (const step of [ mocks.wsInit, mocks.registerOcrHandlers, mocks.registerServerLlmExtensions ]) {
            expect(step.mock.invocationCallOrder[0]).toBeLessThan(mocks.markAppReady.mock.invocationCallOrder[0]);
        }
        expect(process.stdin.resume).not.toHaveBeenCalled();
    });

    it("tolerates a missing CPU model or CPU list, warns about scripting, and skips WebSocket for an IPC provider", async () => {
        state.cpus = [ { speed: 1200 } ];
        state.messaging = {};
        mocks.isScriptingEnabled.mockReturnValue(true);

        await startTriliumServer();

        expect(infoLines()).toContain("💻 CPU:          (1-core @ 1200 Mhz)");
        expect(mocks.log.warn).toHaveBeenCalledWith(expect.stringMatching(/^Backend script execution is ENABLED/));
        expect(mocks.markAppReady).toHaveBeenCalledOnce();

        mocks.log.info.mockClear();
        state.cpus = [];
        await startTriliumServer();

        expect(infoLines().some((line) => line.includes("CPU:"))).toBe(false);
    });

    it("trusts a reverse proxy only when one is configured", async () => {
        const cases: Array<[ boolean | string | undefined, unknown ]> = [
            [ undefined, undefined ],
            [ true, true ],
            [ "loopback", "loopback" ],
            [ "   ", undefined ]
        ];

        for (const [ trustedReverseProxy, expected ] of cases) {
            app = new FakeApp();
            mocks.buildApp.mockResolvedValue(app);
            state.config.Network = { trustedReverseProxy };

            await startTriliumServer();

            expect(app.get("trust proxy")).toBe(expected);
            expect(mocks.log.info).toHaveBeenCalledWith(`Trusted reverse proxy: ${expected}`);
        }
    });

    it("requires a key and a certificate for HTTPS, and serves HTTPS with them", async () => {
        const missing: Array<[ { keyPath?: string; certPath?: string }, string ]> = [
            [ {}, "keyPath in config.ini is required when https=true, but it's empty" ],
            [ { keyPath: "  " }, "keyPath in config.ini is required when https=true, but it's empty" ],
            [ { keyPath: "key.pem" }, "certPath in config.ini is required when https=true, but it's empty" ],
            [ { keyPath: "key.pem", certPath: " " }, "certPath in config.ini is required when https=true, but it's empty" ]
        ];
        for (const [ paths, message ] of missing) {
            state.config.Network = { https: true, ...paths };
            await expect(startTriliumServer()).rejects.toThrow(message);
        }
        expect(servers).toHaveLength(0);

        vi.spyOn(fs, "readFileSync").mockImplementation(((file: string) => Buffer.from(`contents of ${file}`)) as never);
        state.config.Network = { https: true, keyPath: "key.pem", certPath: "cert.pem" };

        await startTriliumServer();

        expect(https.createServer).toHaveBeenCalledWith({
            key: Buffer.from("contents of key.pem"),
            cert: Buffer.from("contents of cert.pem")
        }, app);
        expect(mocks.log.info).toHaveBeenCalledWith("App HTTPS server starting up at port 8080");

        lastServer().emit("listening");

        expect(mocks.listListeningUrls).toHaveBeenCalledWith("https", "0.0.0.0", 8080, { lo: [] });
        expect(mocks.publishHealthcheckTarget).toHaveBeenCalledWith("/data", lastServer().address(), true);
    });

    it("prints the URLs it listens on to the console, except on desktop or in a container", async () => {
        await startTriliumServer();
        const server = lastServer();

        mocks.listListeningUrls.mockReturnValueOnce({
            local: "http://localhost:8080",
            network: [ "http://192.168.1.2:8080", "http://10.0.0.2:8080" ]
        });
        server.emit("listening");

        expect(mocks.log.info).toHaveBeenCalledWith("Listening on port 8080");
        expect(mocks.listListeningUrls).toHaveBeenCalledWith("http", "0.0.0.0", 8080, { lo: [] });
        expect(vi.mocked(console.log).mock.calls).toEqual([
            [ "🌐 Local:       http://localhost:8080" ],
            [ "🌐 Network:     http://192.168.1.2:8080" ],
            [ "                http://10.0.0.2:8080" ]
        ]);
        expect(mocks.publishHealthcheckTarget).toHaveBeenCalledWith("/data", server.address(), false);

        vi.mocked(console.log).mockClear();
        mocks.listListeningUrls.mockReturnValueOnce({ local: null, network: [ "http://192.168.1.2:8080" ] });
        server.emit("listening");
        expect(vi.mocked(console.log).mock.calls).toEqual([ [ "🌐 Network:     http://192.168.1.2:8080" ] ]);

        // Desktop, Docker and Podman each suppress the list.
        mocks.listListeningUrls.mockClear();
        state.isElectron = true;
        server.emit("listening");
        state.isElectron = false;
        for (const marker of [ "/.dockerenv", "/run/.containerenv" ]) {
            vi.mocked(fs.existsSync).mockImplementation((file) => file === marker);
            server.emit("listening");
        }
        expect(mocks.listListeningUrls).not.toHaveBeenCalled();
        expect(mocks.publishHealthcheckTarget).toHaveBeenCalledTimes(5);
    });

    it("listens on a unix socket when the port is 0", async () => {
        state.port = 0;
        state.host = "/run/trilium.sock";

        await startTriliumServer();
        const server = lastServer();
        server.emit("listening");

        expect(server.listen).toHaveBeenCalledWith("/run/trilium.sock");
        expect(mocks.log.info).toHaveBeenCalledWith("Listening on unix socket /run/trilium.sock");
        expect(mocks.listListeningUrls).not.toHaveBeenCalled();
        expect(mocks.publishHealthcheckTarget).toHaveBeenCalledWith("/data", server.address(), false);
    });

    it("crashes with a readable message when the server fails to start", async () => {
        state.host = "203.0.113.9";
        await startTriliumServer();
        const server = lastServer();
        const crash = vi.mocked(state.platform.crash);

        const errors: Array<[ Error, string ]> = [
            [ Object.assign(new Error("listen EACCES"), { code: "EACCES" }),
                "Port 8080 requires elevated privileges. It's recommended to use port above 1024." ],
            [ Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }),
                "Port 8080 is already in use. Most likely, another Trilium process is already running. You might try to find it, kill it, and try again." ],
            [ Object.assign(new Error("listen EADDRNOTAVAIL"), { code: "EADDRNOTAVAIL" }),
                "Unable to start the server on host '203.0.113.9'. Make sure the host (defined in 'config.ini' or via the 'TRILIUM_HOST' environment variable) is an IP address that can be listened on." ],
            [ Object.assign(new Error("unexpected"), { code: "ECONNRESET", stack: "the stack" }), "the stack" ],
            [ Object.assign(new Error("no code"), { stack: "" }), "An unexpected error has occurred." ]
        ];
        for (const [ error ] of errors) {
            server.emit("error", error);
        }

        expect(crash.mock.calls.map(([ message ]) => message)).toEqual(
            errors.map(([ , message ]) => `Error while initializing the server: ${message}`)
        );
    });

    it("only reports a startup error the platform chooses to ignore", async () => {
        const shouldIgnoreStartupError = vi.fn(() => true);
        state.platform = { crash: vi.fn(), shouldIgnoreStartupError };
        await startTriliumServer();
        const error = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });

        lastServer().emit("error", error);

        expect(shouldIgnoreStartupError).toHaveBeenCalledWith(error);
        expect(state.platform.crash).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^Port 8080 is already in use/));
    });

    it("refuses to start on a Node.js older than the minimum", async () => {
        mocks.compareVersions.mockReturnValue(-1);

        await startTriliumServer();

        expect(mocks.compareVersions).toHaveBeenCalledWith(process.versions.node, "20.0.0");
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("requires Node.js 20.0.0 and later"));
        expect(console.error).toHaveBeenCalledWith(`\tCurrent version:\t${process.versions.node}`);
        expect(vi.mocked(process.exit).mock.calls[0]).toEqual([ 1 ]);
        expect(vi.mocked(process.exit).mock.invocationCallOrder[0])
            .toBeLessThan(mocks.buildApp.mock.invocationCallOrder[0]);
    });

    it("exits once on the first termination signal, after the CPU profile is written", async () => {
        await startTriliumServer();

        signals.SIGINT();
        signals.SIGTERM();

        expect(console.log).toHaveBeenCalledExactlyOnceWith("Caught interrupt/termination signal. Exiting.");
        expect(mocks.writeCpuProfile).toHaveBeenCalledExactlyOnceWith(null, expect.any(Function));
        expect(process.exit).not.toHaveBeenCalled();

        const done = mocks.writeCpuProfile.mock.calls[0][1] as () => void;
        done();
        expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("writes the CPU profile and exits when Enter is pressed while profiling", async () => {
        const session = { profiler: true };
        mocks.startCpuProfiler.mockReturnValue(session);

        await startTriliumServer();

        expect(process.stdin.resume).toHaveBeenCalledOnce();
        stdinListeners.data();

        expect(console.log).toHaveBeenCalledWith("Writing CPU profile and exiting (TRILIUM_PROFILE).");
        expect(mocks.writeCpuProfile).toHaveBeenCalledWith(session, expect.any(Function));
    });
});

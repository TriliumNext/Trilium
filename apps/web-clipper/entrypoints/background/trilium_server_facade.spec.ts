import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import TriliumServerFacade, { TriliumError } from "./trilium_server_facade";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const SERVER = { triliumServerUrl: "https://trilium.example", authToken: "secret" };
const LOCAL_DATE_TIME = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/;

type PopupMessage = { name: string, triliumSearch?: unknown, searchNote?: unknown };
const sendMessage = vi.fn(async (_message: PopupMessage) => {});

describe("TriliumServerFacade", () => {
    beforeEach(() => {
        fakeBrowser.reset();
        vi.useFakeTimers();
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        sendMessage.mockReset();
        Object.assign(fakeBrowser.runtime, { sendMessage });
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    describe("search for Trilium", () => {
        it("finds the desktop app on the default port and reports it to the popup", async () => {
            fetchMock.mockResolvedValue(handshake("1.0"));

            await createFacade();

            expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:37743/api/clipper/handshake");
            expect(searchStatuses()).toEqual([
                { status: "searching" },
                { status: "found-desktop", port: 37743, url: "http://127.0.0.1:37743" }
            ]);
        });

        it("looks for a production desktop app on its own port", async () => {
            vi.stubEnv("DEV", false);
            fetchMock.mockResolvedValue(handshake("1.0"));

            await createFacade();

            expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:37840/api/clipper/handshake");
        });

        it("uses the configured desktop port and searches again every minute", async () => {
            await fakeBrowser.storage.sync.set({ triliumDesktopPort: "12345" });
            fetchMock.mockResolvedValue(handshake("1.2"));

            await createFacade();
            expect(fetchMock)
                .toHaveBeenLastCalledWith("http://127.0.0.1:12345/api/clipper/handshake");

            await vi.advanceTimersByTimeAsync(60 * 1000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("reports a protocol version mismatch", async () => {
            fetchMock.mockResolvedValue(handshake("2.0"));

            await createFacade();

            expect(lastSearchStatus()).toEqual({
                status: "version-mismatch",
                extensionMajor: 1,
                triliumMajor: 2
            });
        });

        it("falls back to the configured server with its token", async () => {
            await fakeBrowser.storage.sync.set(SERVER);
            fetchMock.mockImplementation(async (url) => {
                if (url.startsWith("http://127.0.0.1")) throw new Error("connection refused");
                return handshake("1.0");
            });

            await createFacade();

            expect(fetchMock).toHaveBeenLastCalledWith(
                "https://trilium.example/api/clipper/handshake",
                { headers: { Authorization: "secret" } });
            expect(lastSearchStatus()).toEqual({
                status: "found-server",
                url: "https://trilium.example",
                token: "secret"
            });
        });

        it("reports not-found when neither the desktop app nor the server is Trilium", async () => {
            await fakeBrowser.storage.sync.set(SERVER);
            fetchMock.mockImplementation(async () => Response.json({ appName: "other" }));
            await createFacade();
            expect(lastSearchStatus()).toEqual({ status: "not-found" });
            expect(fetchMock).toHaveBeenLastCalledWith(
                "https://trilium.example/api/clipper/handshake", { headers: { Authorization: "secret" } });
            expect(console.log).not.toHaveBeenCalledWith(
                "Request to the configured server instance failed with:", expect.anything());

            fetchMock.mockReset();
            fetchMock.mockImplementation(async (url) => {
                if (url.startsWith("http://127.0.0.1")) return new Response("not json");
                throw new Error("server down");
            });
            await createFacade();
            expect(lastSearchStatus()).toEqual({ status: "not-found" });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("skips the server when no URL or token is configured", async () => {
            await fakeBrowser.storage.sync.set({ triliumServerUrl: "https://trilium.example" });
            fetchMock.mockRejectedValue(new Error("connection refused"));

            await createFacade();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(lastSearchStatus()).toEqual({ status: "not-found" });
        });

        it("ignores the popup being closed", async () => {
            sendMessage.mockRejectedValue(new Error("Could not establish connection"));
            fetchMock.mockResolvedValue(handshake("1.0"));

            const facade = await createFacade();
            await expect(facade.sendTriliumSearchNoteToPopup()).resolves.toBeUndefined();
        });
    });

    describe("callService", () => {
        it("sends JSON with the token and the local time to the found server", async () => {
            await fakeBrowser.storage.sync.set(SERVER);
            fetchMock.mockImplementation(async (url) => {
                if (url.startsWith("http://127.0.0.1")) throw new Error("connection refused");
                if (url.endsWith("/handshake")) return handshake("1.0");
                return Response.json({ noteId: "n1" });
            });
            const facade = await createFacade();

            await expect(facade.callService("POST", "clippings", { title: "T" }))
                .resolves.toEqual({ noteId: "n1" });
            const clippingsUrl = "https://trilium.example/api/clipper/clippings";
            expect(fetchMock).toHaveBeenLastCalledWith(clippingsUrl, {
                method: "POST",
                headers: {
                    Authorization: "secret",
                    "Content-Type": "application/json",
                    "trilium-local-now-datetime": expect.stringMatching(LOCAL_DATE_TIME)
                },
                body: JSON.stringify({ title: "T" })
            });

            await facade.callService("POST", "notes", "raw body");
            expect(fetchMock.mock.lastCall?.[1]?.body).toBe("raw body");

            await facade.callService("GET", "notes-by-url/x");
            expect(fetchMock.mock.lastCall?.[1]).not.toHaveProperty("body");
        });

        it("sends no token to the desktop app and reports why a request failed", async () => {
            fetchMock.mockResolvedValue(handshake("1.0"));
            const facade = await createFacade();
            const openNote = () => facade.callService("POST", "open/abc");

            const notFound = Response.json({ message: "Note 'abc' not found" }, { status: 404 });
            fetchMock.mockResolvedValue(notFound);
            await expect(openNote()).rejects.toThrow(requestFailed("Note 'abc' not found"));
            expect(fetchMock).toHaveBeenLastCalledWith(
                "http://127.0.0.1:37743/api/clipper/open/abc",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "" })
                }));

            fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
            await expect(openNote()).rejects.toThrow(requestFailed("Bad gateway"));

            fetchMock.mockResolvedValue(new Response("", { status: 500 }));
            await expect(openNote()).rejects.toThrow(requestFailed("500"));

            fetchMock.mockRejectedValue(new Error("connection reset"));
            await expect(openNote()).rejects.toThrow(requestFailed("connection reset"));

            fetchMock.mockRejectedValue("offline");
            await expect(openNote()).rejects.toThrow(requestFailed("offline"));
        });

        it("waits for a running search and rejects once Trilium is not found", async () => {
            let answerHandshake: (response: Response) => void = () => {};
            fetchMock.mockReturnValueOnce(new Promise((resolve) => answerHandshake = resolve));
            const facade = new TriliumServerFacade();

            const call = facade.callService("GET", "notes-by-url/x");
            await vi.advanceTimersByTimeAsync(1500);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            fetchMock.mockResolvedValue(Response.json({ noteId: "n1" }));
            answerHandshake(handshake("1.0"));
            await vi.advanceTimersByTimeAsync(500);
            await expect(call).resolves.toEqual({ noteId: "n1" });

            fetchMock.mockReset();
            fetchMock.mockRejectedValue(new Error("connection refused"));
            await facade.triggerSearchForTrilium();
            await expect(facade.callService("GET", "notes-by-url/x"))
                .rejects.toThrow(expect.objectContaining({ reason: "not-found" }));
        });

        it("rejects while Trilium has a different protocol version, naming the side to update", async () => {
            fetchMock.mockResolvedValue(handshake("0.9"));
            const facade = await createFacade();

            const call = facade.callService("GET", "notes-by-url/x");
            await expect(call).rejects.toBeInstanceOf(TriliumError);
            await expect(call).rejects.toThrow(expect.objectContaining({
                reason: "version-mismatch",
                message: expect.stringContaining("Update Trilium to the latest version.")
            }));
            expect(fetchMock).toHaveBeenCalledTimes(1);

            fetchMock.mockResolvedValue(handshake("2.0"));
            await facade.triggerSearchForTrilium();
            await expect(facade.callService("GET", "notes-by-url/x")).rejects.toThrow(
                expect.objectContaining({ message: expect.stringContaining("Update the web clipper") }));
        });
    });

    it("looks up the note saved for a URL and reports it to the popup", async () => {
        fetchMock.mockResolvedValue(handshake("1.0"));
        const facade = await createFacade();

        fetchMock.mockResolvedValue(Response.json({ noteId: "n1" }));
        await facade.triggerSearchNoteByUrl("https://example.com/a?b=c");
        expect(fetchMock).toHaveBeenLastCalledWith(
            "http://127.0.0.1:37743/api/clipper/notes-by-url/https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc",
            expect.objectContaining({ method: "GET" }));
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "trilium-previously-visited",
            searchNote: { status: "found", noteId: "n1" }
        });

        const notFound = {
            name: "trilium-previously-visited",
            searchNote: { status: "not-found", noteId: null }
        };
        fetchMock.mockResolvedValue(Response.json({ noteId: null }));
        await facade.triggerSearchNoteByUrl("https://example.com/b");
        expect(sendMessage).toHaveBeenLastCalledWith(notFound);

        sendMessage.mockClear();
        fetchMock.mockRejectedValue(new Error("connection reset"));
        await facade.triggerSearchNoteByUrl("https://example.com/c");
        expect(sendMessage).toHaveBeenLastCalledWith(notFound);
    });

    it("formats the local time with the time zone offset", async () => {
        fetchMock.mockResolvedValue(handshake("1.0"));
        const facade = await createFacade();
        vi.setSystemTime(new Date("2026-03-04T10:20:30.456Z"));

        const offsets: [ number, string ][] = [
            [ -120, "2026-03-04 12:20:30.456+02:00" ],
            [ 300, "2026-03-04 05:20:30.456-05:00" ],
            [ 0, "2026-03-04 10:20:30.456+00:00" ],
            [ -330, "2026-03-04 15:50:30.456+05:30" ],
            [ -345, "2026-03-04 16:05:30.456+05:45" ],
            [ 210, "2026-03-04 06:50:30.456-03:30" ],
            [ -630, "2026-03-04 20:50:30.456+10:30" ]
        ];
        const getTimezoneOffset = vi.spyOn(Date.prototype, "getTimezoneOffset");
        for (const [ offset, expected ] of offsets) {
            getTimezoneOffset.mockReturnValue(offset);
            expect.soft(facade.localNowDateTime(), `offset ${offset}`).toBe(expected);
        }
    });
});

function requestFailed(message: string) {
    return expect.objectContaining({
        reason: "request-failed",
        message: expect.stringContaining(message)
    });
}

function handshake(protocolVersion: string) {
    return Response.json({ appName: "trilium", protocolVersion });
}

async function createFacade() {
    sendMessage.mockClear();
    const facade = new TriliumServerFacade();
    await vi.waitFor(() => expect(lastSearchStatus()?.status).not.toBe("searching"));
    return facade;
}

function searchStatuses() {
    return sendMessage.mock.calls
        .map(([ message ]) => message)
        .filter((message) => message.name === "trilium-search-status")
        .map((message) => message.triliumSearch);
}

function lastSearchStatus() {
    return searchStatuses().at(-1) as { status: string } | undefined;
}

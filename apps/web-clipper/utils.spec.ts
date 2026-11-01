import type { Window as HappyDOMWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
    createLink, describeError, extractPage, getPageLocationOrigin, isPdfTab, OPTIONAL_REQUEST_TIMEOUT_MS,
    randomString
} from "./utils";

describe("randomString", () => {
    it("returns alphanumeric strings of the requested length", () => {
        expect(randomString(0)).toBe("");
        expect(randomString(20)).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(randomString(20)).not.toBe(randomString(20));
    });
});

describe("getPageLocationOrigin", () => {
    afterEach(() => setUrl("about:blank"));

    it("returns the page's origin, and file:// for local files", () => {
        setUrl("https://example.com:8080/dir/page.html?q=1#hash");
        expect(getPageLocationOrigin()).toBe("https://example.com:8080");

        setUrl("file:///home/user/page.html");
        expect(getPageLocationOrigin()).toBe("file://");
    });
});

describe("createLink", () => {
    it("sends the click action to the extension", () => {
        const sendMessage = vi.spyOn(fakeBrowser.runtime, "sendMessage")
            .mockResolvedValue(undefined);
        const action = { name: "openNoteInTrilium", noteId: "abc" };

        const link = createLink(action, "Open");
        expect(link.textContent).toBe("Open");
        expect(link.style.color).toBe("lightskyblue");
        expect(createLink(action, "Close", "tomato").style.color).toBe("tomato");

        link.click();
        expect(sendMessage).toHaveBeenCalledWith(null, action);
    });
});


describe("extractPage", () => {
    afterEach(() => {
        Reflect.deleteProperty(fakeBrowser, "scripting");
        Reflect.deleteProperty(globalThis, "triliumReadPage");
    });

    it("injects the readable-page script, then reads the page as asked", async () => {
        const page = { title: "Article", content: "<p>Body</p>" };
        const readPage = vi.fn((variant: string) => variant === "article" ? page : undefined);
        const executeScript = vi.fn(async ({ func, args }: { func?: (variant: string) => unknown, args?: [ string ] }) => {
            if (!func || !args) return [];
            Object.assign(globalThis, { triliumReadPage: readPage });
            return [ { result: func(...args) } ];
        });
        Object.assign(fakeBrowser, { scripting: { executeScript } });

        expect(await extractPage(7, "article")).toBe(page);
        expect(executeScript.mock.calls.map(([ injection ]) => injection)).toEqual([
            { target: { tabId: 7 }, files: [ "/readable-page.js" ] },
            { target: { tabId: 7 }, func: expect.any(Function), args: [ "article" ] }
        ]);
        expect(await extractPage(7, "wholePage")).toBeUndefined();
        expect(readPage.mock.calls).toEqual([ [ "article" ], [ "wholePage" ] ]);

        executeScript.mockResolvedValue([]);
        expect(await extractPage(7, "article")).toBeUndefined();
    });
});


describe("describeError", () => {
    it("names the cause of whatever was thrown", () => {
        expect(describeError(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
        expect(describeError(new DOMException("", "AbortError"))).toBe("AbortError");
        expect(describeError({ message: "Could not establish connection." })).toBe("Could not establish connection.");
        expect(describeError({ message: "" })).toBe("[object Object]");
        expect(describeError("Too tall")).toBe("Too tall");
        expect(describeError(undefined)).toBe("undefined");
    });
});

describe("isPdfTab", () => {
    const TAB = { id: 7, url: "https://example.com/report" };
    const executeScript = vi.fn(async ({ func }: { func: () => unknown }) => [ { result: func() } ]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null));

    beforeEach(() => {
        Object.assign(fakeBrowser, { scripting: { executeScript } });
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        Reflect.deleteProperty(fakeBrowser, "scripting");
        document.body.innerHTML = "";
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("asks the page around Chrome's viewer what it shows", async () => {
        expect(await isPdfTab(TAB)).toBe(false);
        expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, func: expect.any(Function) });

        document.body.innerHTML = `<embed type="application/pdf" src="https://example.com/a.pdf">`;
        expect(await isPdfTab(TAB)).toBe(false);
        document.body.innerHTML = `<embed type="application/pdf" src="about:blank">`;
        expect(await isPdfTab(TAB)).toBe(true);

        document.body.innerHTML = "";
        vi.spyOn(document, "contentType", "get").mockReturnValue("application/pdf");
        expect(await isPdfTab(TAB)).toBe(true);

        executeScript.mockResolvedValueOnce([]);
        expect(await isPdfTab(TAB)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks the website where the browser runs no script, as in Firefox's viewer", async () => {
        executeScript.mockRejectedValue(new Error("Missing host permission for the tab"));
        const answer = (contentType?: string) => fetchMock.mockImplementation(async () =>
            new Response(null, { headers: contentType ? { "Content-Type": contentType } : {} }));

        answer("Application/PDF; qs=0.001");
        expect(await isPdfTab(TAB)).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(TAB.url, {
            method: "HEAD", credentials: "include", signal: expect.any(AbortSignal)
        });

        answer("text/html");
        expect(await isPdfTab(TAB)).toBe(false);
        answer();
        expect(await isPdfTab(TAB)).toBe(false);
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        expect(await isPdfTab(TAB)).toBe(false);
    });

    it("gives up on a website that does not answer in time", async () => {
        executeScript.mockRejectedValue(new Error("Missing host permission for the tab"));
        const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort());
        fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.signal?.aborted
            ? Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))
            : new Promise(() => {})));

        expect(await isPdfTab(TAB)).toBe(false);
        expect(timeout).toHaveBeenCalledWith(OPTIONAL_REQUEST_TIMEOUT_MS);
    });

    it("checks only web pages in a tab it can address", async () => {
        expect(await isPdfTab({ id: 7, url: "chrome://settings" })).toBe(false);
        expect(await isPdfTab({ id: 7 })).toBe(false);
        expect(await isPdfTab({ url: TAB.url })).toBe(false);
        expect(executeScript).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function setUrl(url: string) {
    (window as unknown as HappyDOMWindow).happyDOM.setURL(url);
}

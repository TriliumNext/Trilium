import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { Options, requestToken } from "./main";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
let container: HTMLElement;

describe("options page", () => {
    beforeEach(() => {
        fakeBrowser.reset();
        vi.stubGlobal("fetch", fetchMock);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(() => render(null, container));
        container.remove();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it("saves the desktop port and rejects an invalid one", async () => {
        await browser.storage.sync.set({ triliumDesktopPort: "12345" });
        await renderOptions();
        expect(input("#trilium-desktop-port").value).toBe("12345");

        await type("#trilium-desktop-port", "70000");
        await submit(0);
        expect(message()).toEqual({ className: "message message-error", text: "Please enter valid port number." });
        expect(await stored("triliumDesktopPort")).toBe("12345");

        await type("#trilium-desktop-port", " 37841 ");
        await submit(0);
        expect(message()).toEqual({ className: "message message-success", text: "Port number has been saved." });
        expect(await stored("triliumDesktopPort")).toBe("37841");

        await type("#trilium-desktop-port", "");
        await submit(0);
        expect(await stored("triliumDesktopPort")).toBe("");
    });

    it("logs in to a server, asking for the code when it requires one", async () => {
        await renderOptions();
        await submit(1);
        expect(message()?.text).toContain("Please fill in server URL and password.");
        expect(fetchMock).not.toHaveBeenCalled();

        await type("input[type=text]:not(#trilium-desktop-port)", " https://trilium.example/// ");
        await type("input[type=password]", "secret");
        fetchMock.mockResolvedValueOnce(Response.json({ message: "Incorrect credential", factor: "totp" }, { status: 401 }));
        await submit(1);
        expect(fetchMock).toHaveBeenCalledWith("https://trilium.example/api/login/token", expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ password: "secret", totpToken: "" })
        }));
        expect(message()?.text).toMatch(/^Two-factor authentication is enabled/);
        expect(document.activeElement).toBe(input("input[autocomplete=one-time-code]"));

        await type("input[autocomplete=one-time-code]", "000000");
        fetchMock.mockResolvedValueOnce(Response.json({ message: "Incorrect credential", factor: "totp" }, { status: 401 }));
        await submit(1);
        expect(message()?.text).toBe("Incorrect authentication code.");
        expect(input("input[autocomplete=one-time-code]").value).toBe("");

        await type("input[autocomplete=one-time-code]", "123456");
        fetchMock.mockResolvedValueOnce(Response.json({ token: "etapi-token" }));
        await submit(1);
        expect(message()).toEqual({
            className: "message message-success",
            text: "Authentication against Trilium server has been successful."
        });
        expect(await stored("triliumServerUrl")).toBe("https://trilium.example");
        expect(await stored("authToken")).toBe("etapi-token");
        expect(container.querySelector("strong a")?.getAttribute("href")).toBe("https://trilium.example");

        await act(async () => {
            const resetLink = [ ...container.querySelectorAll("a") ].find((a) => a.textContent === "remove the current setup");
            expect(resetLink).toBeDefined();
            resetLink?.click();
        });
        await flush();
        expect(await stored("authToken")).toBe("");
        expect(message()).toBeNull();
        expect(container.querySelector("input[type=password]")).not.toBeNull();
    });

    it("shows the configured server, which needs both an address and a token", async () => {
        await browser.storage.sync.set({ triliumServerUrl: "https://trilium.example", authToken: "" });
        await renderOptions();
        expect(container.querySelector("strong")).toBeNull();
        expect(container.querySelector("input[type=password]")).not.toBeNull();
        await act(() => render(null, container));

        await browser.storage.sync.set({ authToken: "t" });
        await renderOptions();
        expect(container.querySelector("strong")?.textContent)
            .toBe("Trilium server instance has been already configured to https://trilium.example.");
        expect(container.querySelector("input[type=password]")).toBeNull();
    });
});

describe("requestToken", () => {
    beforeEach(() => vi.stubGlobal("fetch", fetchMock));
    afterEach(() => vi.unstubAllGlobals());

    it("tells each way the login can end apart", async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ token: "t" }));
        expect(await requestToken("https://s", "p", "")).toEqual({ kind: "token", token: "t" });

        fetchMock.mockResolvedValueOnce(Response.json({ message: "Incorrect credential", factor: "password" }, { status: 401 }));
        expect(await requestToken("https://s", "p", "")).toEqual({ kind: "rejected" });

        // Servers that do not report the failed factor answer with a plain string.
        fetchMock.mockResolvedValueOnce(new Response("Incorrect credential", { status: 401 }));
        expect(await requestToken("https://s", "p", "")).toEqual({ kind: "rejected" });

        fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
        expect(await requestToken("https://s", "p", "")).toEqual({ kind: "unexpected-status", status: 502 });

        fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        expect(await requestToken("https://s", "p", "")).toEqual({ kind: "network-error", message: "Failed to fetch" });
    });
});

async function renderOptions() {
    await act(() => render(<Options />, container));
    await flush();
}

/** Lets the storage reads and writes the effects and handlers start settle. */
async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}

function input(selector: string) {
    const element = container.querySelector<HTMLInputElement>(selector);
    expect(element, selector).not.toBeNull();
    return element as HTMLInputElement;
}

async function type(selector: string, value: string) {
    const element = input(selector);
    await act(() => {
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function submit(formIndex: number) {
    const form = container.querySelectorAll("form")[formIndex];
    expect(form).toBeDefined();
    await act(() => {
        form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
}

function message() {
    const element = container.querySelector(".message");
    return element ? { className: element.className, text: element.textContent } : null;
}

async function stored(key: string) {
    return (await browser.storage.sync.get<Record<string, unknown>>(key))[key];
}

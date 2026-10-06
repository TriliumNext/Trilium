import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const serverMock = vi.hoisted(() => ({
    // The eager module-load fetches the import graph makes (options, keyboard actions). This screen
    // asks for nothing through `server` itself — it reads the status of its own `fetch`.
    get: vi.fn(async (url: string): Promise<unknown> => (url === "keyboard-actions" ? [] : {})),
    post: vi.fn(async (_url: string, _body?: unknown): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

const setSetupAuthToken = vi.hoisted(() => vi.fn());
vi.mock("./services/setup_auth", () => ({ setSetupAuthToken }));

import SetupUnlock from "./setup_unlock";

let container: HTMLDivElement;
const onUnlocked = vi.fn();

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function renderScreen() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<SetupUnlock onUnlocked={onUnlocked} />, container);

    return container;
}

function password(): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>("input[type=password]");
}

function submit() {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

/** The answer that unlocks, which most cases want and none of them vary. */
const UNLOCKED = { status: 200, body: { authenticated: true, token: "a-token" } };

/** What `POST /api/setup/auth` answers with, or a connection that never reached it. */
function answerWith(resp: { status: number; body?: unknown } | "reject") {
    const fn = resp === "reject"
        ? vi.fn().mockRejectedValue(new Error("network down"))
        : vi.fn().mockResolvedValue({
            ok: resp.status >= 200 && resp.status < 300,
            status: resp.status,
            json: async () => resp.body ?? {}
        });
    globalThis.fetch = fn as typeof fetch;

    return fn;
}

/** The body of the single call the screen made. */
function sentBody(fn: ReturnType<typeof answerWith>) {
    return JSON.parse(fn.mock.calls[0]?.[1]?.body as string);
}

beforeEach(() => {
    vi.useFakeTimers();
    onUnlocked.mockReset();
    setSetupAuthToken.mockReset();
    serverMock.post.mockReset();
    answerWith(UNLOCKED);
    window.glob.setupSecondFactorRequired = undefined;
});

afterEach(() => {
    render(null, container);
    container.remove();
    window.glob.setupSecondFactorRequired = undefined;
    vi.useRealTimers();
});

describe("unlocking a wizard that is standing over a knowledge base", () => {
    it("asks the one question the login screen asks, and says nothing else about it", async () => {
        renderScreen();
        await settle();

        expect(container.textContent).toContain("login.heading");
        expect(container.textContent).toContain("login.password");
        // Explaining why would only invite the user to read it as a different question.
        expect(container.textContent).not.toContain("setup.unlock-description");
        // Autofilled by a password manager the same way the login screen's field is.
        expect(password()?.getAttribute("autocomplete")).toBe("current-password");
    });

    it("takes the token the password bought and carries on", async () => {
        renderScreen();
        await settle();

        const fetchFn = answerWith(UNLOCKED);

        const input = password();
        if (input) {
            input.value = "hunter2";
        }
        submit();
        await settle();

        expect(fetchFn.mock.calls[0]?.[0]).toBe("api/setup/auth");
        expect(sentBody(fetchFn)).toEqual({ password: "hunter2", totpToken: "" });
        expect(setSetupAuthToken).toHaveBeenCalledWith("a-token");
        expect(onUnlocked).toHaveBeenCalled();
    });

    it("says so and stays put on a wrong password, so the next attempt is a keystroke away", async () => {
        answerWith({ status: 401, body: { authenticated: false } });
        renderScreen();
        await settle();

        submit();
        await settle();

        expect(container.querySelector(".page-error")?.textContent).toContain("setup.unlock-refused");
        expect(setSetupAuthToken).not.toHaveBeenCalled();
        expect(onUnlocked).not.toHaveBeenCalled();
        expect(password()).not.toBeNull();
    });

    it("says so on a connection that failed, which a wrong password never looks like", async () => {
        // A refused password is a status, not a rejection: `fetch` rejects only below HTTP.
        answerWith("reject");
        renderScreen();
        await settle();

        submit();
        await settle();

        expect(container.querySelector(".page-error")?.textContent).toContain("login.connection-error");
        expect(onUnlocked).not.toHaveBeenCalled();
    });

    it("reports the limiter's refusal as a wait, not as an unreachable server", async () => {
        // 429 is the limiter, and only reachable because a refusal is a 401 that it counts.
        // Reported apart from a wrong answer, and apart from a dead link.
        answerWith({ status: 429 });
        renderScreen();
        await settle();

        submit();
        await settle();

        const error = container.querySelector(".page-error")?.textContent;
        expect(error).toContain("login.too-many-attempts");
        expect(onUnlocked).not.toHaveBeenCalled();
    });

    it("refuses the answer where the server said yes but handed nothing over", async () => {
        answerWith({ status: 200, body: { authenticated: true } });
        renderScreen();
        await settle();

        submit();
        await settle();

        expect(setSetupAuthToken).not.toHaveBeenCalled();
        expect(onUnlocked).not.toHaveBeenCalled();
    });

    it("does not ask twice over while an answer is still coming", async () => {
        // The button is disabled while it runs, but Enter in the field is a second way in.
        let answer: (value: unknown) => void = () => {};
        const fetchFn = vi.fn(() => new Promise((resolve) => {
            answer = resolve;
        }));
        globalThis.fetch = fetchFn as unknown as typeof fetch;
        renderScreen();
        await settle();

        submit();
        await settle();
        submit();
        await settle();

        expect(fetchFn).toHaveBeenCalledOnce();

        answer({ ok: true, status: 200, json: async () => UNLOCKED.body });
        await settle();
        expect(onUnlocked).toHaveBeenCalled();
    });

    describe("where the instance guards itself with a second factor as well", () => {
        beforeEach(() => {
            window.glob.setupSecondFactorRequired = true;
        });

        it("asks for it beside the password, as the login screen does", async () => {
            renderScreen();
            await settle();

            const totp = container.querySelector<HTMLInputElement>("input[name=totpToken]");
            expect(totp).not.toBeNull();
            // The same field the login screen offers, so an authenticator fills it the same way.
            expect(totp?.getAttribute("autocomplete")).toBe("one-time-code");
        });

        it("sends what was typed into it, whether a passcode or a recovery code", async () => {
            renderScreen();
            await settle();

            const fetchFn = answerWith(UNLOCKED);

            const totp = container.querySelector<HTMLInputElement>("input[name=totpToken]");
            if (totp) {
                totp.value = "123456";
            }
            submit();
            await settle();

            expect(sentBody(fetchFn)).toEqual({ password: "", totpToken: "123456" });
        });

        it("is not asked for where the instance has none", async () => {
            window.glob.setupSecondFactorRequired = undefined;
            renderScreen();
            await settle();

            expect(container.querySelector("input[name=totpToken]")).toBeNull();
        });
    });

    it("reads the password off the field at submit time, not from state", async () => {
        // A controlled value of "" overwrites what the browser autofilled, so the first press would
        // submit an empty password — the "incorrect password, press again" bug the login screen hit.
        renderScreen();
        await settle();

        const fetchFn = answerWith(UNLOCKED);

        const input = password();
        if (input) {
            input.value = "filled-in-by-the-browser";
        }
        submit();
        await settle();

        expect(sentBody(fetchFn)).toEqual({ password: "filled-in-by-the-browser", totpToken: "" });
    });
});

import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const serverMock = vi.hoisted(() => ({
    // `get` is here for the eager module-load fetches the import graph makes (options, keyboard
    // actions), not for anything this screen asks for itself.
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

beforeEach(() => {
    vi.useFakeTimers();
    onUnlocked.mockReset();
    setSetupAuthToken.mockReset();
    serverMock.post.mockReset().mockResolvedValue({ authenticated: true, token: "a-token" });
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

        const input = password();
        if (input) {
            input.value = "hunter2";
        }
        submit();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/auth", { password: "hunter2", totpToken: "" });
        expect(setSetupAuthToken).toHaveBeenCalledWith("a-token");
        expect(onUnlocked).toHaveBeenCalled();
    });

    it("says so and stays put on a wrong password, so the next attempt is a keystroke away", async () => {
        serverMock.post.mockResolvedValue({ authenticated: false });
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
        // A refused password is answered, not thrown. Anything landing here is the connection, or
        // the rate limiter counting the attempts.
        serverMock.post.mockRejectedValue(new Error("network down"));
        renderScreen();
        await settle();

        submit();
        await settle();

        expect(container.querySelector(".page-error")?.textContent).toContain("login.connection-error");
        expect(onUnlocked).not.toHaveBeenCalled();
    });

    it("refuses the answer where the server said yes but handed nothing over", async () => {
        serverMock.post.mockResolvedValue({ authenticated: true });
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
        serverMock.post.mockImplementation(() => new Promise((resolve) => {
            answer = resolve;
        }));
        renderScreen();
        await settle();

        submit();
        await settle();
        submit();
        await settle();

        expect(serverMock.post).toHaveBeenCalledOnce();

        answer({ authenticated: true, token: "a-token" });
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

            const totp = container.querySelector<HTMLInputElement>("input[name=totpToken]");
            if (totp) {
                totp.value = "123456";
            }
            submit();
            await settle();

            expect(serverMock.post).toHaveBeenCalledWith("setup/auth", { password: "", totpToken: "123456" });
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

        const input = password();
        if (input) {
            input.value = "filled-in-by-the-browser";
        }
        submit();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/auth", { password: "filled-in-by-the-browser", totpToken: "" });
    });
});

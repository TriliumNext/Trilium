import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/i18n", () => ({
    t: (key: string) => key,
    initLocale: vi.fn(),
    getCurrentLanguage: () => "en"
}));

import { App, getSetupToken } from "./setup_account";

const fetchMock = vi.fn<typeof fetch>();

let container: HTMLDivElement;

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
});

/** Answers the link check, then whatever the password submission should get. */
function respond(check: Response, submission?: Response) {
    fetchMock.mockImplementation(async (url) => (String(url).endsWith("/check") ? check : submission ?? new Response(null, { status: 204 })));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Lets the fetches and the body reads behind them finish, which take more than one tick each. */
async function settle() {
    for (let i = 0; i < 5; i++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
}

async function open(token = "tok") {
    await act(async () => {
        render(<App token={token} />, container);
    });
    await settle();
}

async function typeInto(input: HTMLInputElement | undefined, value: string) {
    await act(async () => {
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

const passwordBoxes = () => [ ...container.querySelectorAll<HTMLInputElement>("input[type='password']") ];

describe("the setup-account screen", () => {
    it("refuses a link the server does not know, without showing the form", async () => {
        respond(json({ message: "invalid" }, 404));
        await open();

        expect(container.textContent).toContain("setup_account.invalid-heading");
        expect(passwordBoxes()).toHaveLength(0);
    });

    it("names the account, sets the password, and keeps the token out of the URL it posts to", async () => {
        respond(json({ username: "alice", expiresAt: "2026-11-08 10:00:00.000Z" }));
        await open("secret-token");

        expect(container.querySelector<HTMLInputElement>("input[autocomplete='username']")?.value).toBe("alice");
        const button = container.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(button?.disabled).toBe(true);

        const [ password1, password2 ] = passwordBoxes();
        await typeInto(password1, "hunter22");
        await typeInto(password2, "hunter22");
        expect(button?.disabled).toBe(false);

        await act(async () => container.querySelector("form")?.requestSubmit());
        await settle();

        expect(fetchMock.mock.calls.map(([ url ]) => url)).toEqual([ "api/setup-account/check", "api/setup-account" ]);
        expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
            token: "secret-token", password1: "hunter22", password2: "hunter22"
        });
        expect(container.textContent).toContain("setup_account.done-heading");
    });

    it("explains a rate limit without leaving the form, and a link spent meanwhile as invalid", async () => {
        respond(json({ username: "alice", expiresAt: "2026-11-08 10:00:00.000Z" }), new Response(null, { status: 429 }));
        await open();

        for (const box of passwordBoxes()) await typeInto(box, "hunter22");
        await act(async () => container.querySelector("form")?.requestSubmit());
        await settle();
        expect(container.textContent).toContain("setup_account.too-many-attempts");
        expect(passwordBoxes()).toHaveLength(2);

        respond(json({}), new Response(null, { status: 404 }));
        await act(async () => container.querySelector("form")?.requestSubmit());
        await settle();
        expect(container.textContent).toContain("setup_account.invalid-heading");
    });

    it("reads the token from the link's query string", () => {
        expect(getSetupToken("?setupAccount=abc123")).toBe("abc123");
        expect(getSetupToken("?login")).toBe("");
    });
});

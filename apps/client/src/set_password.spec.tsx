import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/i18n", () => ({
    t: (key: string) => key,
    initLocale: vi.fn(),
    getCurrentLanguage: () => "en"
}));

import { App } from "./set_password";

let container: HTMLDivElement;
function renderInto(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}
afterEach(() => { render(null, container); container.remove(); });

// Controlled inputs update state asynchronously, so flush before asserting on the re-render.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(c: HTMLElement) {
    c.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
    );
}

/** The response of `POST set-password`, or a connection failure. */
function answerWith(status: number | "reject") {
    const fn = status === "reject"
        ? vi.fn().mockRejectedValue(new Error("network down"))
        : vi.fn().mockResolvedValue({ ok: status < 300, status });
    globalThis.fetch = fn as typeof fetch;
    return fn;
}

describe("set-password App", () => {
    function fields(c: HTMLElement) {
        const [password1, password2] = Array.from(c.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
        const button = c.querySelector('button[type="submit"]') as HTMLButtonElement;
        return { password1, password2, button };
    }

    it("enables submit only when the passwords match and meet the minimum length", async () => {
        const c = renderInto(<App />);
        const { password1, password2, button } = fields(c);

        expect(button.disabled).toBe(true); // both empty

        typeInto(password1, "abc"); // below the 4-char minimum
        await flush();
        expect(button.disabled).toBe(true);
        expect(c.textContent).toContain("set_password.password-too-short");

        typeInto(password1, "abcd");
        typeInto(password2, "abce"); // mismatch
        await flush();
        expect(button.disabled).toBe(true);
        expect(c.textContent).toContain("set_password.passwords-dont-match");

        typeInto(password2, "abcd"); // matching + long enough
        await flush();
        expect(button.disabled).toBe(false);
    });

    it("posts to the set-password route once valid, and opens the app when taken", async () => {
        const fetchFn = answerWith(200);
        const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
        const c = renderInto(<App />);

        submit(c);
        await flush();
        expect(fetchFn).not.toHaveBeenCalled();

        const { password1, password2 } = fields(c);
        typeInto(password1, "abcd");
        typeInto(password2, "abcd");
        await flush();
        submit(c);
        await flush();

        expect(fetchFn.mock.calls[0]?.[0]).toBe("set-password");
        expect(String(fetchFn.mock.calls[0]?.[1]?.body)).toBe("password1=abcd&password2=abcd");
        expect(assign).toHaveBeenCalledWith(".");
    });

    it("says why a password was not taken", async () => {
        const c = renderInto(<App />);
        const { password1, password2 } = fields(c);
        typeInto(password1, "abcd");
        typeInto(password2, "abcd");
        await flush();

        for (const [ answer, message ] of [
            [ 400, "set_password.refused" ],
            [ 429, "login.too-many-attempts" ],
            [ "reject", "login.connection-error" ]
        ] as const) {
            answerWith(answer);
            submit(c);
            await flush();
            expect(c.textContent).toContain(message);
        }
    });

    it("asks for the password a knowledge base had when only the password is removed", async () => {
        const glob = window.glob;
        window.glob = { ...glob, passwordRemoved: true };
        try {
            const fetchFn = answerWith(400);
            const c = renderInto(<App />);
            expect(c.textContent).toContain("set_password.restore-description");
            const { password1, password2 } = fields(c);
            expect(password2).toBeUndefined();

            typeInto(password1, "the-old-one");
            await flush();
            submit(c);
            await flush();

            expect(String(fetchFn.mock.calls[0]?.[1]?.body))
                .toBe("password1=the-old-one&password2=the-old-one");
            expect(c.textContent).toContain("set_password.restore-refused");
        } finally {
            window.glob = glob;
        }
    });

    it("points a browser on a desktop instance to the desktop app instead of offering the form", () => {
        const glob = window.glob;
        window.glob = { ...glob, setPasswordInDesktopApp: true };
        try {
            const c = renderInto(<App />);
            expect(c.textContent).toContain("set_password.desktop-description");
            expect(c.querySelector("form")).toBeNull();
            expect(c.querySelector('input[type="password"]')).toBeNull();
        } finally {
            window.glob = glob;
        }
    });
});

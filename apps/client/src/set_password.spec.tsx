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

    it("submits to the set-password route via a native POST form, but only once valid", async () => {
        const c = renderInto(<App />);
        const form = c.querySelector("form");
        expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
        expect(form?.getAttribute("action")).toBe("set-password");

        // Invalid → the form blocks its own submission.
        const blocked = new Event("submit", { bubbles: true, cancelable: true });
        form?.dispatchEvent(blocked);
        expect(blocked.defaultPrevented).toBe(true);

        // Valid → submission is allowed through to the server.
        const { password1, password2 } = fields(c);
        typeInto(password1, "abcd");
        typeInto(password2, "abcd");
        await flush();
        const allowed = new Event("submit", { bubbles: true, cancelable: true });
        form?.dispatchEvent(allowed);
        expect(allowed.defaultPrevented).toBe(false);
    });
});

import type { EtapiToken } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // Held in a box so the GET can read whatever the scenario set. Replacing the shared server mock
    // means answering what the modules pulled in alongside the page ask for on import, too — the
    // options load and the keyboard actions, both of which expect a particular shape.
    const tokens: { current: unknown[] } = { current: [] };

    return {
        tokens,
        get: vi.fn(async (url: string) => {
            if (url === "etapi-tokens") return tokens.current;
            if (url === "keyboard-actions") return [];
            return {};
        }),
        post: vi.fn(async () => ({ authToken: "fresh-token" })),
        patch: vi.fn(async () => ({})),
        remove: vi.fn(async () => ({})),
        prompt: vi.fn(async () => "A token"),
        confirm: vi.fn(async () => true)
    };
});

vi.mock("../../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post, patch: mocks.patch, remove: mocks.remove }
}));

vi.mock("../../../services/dialog", () => ({
    default: { prompt: mocks.prompt, confirm: mocks.confirm }
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

import EtapiSettings from "./etapi";

let host: HTMLElement;

beforeEach(() => {
    mocks.tokens.current = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

async function open() {
    await act(async () => {
        render(<EtapiSettings />, host);
    });
}

const tokenRows = () => [ ...host.querySelectorAll(".tn-card-option") ];

describe("the ETAPI token page with none yet", () => {
    it("says so on the page itself rather than inside an empty card", async () => {
        await open();

        expect(host.querySelector(".no-items")).not.toBeNull();
        expect(host.querySelector(".tn-card")).toBeNull();
    });

    it("still offers the way to make one, since that is what the page is for", async () => {
        await open();

        // In the header rather than the list: with no list there would be nowhere else for it.
        const create = host.querySelector<HTMLButtonElement>(".header-stub button[name='create-etapi-token-button']");
        expect(create).not.toBeNull();

        await act(async () => create?.click());
        expect(mocks.post).toHaveBeenCalledWith("etapi-tokens", { tokenName: "A token" });
    });
});

describe("the ETAPI tokens once there are some", () => {
    beforeEach(() => {
        mocks.tokens.current = [
            { etapiTokenId: "abc", name: "Laptop", utcDateCreated: "2025-01-02 03:04:05.000Z" },
            { etapiTokenId: "def", name: "Phone", utcDateCreated: "2025-02-03 04:05:06.000Z" }
        ] satisfies EtapiToken[];
    });

    it("gives each token a segment of its own, named and dated", async () => {
        await open();

        expect(host.querySelector(".no-items")).toBeNull();
        expect(tokenRows()).toHaveLength(2);
        expect(tokenRows().map((row) => row.querySelector("label")?.firstChild?.textContent)).toEqual([ "Laptop", "Phone" ]);
    });

    it("marks only the destructive action as such, so the two are told apart at a glance", async () => {
        await open();

        const [ rename, remove ] = [ ...tokenRows()[0].querySelectorAll("button") ];
        expect(rename.className).not.toContain("destructive-action-icon");
        expect(remove.className).toContain("destructive-action-icon");
    });

    it("renames the token that was pressed, leaving the others alone", async () => {
        await open();
        const [ rename ] = [ ...tokenRows()[1].querySelectorAll("button") ];

        await act(async () => rename.click());
        expect(mocks.patch).toHaveBeenCalledWith("etapi-tokens/def", { name: "A token" });
    });

    it("asks before deleting, and does nothing at all when the answer is no", async () => {
        mocks.confirm.mockResolvedValueOnce(false);
        await open();
        const remove = [ ...tokenRows()[0].querySelectorAll("button") ][1];

        await act(async () => remove.click());
        expect(mocks.confirm).toHaveBeenCalled();
        expect(mocks.remove).not.toHaveBeenCalled();

        await act(async () => remove.click());
        expect(mocks.remove).toHaveBeenCalledWith("etapi-tokens/abc");
    });
});

describe("naming a new token", () => {
    it("refuses a blank name rather than creating one that cannot be told apart", async () => {
        mocks.prompt.mockResolvedValueOnce("   ");
        await open();

        await act(async () => host.querySelector<HTMLButtonElement>("button[name='create-etapi-token-button']")?.click());
        expect(mocks.post).not.toHaveBeenCalled();
    });
});

import type { EtapiToken } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});
vi.mock("../../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));
vi.mock("../../../services/dialog", () => ({
    default: { prompt: vi.fn(), confirm: vi.fn() }
}));
vi.mock("../../../services/toast", () => ({
    default: { showError: vi.fn() }
}));

import Component from "../../../components/component";
import dialog from "../../../services/dialog";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { ParentComponent } from "../../react/react_utils";
import EtapiSettings from "./etapi";

// --- Render harness: mount the component under a real ParentComponent so useTriliumEvent works ----

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderComponent() {
    const localParent = new Component();
    const localContainer = document.createElement("div");
    parent = localParent;
    container = localContainer;
    document.body.appendChild(localContainer);
    act(() => {
        render(
            <ParentComponent.Provider value={localParent}>
                <EtapiSettings />
            </ParentComponent.Provider>,
            localContainer
        );
    });
    return localContainer;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        const p = parent;
        if (p) {
            (p.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
        }
    });
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

const mockedDialog = dialog as unknown as { prompt: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };
const mockedToast = toast as unknown as { showError: ReturnType<typeof vi.fn> };

function makeToken(overrides: Partial<EtapiToken> = {}): EtapiToken {
    return {
        etapiTokenId: "tok1",
        name: "My token",
        utcDateCreated: "2024-01-02T03:04:05.000Z",
        ...overrides
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    // setup.ts's auto-mock only defines get/post — add the verbs this component uses.
    Object.assign(server, {
        get: vi.fn(async () => [] as EtapiToken[]),
        post: vi.fn(async () => ({ authToken: "auth-token-value" })),
        patch: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined)
    });
    mockedDialog.prompt.mockResolvedValue(null);
    mockedDialog.confirm.mockResolvedValue(false);
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("EtapiSettings", () => {
    it("renders the section, fetches tokens on mount, and shows the empty placeholder", async () => {
        const root = renderComponent();
        await flush();

        // OptionsSection wrapper + a create button + the existing-tokens heading.
        expect(root.querySelector(".options-section")).toBeTruthy();
        expect(root.querySelector("button.btn")).toBeTruthy();
        expect(root.querySelector("h5")).toBeTruthy();
        expect(server.get).toHaveBeenCalledWith("etapi-tokens");

        // No tokens → no table, the empty-state div is rendered instead.
        expect(root.querySelector("table")).toBeNull();
    });

    it("renders a table row per token with rename/delete actions", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeToken({ etapiTokenId: "tok1", name: "Alpha" }),
            makeToken({ etapiTokenId: "tok2", name: "Beta" })
        ]);
        const root = renderComponent();
        await flush();

        const table = root.querySelector("table");
        expect(table).toBeTruthy();
        const bodyRows = root.querySelectorAll("tbody tr");
        expect(bodyRows.length).toBe(2);
        // Each token row has a name cell and two action buttons (rename + delete).
        const firstRowButtons = bodyRows[0].querySelectorAll("button");
        expect(firstRowButtons.length).toBe(2);
        expect((bodyRows[0].querySelector("td")?.textContent ?? "")).toBe("Alpha");
    });

    it("omits action buttons for a token without an id", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeToken({ etapiTokenId: undefined, name: "NoId" })
        ]);
        const root = renderComponent();
        await flush();

        const bodyRows = root.querySelectorAll("tbody tr");
        expect(bodyRows.length).toBe(1);
        // The conditional `etapiTokenId && (...)` falls through → no action buttons.
        expect(bodyRows[0].querySelectorAll("button").length).toBe(0);
    });

    it("refreshes the token list when an entitiesReloaded event reports token changes", async () => {
        const root = renderComponent();
        await flush();
        expect(server.get).toHaveBeenCalledTimes(1);

        // A reload with token changes triggers another fetch.
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([ makeToken({ name: "Refreshed" }) ]);
        fireEvent("entitiesReloaded", { loadResults: { hasEtapiTokenChanges: true } });
        await flush();
        expect(server.get).toHaveBeenCalledTimes(2);
        expect(root.querySelector("tbody td")?.textContent).toBe("Refreshed");

        // A reload without token changes is ignored.
        fireEvent("entitiesReloaded", { loadResults: { hasEtapiTokenChanges: false } });
        await flush();
        expect(server.get).toHaveBeenCalledTimes(2);
    });

    it("creates a token: prompts for a name, posts it, and shows the created token", async () => {
        mockedDialog.prompt
            .mockResolvedValueOnce("New Token")   // name prompt
            .mockResolvedValueOnce(null);          // token-created display prompt
        const root = renderComponent();
        await flush();

        const createBtn = root.querySelector("button.btn");
        if (!(createBtn instanceof HTMLButtonElement)) throw new Error("create button missing");
        await act(async () => { createBtn.click(); });
        await flush();

        expect(mockedDialog.prompt).toHaveBeenCalledTimes(2);
        expect(server.post).toHaveBeenCalledWith("etapi-tokens", { tokenName: "New Token" });
        expect(mockedToast.showError).not.toHaveBeenCalled();
    });

    it("aborts token creation and shows an error when the name is blank", async () => {
        mockedDialog.prompt.mockResolvedValueOnce("   "); // whitespace only → treated as empty
        const root = renderComponent();
        await flush();

        const createBtn = root.querySelector("button.btn");
        if (!(createBtn instanceof HTMLButtonElement)) throw new Error("create button missing");
        await act(async () => { createBtn.click(); });
        await flush();

        expect(mockedToast.showError).toHaveBeenCalled();
        expect(server.post).not.toHaveBeenCalled();
    });

    it("renames a token: prompts and patches when a new name is given, no-ops when blank", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([ makeToken({ etapiTokenId: "tokR", name: "Old" }) ]);
        const root = renderComponent();
        await flush();

        const renameBtn = root.querySelectorAll("tbody tr button")[0];
        if (!(renameBtn instanceof HTMLButtonElement)) throw new Error("rename button missing");

        // Non-blank → patch.
        mockedDialog.prompt.mockResolvedValueOnce("Renamed");
        await act(async () => { renameBtn.click(); });
        await flush();
        expect(server.patch).toHaveBeenCalledWith("etapi-tokens/tokR", { name: "Renamed" });

        // Blank → no further patch.
        mockedDialog.prompt.mockResolvedValueOnce("  ");
        await act(async () => { renameBtn.click(); });
        await flush();
        expect(server.patch).toHaveBeenCalledTimes(1);
    });

    it("deletes a token after confirmation, and skips when not confirmed", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([ makeToken({ etapiTokenId: "tokD", name: "Doomed" }) ]);
        const root = renderComponent();
        await flush();

        const deleteBtn = root.querySelectorAll("tbody tr button")[1];
        if (!(deleteBtn instanceof HTMLButtonElement)) throw new Error("delete button missing");

        // Not confirmed → no remove.
        mockedDialog.confirm.mockResolvedValueOnce(false);
        await act(async () => { deleteBtn.click(); });
        await flush();
        expect(server.remove).not.toHaveBeenCalled();

        // Confirmed → remove.
        mockedDialog.confirm.mockResolvedValueOnce(true);
        await act(async () => { deleteBtn.click(); });
        await flush();
        expect(server.remove).toHaveBeenCalledWith("etapi-tokens/tokD");
    });
});

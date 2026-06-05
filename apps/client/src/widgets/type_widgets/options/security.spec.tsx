import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import options from "../../../services/options";
import server from "../../../services/server";
import SecuritySettings from "./security";

// --- Render harness ------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(vnode as preact.ComponentChild, container as HTMLDivElement);
    });
    return container;
}

/** Settle async effect chains (option setters → server.put) and the resulting re-render. */
async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

interface SecurityApi {
    setBackendScriptingEnabled: ReturnType<typeof vi.fn>;
    setSqlConsoleEnabled: ReturnType<typeof vi.fn>;
}

/** Installs a fake `window.electronApi` so `isElectron()` returns true. Returns the security stub. */
function installElectron(confirmed: boolean): { security: SecurityApi; restartApp: ReturnType<typeof vi.fn> } {
    const restartApp = vi.fn();
    const security: SecurityApi = {
        setBackendScriptingEnabled: vi.fn(async () => confirmed),
        setSqlConsoleEnabled: vi.fn(async () => confirmed)
    };
    (window as unknown as { electronApi: unknown }).electronApi = {
        security,
        window: { restartApp }
    };
    return { security, restartApp };
}

function removeElectron() {
    delete (window as unknown as { electronApi?: unknown }).electronApi;
}

beforeEach(() => {
    setOptions({ backendScriptingEnabled: "false", sqlConsoleEnabled: "false" });
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined) });
    removeElectron();
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    removeElectron();
    vi.restoreAllMocks();
});

describe("SecuritySettings (browser / non-Electron)", () => {
    it("renders both toggle sections with disabled toggles and config hints, no restart section", () => {
        const root = renderInto(<SecuritySettings />);

        // Two OptionsSections with cards (backend scripting + sql console).
        const sections = root.querySelectorAll(".options-section");
        expect(sections.length).toBeGreaterThanOrEqual(2);

        // Both toggles are present and disabled (not desktop).
        const toggles = root.querySelectorAll<HTMLInputElement>("input.switch-toggle");
        expect(toggles.length).toBe(2);
        for (const toggle of toggles) {
            expect(toggle.disabled).toBe(true);
            expect(toggle.checked).toBe(false);
        }

        // ServerConfigHint renders a Collapsible (with a <pre><code>) when not in Electron.
        expect(root.querySelectorAll(".collapsible").length).toBe(2);
        expect(root.querySelectorAll("pre code").length).toBe(4);

        // No restart-app button outside Electron even with pending changes (can't toggle anyway).
        expect(root.querySelector("[data-trigger-command]")).toBeNull();
        expect(root.textContent).toContain("backendScriptingEnabled=true");
        expect(root.textContent).toContain("TRILIUM_SECURITY_SQL_CONSOLE_ENABLED=true");
    });

    it("reflects live option values as toggle checked state", () => {
        setOptions({ backendScriptingEnabled: "true", sqlConsoleEnabled: "false" });
        const root = renderInto(<SecuritySettings />);
        const toggles = root.querySelectorAll<HTMLInputElement>("input.switch-toggle");
        expect(toggles[0]?.checked).toBe(true);
        expect(toggles[1]?.checked).toBe(false);
    });
});

describe("SecuritySettings (Electron)", () => {
    it("enables toggles, hides config hints, and toggling enabled writes pending + shows restart", async () => {
        const { security, restartApp } = installElectron(true);
        const root = renderInto(<SecuritySettings />);

        const toggles = root.querySelectorAll<HTMLInputElement>("input.switch-toggle");
        expect(toggles.length).toBe(2);
        for (const toggle of toggles) {
            expect(toggle.disabled).toBe(false);
        }

        // ServerConfigHint returns null in Electron — no collapsibles / config snippets.
        expect(root.querySelectorAll(".collapsible").length).toBe(0);
        expect(root.querySelectorAll("pre code").length).toBe(0);

        // No restart section before any change.
        expect(root.querySelector(".options-section.tn-no-card")).toBeNull();

        // Toggle the backend scripting switch ON (live is false → pending true differs).
        const backendToggle = toggles[0];
        if (!backendToggle) throw new Error("missing backend toggle");
        backendToggle.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();

        expect(security.setBackendScriptingEnabled).toHaveBeenCalledWith(true);
        expect(security.setSqlConsoleEnabled).not.toHaveBeenCalled();

        // Restart section (noCard OptionsSection) now visible with a restart button.
        const restartSection = root.querySelector(".options-section.tn-no-card");
        expect(restartSection).not.toBeNull();
        const restartButton = restartSection?.querySelector("button");
        expect(restartButton).not.toBeNull();

        // Clicking restart calls restartDesktopApp → electronApi.window.restartApp().
        restartButton?.click();
        expect(restartApp).toHaveBeenCalledTimes(1);
    });

    it("toggling back to the live value clears pending and removes the restart section", async () => {
        // Start with backend scripting live ON so toggling to OFF, then back ON returns to live.
        setOptions({ backendScriptingEnabled: "true", sqlConsoleEnabled: "false" });
        const { security } = installElectron(true);
        const root = renderInto(<SecuritySettings />);

        const backendToggle = root.querySelectorAll<HTMLInputElement>("input.switch-toggle")[0];
        if (!backendToggle) throw new Error("missing backend toggle");

        // Toggle OFF (pending false, differs from live true) → restart section appears.
        backendToggle.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();
        expect(security.setBackendScriptingEnabled).toHaveBeenLastCalledWith(false);
        expect(root.querySelector(".options-section.tn-no-card")).not.toBeNull();

        // Toggle back ON (pending equals live → cleared) → restart section disappears.
        const toggleAgain = root.querySelectorAll<HTMLInputElement>("input.switch-toggle")[0];
        if (!toggleAgain) throw new Error("missing backend toggle (rerender)");
        toggleAgain.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();
        expect(security.setBackendScriptingEnabled).toHaveBeenLastCalledWith(true);
        expect(root.querySelector(".options-section.tn-no-card")).toBeNull();
    });

    it("toggling the SQL console writes pending state and shows the restart section", async () => {
        const { security } = installElectron(true);
        const root = renderInto(<SecuritySettings />);

        const sqlToggle = root.querySelectorAll<HTMLInputElement>("input.switch-toggle")[1];
        if (!sqlToggle) throw new Error("missing sql toggle");
        sqlToggle.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();

        expect(security.setSqlConsoleEnabled).toHaveBeenCalledWith(true);
        expect(security.setBackendScriptingEnabled).not.toHaveBeenCalled();
        expect(root.querySelector(".options-section.tn-no-card")).not.toBeNull();
    });

    it("does not update pending state when the confirmation is rejected", async () => {
        const { security } = installElectron(false);
        const root = renderInto(<SecuritySettings />);

        const sqlToggle = root.querySelectorAll<HTMLInputElement>("input.switch-toggle")[1];
        if (!sqlToggle) throw new Error("missing sql toggle");
        sqlToggle.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();

        expect(security.setSqlConsoleEnabled).toHaveBeenCalledWith(true);
        // Confirmation rejected → no pending change → no restart section.
        expect(root.querySelector(".options-section.tn-no-card")).toBeNull();
    });
});

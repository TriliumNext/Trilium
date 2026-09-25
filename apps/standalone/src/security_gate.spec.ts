import type { StandaloneSecurityApi } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the page asked the worker to write, and what the worker said back. */
const bridge = vi.hoisted(() => ({
    calls: [] as Array<{ setting: string; enabled: boolean }>,
    /** Resolved with what the worker reports; a pending one is a write still in flight. */
    answer: null as null | ((written: boolean) => void),
    result: true as boolean | "pending"
}));

vi.mock("./local-bridge.js", () => ({
    requestSecurityChange: (setting: string, enabled: boolean) => {
        bridge.calls.push({ setting, enabled });
        if (bridge.result === "pending") {
            return new Promise<boolean>((resolve) => { bridge.answer = resolve; });
        }
        return Promise.resolve(bridge.result);
    }
}));

// The strings are the client's, loaded by the time any of this can be reached. Keys rather than
// English, so an assertion names what the dialog is supposed to say rather than how it is worded.
vi.mock("../../client/src/services/i18n.js", () => ({
    t: (key: string, params?: Record<string, string>) =>
        params ? `${key} ${JSON.stringify(params)}` : key
}));

/** Answers the dialog the way the user would. */
let confirmed: boolean;
let dialogs: string[];

function setUserActivation(activation: { isActive: boolean } | undefined) {
    Object.defineProperty(navigator, "userActivation", { value: activation, configurable: true });
}

/**
 * A fresh page, with `window.confirm` in place before the module captures it — which is the order
 * the real bootstrap runs in, since `main.ts` loads this long before a note's script bundle.
 */
async function loadGate(confirmImpl: unknown = (message: string) => {
    dialogs.push(message);
    return confirmed;
}): Promise<StandaloneSecurityApi> {
    vi.resetModules();
    Object.defineProperty(window, "confirm", {
        value: confirmImpl, configurable: true, writable: true
    });
    return (await import("./security_gate.js")).createSecurityApi();
}

beforeEach(() => {
    bridge.calls = [];
    bridge.answer = null;
    bridge.result = true;
    confirmed = true;
    dialogs = [];
    setUserActivation({ isActive: true });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("a change the user agrees to", () => {
    it("is asked about, then written", async () => {
        const api = await loadGate();

        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(true);

        expect(dialogs).toHaveLength(1);
        expect(bridge.calls).toEqual([ { setting: "backendScriptingEnabled", enabled: true } ]);
    });

    it("names the setting and what it grants, in words the caller cannot supply", async () => {
        const api = await loadGate();

        await api.setBackendScriptingEnabled(true);
        await api.setSqlConsoleEnabled(true);

        expect(dialogs[0]).toContain("security.standalone.confirm_enable");
        expect(dialogs[0]).toContain("security.backend_scripting_title");
        expect(dialogs[0]).toContain("security.standalone.confirm_backend_scripting_warning");
        expect(dialogs[1]).toContain("security.sql_console_title");
        expect(dialogs[1]).toContain("security.standalone.confirm_sql_console_warning");
    });

    it("asks before taking one back, without the warning that belongs to granting", async () => {
        const api = await loadGate();

        await expect(api.setSqlConsoleEnabled(false)).resolves.toBe(true);

        expect(dialogs[0]).toContain("security.standalone.confirm_disable");
        expect(dialogs[0]).not.toContain("warning");
        expect(bridge.calls).toEqual([ { setting: "sqlConsoleEnabled", enabled: false } ]);
    });

    it("is only granted once the worker says it reached the file", async () => {
        bridge.result = false;
        const api = await loadGate();

        // The user agreed, but nothing was written — an unlocked settings file, say. Reporting
        // this as granted would leave the toggle showing something the next start will not do.
        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);
    });
});

describe("a change nobody agreed to", () => {
    it("is refused when the user says no, and nothing reaches the worker", async () => {
        confirmed = false;
        const api = await loadGate();

        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);

        expect(dialogs).toHaveLength(1);
        expect(bridge.calls).toEqual([]);
    });

    it("cannot be answered by a script that replaces window.confirm", async () => {
        confirmed = false;
        const api = await loadGate();

        // What a frontend script would do first. It replaces what the rest of the page sees, but
        // this module captured the function at load, before any note script could run.
        window.confirm = () => true;

        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);
        expect(dialogs).toHaveLength(1);
        expect(bridge.calls).toEqual([]);
    });

    it("never reaches a dialog when nothing the user did led to it", async () => {
        setUserActivation({ isActive: false });
        const api = await loadGate();

        // A script on a timer, or one run at startup: no transient activation, so it is refused
        // before the dialog it would otherwise be spamming.
        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);
        expect(dialogs).toEqual([]);
        expect(bridge.calls).toEqual([]);
    });

    it("still works where the browser tracks no activation at all", async () => {
        // Firefox exposes no `navigator.userActivation`; treating that as "nobody did anything"
        // would leave the toggle dead there, so the dialog and the decline limit carry it.
        setUserActivation(undefined);
        const api = await loadGate();

        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(true);
        expect(dialogs).toHaveLength(1);
    });

    it("is refused outright where there is no dialog to ask with", async () => {
        // `null` rather than `undefined` only because the latter would take the helper's default;
        // what the module checks is that there is no function to call.
        const api = await loadGate(null);

        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);
        expect(bridge.calls).toEqual([]);
    });
});

describe("a script that keeps asking", () => {
    it("runs out of dialogs, so it cannot wear the user down", async () => {
        confirmed = false;
        const api = await loadGate();

        for (let attempt = 0; attempt < 20; attempt++) {
            await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);
        }

        expect(dialogs).toHaveLength(2);
        expect(bridge.calls).toEqual([]);
    });

    it("runs out across both settings together, rather than twice per setting", async () => {
        confirmed = false;
        const api = await loadGate();

        await api.setBackendScriptingEnabled(true);
        await api.setSqlConsoleEnabled(true);
        await api.setBackendScriptingEnabled(true);

        expect(dialogs).toHaveLength(2);
    });

    it("never stands between the user and turning a capability back off", async () => {
        confirmed = false;
        const api = await loadGate();

        // Two declines, which is as far as asking to enable anything gets from here on.
        await api.setBackendScriptingEnabled(true);
        await api.setBackendScriptingEnabled(true);
        expect(dialogs).toHaveLength(2);
        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(false);
        expect(dialogs).toHaveLength(2);

        // Disabling is still asked about, and still works. A user who has just been pestered into
        // the limit is exactly the user who wants this, and a script that keeps asking for it can
        // achieve nothing worse than the capability being turned off.
        confirmed = true;
        await expect(api.setBackendScriptingEnabled(false)).resolves.toBe(true);
        expect(dialogs).toHaveLength(3);
        expect(bridge.calls).toEqual([ { setting: "backendScriptingEnabled", enabled: false } ]);
    });

    it("does not count a declined disable against the limit", async () => {
        confirmed = false;
        const api = await loadGate();

        await api.setBackendScriptingEnabled(false);
        await api.setSqlConsoleEnabled(false);
        await api.setBackendScriptingEnabled(false);

        // Three dialogs, where three declined *enable* requests would have produced two.
        expect(dialogs).toHaveLength(3);

        // And the enable path still has both of its dialogs left.
        await api.setBackendScriptingEnabled(true);
        await api.setBackendScriptingEnabled(true);
        await api.setBackendScriptingEnabled(true);
        expect(dialogs).toHaveLength(5);
    });

    it("does not cost the user the toggle over one misclick", async () => {
        confirmed = false;
        const api = await loadGate();

        await api.setBackendScriptingEnabled(true);
        confirmed = true;

        await expect(api.setBackendScriptingEnabled(true)).resolves.toBe(true);
        expect(bridge.calls).toEqual([ { setting: "backendScriptingEnabled", enabled: true } ]);
    });

    it("cannot raise a second dialog over the answer to the first", async () => {
        bridge.result = "pending";
        const api = await loadGate();

        const first = api.setBackendScriptingEnabled(true);
        await vi.waitFor(() => expect(bridge.answer).not.toBeNull());

        // The user has agreed and the write is in flight. A request arriving now would otherwise
        // put a dialog in front of a user who is looking at the outcome of the last one.
        await expect(api.setSqlConsoleEnabled(true)).resolves.toBe(false);
        expect(dialogs).toHaveLength(1);

        bridge.answer?.(true);
        await expect(first).resolves.toBe(true);

        // And once it has settled, an honest request is asked about again.
        bridge.result = true;
        await expect(api.setSqlConsoleEnabled(true)).resolves.toBe(true);
        expect(dialogs).toHaveLength(2);
    });
});

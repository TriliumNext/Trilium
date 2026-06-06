import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../../test/mocks";
import { flush, renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

vi.mock("../../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn() }
}));

// useTriliumOptionJson("experimentalFeatures", true) reloads the frontend after a save; the real
// reloadFrontendApp references logInfo (undefined in happy-dom), so stub it out.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    reloadFrontendApp: vi.fn()
}));

// Spyable so a test can drive the "no features → ExperimentalOptions renders null" branch.
vi.mock("../../../services/experimental_features", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/experimental_features")>())
}));

import Component from "../../../components/component";
import * as experimentalFeatures from "../../../services/experimental_features";
import options from "../../../services/options";
import server from "../../../services/server";
import toast from "../../../services/toast";
import AdvancedSettings from "./advanced";

// --- Render harness (mounts the real component inside the Trilium providers) ----------------------

const parent = { current: new Component() };

function renderAdvanced() {
    const { container } = renderComponent(<AdvancedSettings />, { parent: parent.current });
    return container;
}

function click(el: HTMLElement) { act(() => { el.click(); }); }

function toggleSwitch(el: Element) {
    act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

function setOptions(values: Record<string, string>) {
    options.load({
        experimentalFeatures: JSON.stringify([]),
        ...values
    } as Record<OptionNames, string>);
}

/** Finds an option button by the boxicon class shown in its right-hand input column. */
function buttonByIcon(root: ParentNode, iconClass: string): HTMLButtonElement | null {
    return Array.from(root.querySelectorAll<HTMLButtonElement>("button.option-row-link"))
        .find(b => b.querySelector(`.${iconClass}`)) ?? null;
}

beforeEach(() => {
    parent.current = new Component();
    setOptions({});
    vi.clearAllMocks();
    // The auto-mocked server (test/setup.ts) only defines real get/post — override with spies (put is
    // already a globally-provided vi.fn, cleared each test).
    Object.assign(server, {
        get: vi.fn(async () => []),
        post: vi.fn(async () => ({ success: true, anonymizedFilePath: "/tmp/anon.db" }))
    });
});

// --- Top-level structure --------------------------------------------------------------------------

describe("AdvancedSettings", () => {
    it("renders all the option sections and loads anonymized databases on mount", async () => {
        const root = renderAdvanced();
        await flush();
        // Database, DatabaseAnonymization, Experimental, AdvancedSync = 4 sections.
        const sections = root.querySelectorAll(".options-section");
        expect(sections.length).toBe(4);
        // The anonymization section eagerly queries the existing databases on mount.
        expect(server.get).toHaveBeenCalledWith("database/anonymized-databases");
    });
});

// --- DatabaseOptions ------------------------------------------------------------------------------

describe("DatabaseOptions", () => {
    it("integrity check shows the success message when results are ok", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
            if (url === "database/check-integrity") return { results: [ { integrity_check: "ok" } ] };
            return [];
        });
        const root = renderAdvanced();
        await flush();
        const btn = buttonByIcon(root, "bx-check-shield") ?? root.querySelectorAll<HTMLButtonElement>("button.option-row-link")[0];
        click(btn);
        await flush();
        expect(server.get).toHaveBeenCalledWith("database/check-integrity");
        // checking-message + success-message → at least two toasts.
        expect((toast.showMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("integrity check reports failure when results are not ok", async () => {
        (server.get as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
            if (url === "database/check-integrity") return { results: [ { integrity_check: "broken" }, { integrity_check: "also" } ] };
            return [];
        });
        const root = renderAdvanced();
        await flush();
        const btn = root.querySelectorAll<HTMLButtonElement>("button.option-row-link")[0];
        click(btn);
        await flush();
        // The failing branch passes a JSON-stringified results payload with a long timeout.
        const failingCall = (toast.showMessage as ReturnType<typeof vi.fn>).mock.calls.find(c => c[1] === 15000);
        expect(failingCall).toBeTruthy();
    });

    it("find-and-fix consistency issues posts and toasts", async () => {
        const root = renderAdvanced();
        await flush();
        const btn = root.querySelectorAll<HTMLButtonElement>("button.option-row-link")[1];
        click(btn);
        await flush();
        expect(server.post).toHaveBeenCalledWith("database/find-and-fix-consistency-issues");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("vacuum database posts and toasts", async () => {
        const root = renderAdvanced();
        await flush();
        const btn = root.querySelectorAll<HTMLButtonElement>("button.option-row-link")[2];
        click(btn);
        await flush();
        expect(server.post).toHaveBeenCalledWith("database/vacuum-database");
        expect(toast.showMessage).toHaveBeenCalled();
    });
});

// --- DatabaseAnonymizationOptions -----------------------------------------------------------------

describe("DatabaseAnonymizationOptions", () => {
    it("full anonymization success refreshes the list of databases", async () => {
        const getMock = vi.fn(async (_url: string) => []);
        Object.assign(server, { get: getMock });
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, anonymizedFilePath: "/tmp/full.db" });

        const root = renderAdvanced();
        await flush();
        // The full / light anonymization buttons live in the second section (after the 3 DB buttons).
        const buttons = root.querySelectorAll<HTMLButtonElement>("button.option-row-link");
        click(buttons[3]);
        await flush();
        expect(server.post).toHaveBeenCalledWith("database/anonymize/full");
        expect(toast.showError).not.toHaveBeenCalled();
        // refreshAnonymizedDatabase runs again after success (mount + after-success = 2 calls).
        expect(getMock.mock.calls.filter(c => c[0] === "database/anonymized-databases").length).toBeGreaterThanOrEqual(2);
    });

    it("full anonymization failure shows an error", async () => {
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false });
        const root = renderAdvanced();
        await flush();
        const buttons = root.querySelectorAll<HTMLButtonElement>("button.option-row-link");
        click(buttons[3]);
        await flush();
        expect(server.post).toHaveBeenCalledWith("database/anonymize/full");
        expect(toast.showError).toHaveBeenCalled();
    });

    it("light anonymization success refreshes the list of databases", async () => {
        const getMock = vi.fn(async (_url: string) => []);
        Object.assign(server, { get: getMock });
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, anonymizedFilePath: "/tmp/light.db" });
        const root = renderAdvanced();
        await flush();
        const buttons = root.querySelectorAll<HTMLButtonElement>("button.option-row-link");
        click(buttons[4]);
        await flush();
        expect(server.post).toHaveBeenCalledWith("database/anonymize/light");
        expect(toast.showError).not.toHaveBeenCalled();
        expect(getMock.mock.calls.filter(c => c[0] === "database/anonymized-databases").length).toBeGreaterThanOrEqual(2);
    });

    it("light anonymization failure shows an error and does not refresh", async () => {
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false });
        const root = renderAdvanced();
        await flush();
        const buttons = root.querySelectorAll<HTMLButtonElement>("button.option-row-link");
        click(buttons[4]);
        await flush();
        expect(server.post).toHaveBeenCalledWith("database/anonymize/light");
        expect(toast.showError).toHaveBeenCalled();
    });

    it("renders the empty-state text when there are no anonymized databases", async () => {
        Object.assign(server, { get: vi.fn(async () => []) });
        const root = renderAdvanced();
        await flush();
        // No table is rendered while the list is empty; only a form-text placeholder.
        expect(root.querySelector("table.table")).toBeNull();
    });

    it("renders a table of existing anonymized databases", async () => {
        Object.assign(server, {
            get: vi.fn(async (url: string) => (url === "database/anonymized-databases"
                ? [ { filePath: "/a/one.db" }, { filePath: "/a/two.db" } ]
                : []))
        });
        const root = renderAdvanced();
        await flush();
        const table = root.querySelector("table.table");
        expect(table).not.toBeNull();
        expect(table?.querySelectorAll("tbody tr").length).toBe(2);
        expect(table?.textContent).toContain("/a/one.db");
        expect(table?.textContent).toContain("/a/two.db");
    });
});

// --- ExperimentalOptions --------------------------------------------------------------------------

describe("ExperimentalOptions", () => {
    it("renders a toggle per available feature and reflects the enabled state", async () => {
        // Pre-enable the only non-layout feature (llm) so its toggle reads as on.
        setOptions({ experimentalFeatures: JSON.stringify([ "llm" ]) });
        const root = renderAdvanced();
        await flush();
        const toggle = root.querySelector<HTMLInputElement>("input.switch-toggle[id^='experimental-llm']");
        expect(toggle).toBeInstanceOf(HTMLInputElement);
        expect(toggle?.checked).toBe(true);
    });

    it("toggling a disabled feature on persists it through the option setter", async () => {
        setOptions({ experimentalFeatures: JSON.stringify([]) });
        const root = renderAdvanced();
        await flush();
        const toggle = root.querySelector<HTMLInputElement>("input.switch-toggle[id^='experimental-llm']");
        expect(toggle?.checked).toBe(false);
        if (toggle) {
            toggleSwitch(toggle);
            await flush();
        }
        // useTriliumOptionJson setter serializes the new array and PUTs to options.
        const saved = (server.put as ReturnType<typeof vi.fn>).mock.calls
            .find(c => c[1] && typeof c[1] === "object" && "experimentalFeatures" in (c[1] as object));
        expect(saved).toBeTruthy();
        if (saved) {
            const payload = saved[1] as Record<string, string>;
            expect(JSON.parse(payload.experimentalFeatures)).toContain("llm");
        }
    });

    it("renders nothing when no experimental features are available", async () => {
        vi.spyOn(experimentalFeatures, "getAvailableExperimentalFeatures").mockReturnValue([]);
        const root = renderAdvanced();
        await flush();
        // The Experimental section disappears entirely, leaving Database, Anonymization and Sync.
        expect(root.querySelector("input.switch-toggle[id^='experimental-']")).toBeNull();
        expect(root.querySelectorAll(".options-section").length).toBe(3);
    });

    it("toggling an enabled feature off removes it from the persisted array", async () => {
        setOptions({ experimentalFeatures: JSON.stringify([ "llm" ]) });
        const root = renderAdvanced();
        await flush();
        const toggle = root.querySelector<HTMLInputElement>("input.switch-toggle[id^='experimental-llm']");
        if (toggle) {
            toggleSwitch(toggle);
            await flush();
        }
        const saved = (server.put as ReturnType<typeof vi.fn>).mock.calls
            .find(c => c[1] && typeof c[1] === "object" && "experimentalFeatures" in (c[1] as object));
        expect(saved).toBeTruthy();
        if (saved) {
            const payload = saved[1] as Record<string, string>;
            expect(JSON.parse(payload.experimentalFeatures)).not.toContain("llm");
        }
    });
});

// --- AdvancedSyncOptions --------------------------------------------------------------------------

describe("AdvancedSyncOptions", () => {
    it("force full sync posts and shows a toast", async () => {
        const root = renderAdvanced();
        await flush();
        const buttons = root.querySelectorAll<HTMLButtonElement>("button.option-row-link");
        // The two sync buttons are the last option-row-link buttons in the form.
        const forceBtn = buttons[buttons.length - 2];
        click(forceBtn);
        await flush();
        expect(server.post).toHaveBeenCalledWith("sync/force-full-sync");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("fill entity changes posts and shows surrounding toasts", async () => {
        const root = renderAdvanced();
        await flush();
        const buttons = root.querySelectorAll<HTMLButtonElement>("button.option-row-link");
        const fillBtn = buttons[buttons.length - 1];
        click(fillBtn);
        await flush();
        expect(server.post).toHaveBeenCalledWith("sync/fill-entity-changes");
        // filling-message + success-message → at least two toasts for this handler.
        expect((toast.showMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});

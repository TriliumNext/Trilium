import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../test/mocks";
import { flush, renderComponent, resetFroca } from "../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());
vi.mock("../services/math", () => ({ default: { render: vi.fn() } }));
vi.mock("../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [ "ctrl+k" ] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

import type { ElectronNavigationApi } from "@triliumnext/commons";

import { buildNote } from "../test/easy-froca";
import TabHistoryNavigationButtons from "./TabHistoryNavigationButtons";

// --- Render helper --------------------------------------------------------------------------------

/** Builds an electron navigation API stub and installs it on `window.electronApi`. */
function installElectronApi(overrides: Partial<ElectronNavigationApi> = {}) {
    const navigation: ElectronNavigationApi = {
        clearNavigationHistory: vi.fn(),
        navigationCanGoBack: vi.fn(() => true),
        navigationCanGoForward: vi.fn(() => true),
        navigationGetAllEntries: vi.fn(() => []),
        navigationGetActiveIndex: vi.fn(() => 0),
        navigationLength: vi.fn(() => 0),
        navigationGoToIndex: vi.fn(),
        onDidNavigate: vi.fn(),
        onDidNavigateInPage: vi.fn(),
        removeDidNavigateListeners: vi.fn(),
        ...overrides
    };
    (window as unknown as Record<string, unknown>).electronApi = { navigation };
    return navigation;
}

function removeElectronApi() {
    delete (window as unknown as Record<string, unknown>).electronApi;
}

// The legacy launcher notes the component checks for visibility. By default they live under a
// non-visible parent, so both ActionButtons render.
function seedLauncherNotes(visible = false) {
    const parentId = visible ? "_lbVisibleLaunchers" : "someParent";
    buildNote({
        id: parentId, title: "Parent", children: [
            { id: "_lbBackInHistory", title: "Back" },
            { id: "_lbForwardInHistory", title: "Forward" }
        ]
    });
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    removeElectronApi();
});

afterEach(() => {
    removeElectronApi();
});

describe("TabHistoryNavigationButtons", () => {
    it("renders both nav buttons in non-electron mode (no api, defaults enabled)", async () => {
        seedLauncherNotes();
        const { container: root } = renderComponent(<TabHistoryNavigationButtons />);
        await flush();

        const wrapper = root.querySelector(".tab-history-navigation-buttons");
        expect(wrapper).not.toBeNull();

        const buttons = root.querySelectorAll("button");
        expect(buttons.length).toBe(2);
        // Without an electron API the buttons default to enabled (canGoBack/Forward === true).
        buttons.forEach(btn => expect(btn.disabled).toBe(false));
        // triggerCommand wiring.
        const commands = Array.from(buttons).map(b => b.getAttribute("data-trigger-command")).sort();
        expect(commands).toEqual([ "backInNoteHistory", "forwardInNoteHistory" ]);
    });

    it("reads initial nav state and subscribes to navigation events in electron mode", async () => {
        seedLauncherNotes();
        const navigation = installElectronApi({
            navigationCanGoBack: vi.fn(() => false),
            navigationCanGoForward: vi.fn(() => true)
        });
        const { container: root } = renderComponent(<TabHistoryNavigationButtons />);
        await flush();

        // Back disabled, forward enabled (icons distinguish the two buttons).
        const back = root.querySelector("button.bx-left-arrow-alt");
        const forward = root.querySelector("button.bx-right-arrow-alt");
        expect(back).not.toBeNull();
        expect(forward).not.toBeNull();
        if (back instanceof HTMLButtonElement) expect(back.disabled).toBe(true);
        if (forward instanceof HTMLButtonElement) expect(forward.disabled).toBe(false);

        // The effect registered the navigation listeners.
        expect(navigation.onDidNavigate).toHaveBeenCalledTimes(1);
        expect(navigation.onDidNavigateInPage).toHaveBeenCalledTimes(1);
        // onContextMenu is wired (hasApi true) — verify the handler is attached.
        const onDidNavigateCb = (navigation.onDidNavigate as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(typeof onDidNavigateCb).toBe("function");
    });

    it("updates disabled state when a navigation event fires", async () => {
        seedLauncherNotes();
        let canBack = true;
        let canForward = true;
        const navigation = installElectronApi({
            navigationCanGoBack: vi.fn(() => canBack),
            navigationCanGoForward: vi.fn(() => canForward)
        });
        const { container: root } = renderComponent(<TabHistoryNavigationButtons />);
        await flush();

        let back = root.querySelector("button.bx-left-arrow-alt");
        if (back instanceof HTMLButtonElement) expect(back.disabled).toBe(false);

        // Flip the state and invoke the registered callback.
        canBack = false;
        canForward = false;
        const updateCb = (navigation.onDidNavigate as ReturnType<typeof vi.fn>).mock.calls[0][0];
        act(() => updateCb());

        back = root.querySelector("button.bx-left-arrow-alt");
        const forward = root.querySelector("button.bx-right-arrow-alt");
        if (back instanceof HTMLButtonElement) expect(back.disabled).toBe(true);
        if (forward instanceof HTMLButtonElement) expect(forward.disabled).toBe(true);
    });

    it("removes navigation listeners on unmount (effect cleanup)", async () => {
        seedLauncherNotes();
        const navigation = installElectronApi();
        const { unmount } = renderComponent(<TabHistoryNavigationButtons />);
        await flush();

        unmount();
        expect(navigation.removeDidNavigateListeners).toHaveBeenCalledTimes(1);
    });

    it("hides the legacy buttons when their launchers are visible", async () => {
        seedLauncherNotes(true);
        const { container: root } = renderComponent(<TabHistoryNavigationButtons />);
        await flush();

        // Both legacy launchers are visible → component renders neither ActionButton.
        expect(root.querySelectorAll("button").length).toBe(0);
        expect(root.querySelector(".tab-history-navigation-buttons")).not.toBeNull();
    });

    it("falls back to enabled when navigation accessors return nullish", async () => {
        seedLauncherNotes();
        // Accessors returning undefined exercise the `?? true` fallback.
        installElectronApi({
            navigationCanGoBack: vi.fn(() => undefined as unknown as boolean),
            navigationCanGoForward: vi.fn(() => undefined as unknown as boolean)
        });
        const { container: root } = renderComponent(<TabHistoryNavigationButtons />);
        await flush();

        const buttons = root.querySelectorAll("button");
        expect(buttons.length).toBe(2);
        buttons.forEach(btn => expect(btn.disabled).toBe(false));
    });
});

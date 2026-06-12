import { AppInfo } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent, resetFroca } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real bootstrap Modal/Tooltip machinery does not behave under happy-dom; provide inert stubs.
vi.mock("bootstrap", () => {
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        dispose() {}
    }
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element) { return Tooltip.getInstance(el) ?? new Tooltip(el); }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// openDialog resolves with a jQuery-wrapped element; the Modal effect calls `.then(...)` on it.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($el: JQuery<HTMLElement>) => $el),
    default: { openDialog: vi.fn(async ($el: JQuery<HTMLElement>) => $el) }
}));

// i18next is never initialised in tests, so the real `t` returns undefined and role labels (which
// gate the role <span>) never render. Return the key so structure renders; we assert on structure,
// not on translated English copy.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key,
    getCurrentLanguage: () => "en"
}));

// react-i18next's <Trans> needs an initialised i18n instance (not set up in tests) and pulls a
// React copy that conflicts with preact — stub it, but still render the interpolated components so
// the RevisionLink (passed as components.buildRevision) is exercised and assertable.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey?: string; components?: Record<string, unknown> }) => (
        <span class="trans-stub" data-i18n-key={i18nKey}>
            {(components?.buildRevision as never) ?? null}
        </span>
    )
}));

// Shared spies, hoisted so the (hoisted) mock factories below can reference them safely.
const { openDirectoryMock, isElectronMock } = vi.hoisted(() => ({
    openDirectoryMock: vi.fn(),
    isElectronMock: vi.fn(() => false)
}));

// `open` is a side-effectful service (top-level server/options imports); stub the one method used.
vi.mock("../../services/open", () => ({
    default: { openDirectory: (...args: unknown[]) => openDirectoryMock(...args) }
}));

// Partial-mock utils so we can toggle isElectron per test (isStandalone stays false → "stable").
vi.mock("../../services/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../services/utils")>();
    return {
        ...actual,
        isStandalone: false,
        default: { ...actual.default, isElectron: () => isElectronMock() }
    };
});

import type Component from "../../components/component";
import { openDialog } from "../../services/dialog";
import server from "../../services/server";
import AboutDialog from "./about";

// --- Render harness (full component inside the Trilium parent provider) ---------------------------

let parent: Component | undefined;

function renderDialog() {
    const result = renderComponent(<AboutDialog />);
    parent = result.parent;
    return result.container;
}

function fireEvent(name: string, data: unknown) {
    act(() => { (parent?.handleEventInChildren as (n: string, d: unknown) => void)?.(name, data); });
}

async function flush() {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
}

function makeAppInfo(overrides: Partial<AppInfo> = {}): AppInfo {
    return {
        appVersion: "1.2.3",
        dbVersion: 200,
        syncVersion: 30,
        buildDate: "2026-06-05T10:00:00.000Z",
        buildRevision: "abcdef1234567890",
        clipperProtocolVersion: "1.0",
        utcDateTime: "2026-06-05T10:00:00.000Z",
        ...overrides
    };
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    isElectronMock.mockReturnValue(false);
    Object.assign(server, {
        get: vi.fn(async () => makeAppInfo())
    });
    // useTooltip calls $el.tooltip(config); provide the jQuery plugin method as a no-op.
    (($.fn as unknown) as { tooltip: unknown }).tooltip = vi.fn(function (this: unknown) { return this; });
});

// --- Tests ---------------------------------------------------------------------------------------

describe("AboutDialog — initial shell", () => {
    it("renders the modal shell with the stable channel class; body content appears only once shown", async () => {
        const el = renderDialog();

        const modal = el.querySelector(".about-dialog");
        expect(modal).toBeTruthy();
        // Default (non-standalone) channel is "stable".
        expect(modal?.classList.contains("stable")).toBe(true);
        // No app-info fetch happens until the open event is fired.
        expect(server.get).not.toHaveBeenCalled();
        // The modal body (with the footer) is not rendered while hidden.
        expect(el.querySelector("footer")).toBeNull();

        fireEvent("openAboutDialog", {});
        await flush();

        // The three footer links are rendered once the dialog is shown.
        const footerLinks = el.querySelectorAll("footer a");
        expect(footerLinks.length).toBe(3);
        // GitHub + license links + the donate link (with its dedicated class).
        expect(el.querySelector("footer a.donate-link")).toBeTruthy();
        expect(el.querySelector("footer .bxl-github")).toBeTruthy();
        expect(el.querySelector("footer svg")).toBeTruthy();

        // Since the channel is "stable", the channel-name badge is not shown.
        expect(el.querySelector(".channel-name")).toBeNull();
        // The external website link is present.
        expect(el.querySelector("a.tn-link[href='https://triliumnotes.org/']")).toBeTruthy();
    });

    it("registers tooltips on the footer links via $.fn.tooltip once shown", async () => {
        renderDialog();
        fireEvent("openAboutDialog", {});
        await flush();
        // useTooltip in FooterLink binds a bootstrap tooltip to each footer anchor (3 of them).
        const tooltipFn = ($.fn as unknown as { tooltip: ReturnType<typeof vi.fn> }).tooltip;
        expect(tooltipFn).toHaveBeenCalled();
    });
});

describe("AboutDialog — open event / app-info loading", () => {
    it("fetches app-info on the openAboutDialog event and shows version + build revision", async () => {
        Object.assign(server, { get: vi.fn(async () => makeAppInfo({ buildRevision: "abcdef1234567890" })) });
        const el = renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();

        expect(server.get).toHaveBeenCalledWith("app-info");
        // The modal body content is rendered.
        expect(el.querySelector(".about-dialog-content")).toBeTruthy();
        // The property sheet has at least the version + contributors items.
        expect(el.querySelector(".about-dialog-property-sheet")).toBeTruthy();
        // The build revision short hash (first 7 chars) is rendered as a commit link.
        const revLink = el.querySelector("a[href^='https://github.com/TriliumNext/Trilium/commit/']");
        expect(revLink).toBeTruthy();
        expect(revLink?.textContent).toBe("abcdef1");
        // Stable build (no "test" in version) keeps channel stable → no channel-name badge.
        expect(el.querySelector(".channel-name")).toBeNull();
        // The contributor "full list" link is present.
        expect(el.querySelector(".contributor-list a[href$='/graphs/contributors']")).toBeTruthy();
    });

    it("switches to the nightly channel when the app version contains 'test'", async () => {
        Object.assign(server, { get: vi.fn(async () => makeAppInfo({ appVersion: "1.2.3-test" })) });
        const el = renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();

        // channel/icon flip to nightly → the modal gets the "nightly" class and shows the badge.
        expect(el.querySelector(".about-dialog.nightly")).toBeTruthy();
        const badge = el.querySelector(".channel-name");
        expect(badge).toBeTruthy();
        // The icon element's data-icon reflects the nightly icon.
        expect(el.querySelector(".about-dialog-content .icon")?.getAttribute("data-icon")).toBe("nightly");
    });

    it("only fetches app-info once across multiple open events (hasLoaded guard)", async () => {
        const getMock = vi.fn(async () => makeAppInfo());
        Object.assign(server, { get: getMock });
        renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();
        fireEvent("openAboutDialog", {});
        await flush();

        expect(getMock).toHaveBeenCalledTimes(1);
    });

    it("omits the commit link when buildRevision is empty", async () => {
        Object.assign(server, { get: vi.fn(async () => makeAppInfo({ buildRevision: "" })) });
        const el = renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();

        expect(el.querySelector("a[href^='https://github.com/TriliumNext/Trilium/commit/']")).toBeNull();
    });
});

describe("AboutDialog — data directory", () => {
    it("renders the data directory as plain text when not running under Electron", async () => {
        isElectronMock.mockReturnValue(false);
        Object.assign(server, { get: vi.fn(async () => makeAppInfo({ dataDirectory: "/home/user/trilium-data" })) });
        const el = renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();

        const span = el.querySelector("span.selectable-text");
        expect(span?.textContent).toBe("/home/user/trilium-data");
        // No clickable anchor in the web (non-electron) branch.
        expect(el.querySelector("a.tn-link.selectable-text")).toBeNull();
    });

    it("renders a clickable directory link under Electron and opens it on click", async () => {
        isElectronMock.mockReturnValue(true);
        Object.assign(server, { get: vi.fn(async () => makeAppInfo({ dataDirectory: "/data/dir" })) });
        const el = renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();

        const link = el.querySelector("a.tn-link.selectable-text") as HTMLAnchorElement | null;
        expect(link).toBeTruthy();
        expect(link?.textContent).toBe("/data/dir");

        act(() => link?.click());
        expect(openDirectoryMock).toHaveBeenCalledWith("/data/dir");
    });

    it("omits the data directory section when none is provided", async () => {
        Object.assign(server, { get: vi.fn(async () => makeAppInfo({ dataDirectory: undefined })) });
        const el = renderDialog();

        fireEvent("openAboutDialog", {});
        await flush();

        expect(el.querySelector("span.selectable-text")).toBeNull();
        expect(el.querySelector("a.tn-link.selectable-text")).toBeNull();
    });
});

describe("AboutDialog — contributors", () => {
    it("renders the contributor list with roles and separators", async () => {
        const el = renderDialog();
        fireEvent("openAboutDialog", {});
        await flush();

        const list = el.querySelector(".contributor-list");
        expect(list).toBeTruthy();
        // Each contributor is an anchor; there are many of them (plus the "full list" link).
        const contributorAnchors = list?.querySelectorAll("a") ?? [];
        expect(contributorAnchors.length).toBeGreaterThan(1);
        // Contributors with a role render a (role) span.
        expect(list?.querySelector(".contributor-role")).toBeTruthy();
    });

    it("toggles the alt icon when hovering the original-dev role (with timer) and clears on leave", async () => {
        vi.useFakeTimers();
        try {
            const el = renderDialog();
            // open event uses real time internally only for the await; the get mock resolves immediately.
            await act(async () => {
                (parent?.handleEventInChildren as (n: string, d: unknown) => void)?.("openAboutDialog", {});
                await vi.advanceTimersByTimeAsync(0);
            });

            // Find the role span belonging to the original-dev contributor (zadam → role "original-dev").
            const roleSpans = Array.from(el.querySelectorAll(".contributor-list span")).filter(
                (s) => s.querySelector(".contributor-role")
            ) as HTMLSpanElement[];
            expect(roleSpans.length).toBeGreaterThan(0);

            // The icon starts as "default" (non-standalone, stable).
            const iconEl = () => el.querySelector(".about-dialog-content .icon");
            expect(iconEl()?.getAttribute("data-icon")).toBe("default");

            // Hover each role span; only the original-dev one schedules the alt icon after 500ms.
            act(() => roleSpans.forEach((s) => s.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))));
            await act(async () => { await vi.advanceTimersByTimeAsync(600); });

            // After the timeout fires, the alt icon ("classic") is shown.
            expect(iconEl()?.getAttribute("data-icon")).toBe("classic");

            // Leaving clears the alt icon, falling back to the base icon.
            act(() => roleSpans.forEach((s) => s.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(iconEl()?.getAttribute("data-icon")).toBe("default");
        } finally {
            vi.useRealTimers();
        }
    });

    it("clears a pending alt-icon timer if the original-dev role is left before it fires", async () => {
        vi.useFakeTimers();
        try {
            const el = renderDialog();
            await act(async () => {
                (parent?.handleEventInChildren as (n: string, d: unknown) => void)?.("openAboutDialog", {});
                await vi.advanceTimersByTimeAsync(0);
            });

            const roleSpans = Array.from(el.querySelectorAll(".contributor-list span")).filter(
                (s) => s.querySelector(".contributor-role")
            ) as HTMLSpanElement[];
            const iconEl = () => el.querySelector(".about-dialog-content .icon");

            // Enter then leave before the 500ms timeout → timer is cleared, alt icon never set.
            act(() => roleSpans.forEach((s) => s.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))));
            act(() => roleSpans.forEach((s) => s.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))));
            await act(async () => { await vi.advanceTimersByTimeAsync(600); });

            expect(iconEl()?.getAttribute("data-icon")).toBe("default");
        } finally {
            vi.useRealTimers();
        }
    });

    it("invokes the name-hover handler without changing the icon", async () => {
        const el = renderDialog();
        fireEvent("openAboutDialog", {});
        await flush();

        const nameAnchor = el.querySelector(".contributor-list a") as HTMLAnchorElement | null;
        expect(nameAnchor).toBeTruthy();
        const iconEl = () => el.querySelector(".about-dialog-content .icon");
        const before = iconEl()?.getAttribute("data-icon");

        act(() => {
            nameAnchor?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            nameAnchor?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        });
        // Hovering a contributor name (part "name") never schedules an icon change.
        expect(iconEl()?.getAttribute("data-icon")).toBe(before);
    });
});

describe("AboutDialog — closing", () => {
    it("opens the modal via openDialog and survives the hidden event", async () => {
        const el = renderDialog();
        fireEvent("openAboutDialog", {});
        await flush();

        // The Modal effect calls openDialog once `show` flips to true.
        expect(openDialog).toHaveBeenCalled();

        const modalEl = el.querySelector(".about-dialog") as HTMLElement | null;
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();

        // Dialog shell remains in the DOM after being hidden.
        expect(el.querySelector(".about-dialog")).toBeTruthy();
    });
});

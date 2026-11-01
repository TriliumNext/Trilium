import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";

const mocks = vi.hoisted(() => ({
    overview: undefined as unknown,
    failed: false,
    loading: false,
    /** The token the page last asked each view to measure at. */
    overviewToken: undefined as number | undefined,
    browseToken: undefined as number | undefined,
    reportBrowseLoading: undefined as ((loading: boolean) => void) | undefined
}));

vi.mock("../../react/use_fetch", () => ({
    useFetch: (_url: string, refreshToken: number) => {
        mocks.overviewToken = refreshToken;
        return { data: mocks.overview, failed: mocks.failed, loading: mocks.loading };
    }
}));

vi.mock("./browse", () => ({
    default: ({ path, refreshToken, onLoadingChange }: {
        path: string[],
        refreshToken: number,
        onLoadingChange: (loading: boolean) => void
    }) => {
        mocks.browseToken = refreshToken;
        mocks.reportBrowseLoading = onLoadingChange;
        return <div className="browse-stub" data-path={path.join("/")} />;
    }
}));

vi.mock("./overview", () => ({
    default: ({ onShowDetails }: { onShowDetails: (notePath: string[]) => void }) => (
        // Stands in for the menu's "Show details" on one of the map's cells.
        <div className="overview-stub" onClick={() => onShowDetails([ "root", "p1", "n1" ])} />
    )
}));

import SpaceUsage from "./index";

const OVERVIEW: SpaceUsageOverviewResponse = {
    content: { size: 4000, noteCount: 12, attachmentsSize: 300, revisionsSize: 200 },
    notes: [],
    otherNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
    hiddenNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
    deletedNotes: { size: 900, noteCount: 3, attachmentCount: 2 },
    unusedAttachments: { size: 0, attachmentCount: 0 },
    total: { size: 3500, revisionsSize: 0, noteCount: 12 }
};

let container: HTMLDivElement | undefined;

function renderPage() {
    container = document.body.appendChild(document.createElement("div"));
    render(<SpaceUsage />, container);
    return container;
}

function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.overview = undefined;
    mocks.failed = false;
    mocks.loading = false;
    mocks.overviewToken = undefined;
    mocks.browseToken = undefined;
    mocks.reportBrowseLoading = undefined;
});

describe("SpaceUsage page", () => {
    it("shows the loading state without a status line until the overview arrives", () => {
        mocks.overview = undefined;
        const probe = renderPage();

        expect(probe.querySelector(".space-usage-loading")).not.toBeNull();
        expect(probe.querySelector(".space-usage-status")).toBeNull();
    });

    it("says so when the overview could not be measured, rather than measuring on", () => {
        mocks.overview = undefined;
        mocks.failed = true;
        const probe = renderPage();

        expect(probe.querySelector(".space-usage-loading")).toBeNull();
        expect(probe.querySelector(".no-items")).not.toBeNull();
    });

    it("renders the overview with the two-part status line", () => {
        mocks.overview = OVERVIEW;
        const probe = renderPage();

        expect(probe.querySelector(".overview-stub")).not.toBeNull();
        expect(probe.querySelector(".browse-stub")).toBeNull();

        // Symmetric against the same t() call: meaningful with translations loaded, and still a
        // faithful comparison when the test i18n is uninitialized (t yields undefined → empty span).
        const [ contentSpan, , deletedSpan ] = [ ...probe.querySelectorAll(".space-usage-status span") ];
        expect(contentSpan.textContent?.trim()).toBe(t("space_usage.status_content", {
            count: 12,
            size: formatSize(4000),
            attachmentsSize: formatSize(300)
        }) ?? "");
        // The size alone: the counts belong to the map's deleted cell, not to this line.
        expect(deletedSpan.textContent?.trim()).toBe(t("space_usage.status_deleted", {
            size: formatSize(900)
        }) ?? "");
    });

    it("switches to Browse and back, leaving the whole-database totals behind", async () => {
        mocks.overview = OVERVIEW;
        const probe = renderPage();

        // Labels depend on the (uninitialized) test i18n; the inactive button is the other view.
        // Scoped to the view group so the refresh button beside it is never mistaken for one.
        const inactiveViewButton = () =>
            [ ...probe.querySelectorAll<HTMLButtonElement>(".space-usage-view-choice button") ]
                .find((button) => !button.classList.contains("active"));

        inactiveViewButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();
        expect(probe.querySelector(".browse-stub")).not.toBeNull();
        expect(probe.querySelector(".overview-stub")).toBeNull();
        // Browse is about one note; database-wide totals under it would read as that note's.
        expect(probe.querySelector(".space-usage-status")).toBeNull();

        inactiveViewButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();
        expect(probe.querySelector(".overview-stub")).not.toBeNull();
        expect(probe.querySelector(".browse-stub")).toBeNull();
        expect(probe.querySelector(".space-usage-status")).not.toBeNull();
    });

    it("lands Browse on the note the map asked details for, rather than back at the root", async () => {
        mocks.overview = OVERVIEW;
        const probe = renderPage();

        probe.querySelector(".overview-stub")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();

        const browse = probe.querySelector<HTMLElement>(".browse-stub");
        expect(browse).not.toBeNull();
        expect(browse?.dataset.path).toBe("root/p1/n1");
    });

    it("asks both views for a fresh reading when refresh is pressed, and only then", async () => {
        mocks.overview = OVERVIEW;
        const probe = renderPage();
        const refresh = () => probe.querySelector<HTMLButtonElement>(".space-usage-refresh");

        const initialToken = mocks.overviewToken ?? 0;

        // Switching views re-renders everything below; measuring must not restart because of it —
        // it is far too expensive to repeat whenever something on the page happens to change.
        [ ...probe.querySelectorAll<HTMLButtonElement>(".space-usage-view-choice button") ][1]
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();
        expect(mocks.overviewToken).toBe(initialToken);
        expect(mocks.browseToken).toBe(initialToken);

        refresh()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();

        // Browse measures a different endpoint, so it needs the same signal to follow along.
        expect(mocks.overviewToken).toBe(initialToken + 1);
        expect(mocks.browseToken).toBe(initialToken + 1);
    });

    it("keeps the refresh button out while a reading is being taken", () => {
        mocks.overview = OVERVIEW;
        mocks.loading = true;

        expect(renderPage().querySelector<HTMLButtonElement>(".space-usage-refresh")?.disabled).toBe(true);
    });

    it("keeps it out for Browse's own reading too, which it cannot see otherwise", async () => {
        mocks.overview = OVERVIEW;
        const probe = renderPage();
        const refresh = () => probe.querySelector<HTMLButtonElement>(".space-usage-refresh");

        [ ...probe.querySelectorAll<HTMLButtonElement>(".space-usage-view-choice button") ][1]
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flushRender();
        expect(refresh()?.disabled).toBe(false);

        // Browse measures its note through a request of its own; a second press meanwhile would
        // start another scan of the whole database alongside the one already running.
        mocks.reportBrowseLoading?.(true);
        await flushRender();
        expect(refresh()?.disabled).toBe(true);

        mocks.reportBrowseLoading?.(false);
        await flushRender();
        expect(refresh()?.disabled).toBe(false);
    });
});

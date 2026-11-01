import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

const mocks = vi.hoisted(() => ({
    pages: [] as FNote[]
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../dialogs/OptionsDialog", () => ({
    useOptionPages: () => mocks.pages
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteContext: () => ({})
}));

vi.mock("../ContentWidget", async () => {
    const { Card, OptionCardSection } = await import("../../react/Card");

    return {
        CONTENT_WIDGETS: {
            _optionsAppearance: () => (
                <Card heading="Appearance">
                    <OptionCardSection className="theme" label="Theme" />
                    <OptionCardSection className="zoom" label="Zoom level" />
                </Card>
            ),
            _optionsBackup: () => (
                <Card heading="Backup">
                    <OptionCardSection className="interval" label="Backup interval" />
                </Card>
            ),
            _optionsContentManager: () => <Card heading="Content manager"><div /></Card>
        }
    };
});

import { renderInto } from "../../../test/render";
import OptionsSearchPage, { hasSearchTerms, MIN_QUERY_LENGTH } from "./search_page";

describe("hasSearchTerms", () => {
    it("waits for a word worth looking for, whatever space is typed around it", () => {
        expect(hasSearchTerms("")).toBe(false);
        expect(hasSearchTerms("   ")).toBe(false);
        expect(hasSearchTerms("t")).toBe(false);
        expect(hasSearchTerms("  t  ")).toBe(false);

        // Two letters is a name in its own right, which is what the AI page is found by.
        expect(hasSearchTerms("ai")).toBe(true);
        expect(hasSearchTerms("  theme  ")).toBe(true);
    });
});

function fakePage(noteId: string, title: string) {
    return { noteId, title, getIcon: () => "bx bx-cog" } as unknown as FNote;
}

/** Renders the page and lets it get past the spinner, which it holds for a tick on purpose. */
async function renderSearch(query: string) {
    const container = renderInto(null);
    await act(() => render(<OptionsSearchPage query={query} />, container));
    await act(() => { vi.advanceTimersByTime(500); });

    return container;
}

function shownSettings(container: HTMLElement) {
    return [ ...container.querySelectorAll(".tn-card-option") ].map((el) => el.textContent);
}

describe("OptionsSearchPage", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.pages = [
            fakePage("_optionsAppearance", "Appearance"),
            fakePage("_optionsBackup", "Backup"),
            fakePage("_optionsContentManager", "Content manager")
        ];
    });

    afterEach(() => vi.useRealTimers());

    it("stands the pages up behind a spinner, rather than freezing on an empty page", async () => {
        const container = renderInto(null);

        await act(() => render(<OptionsSearchPage query="" />, container));
        expect(container.querySelector(".options-search-loading")).not.toBeNull();
        expect(container.querySelector(".options-search-results")).toBeNull();

        await act(() => { vi.advanceTimersByTime(500); });
        expect(container.querySelector(".options-search-loading")).toBeNull();
        expect(container.querySelector(".options-search-results")).not.toBeNull();
    });

    it("holds the results back until enough has been typed to look for", async () => {
        const short = await renderSearch("th".slice(0, MIN_QUERY_LENGTH - 1));
        expect(short.querySelector(".options-search-results")?.hasAttribute("hidden")).toBe(true);
        expect(short.querySelector(".options-search-hint")).not.toBeNull();
        // Mounted all the same, so that the first search is as quick as every one after it.
        expect(shownSettings(short).length).toBeGreaterThan(0);

        const long = await renderSearch("theme");
        expect(long.querySelector(".options-search-results")?.hasAttribute("hidden")).toBe(false);
        expect(long.querySelector(".options-search-hint")).toBeNull();
    });

    it("keeps only the settings that match, from whichever page they belong to", async () => {
        expect(shownSettings(await renderSearch("theme"))).toEqual([ "Theme" ]);
        expect(shownSettings(await renderSearch("backup"))).toEqual([ "Backup interval" ]);
        expect(shownSettings(await renderSearch("nothing at all"))).toEqual([]);
    });

    it("shows the whole of a page's card when the card itself is what matched", async () => {
        const container = await renderSearch("appearance");

        expect(shownSettings(container)).toEqual([ "Theme", "Zoom level" ]);
    });

    it("names the page each result belongs to", async () => {
        const container = await renderSearch("theme");
        const titles = [ ...container.querySelectorAll(".options-search-page-title") ]
            .map((el) => el.textContent);

        expect(titles).toContain("Appearance");
    });

    it("leaves out the pages that do work on show instead of holding settings", async () => {
        const container = await renderSearch("content");

        expect(container.querySelectorAll(".options-search-page")).toHaveLength(2);
        expect(container.textContent).not.toContain("Content manager");
    });
});

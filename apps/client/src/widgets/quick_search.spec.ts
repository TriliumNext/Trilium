import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bootstrap", () => ({
    Dropdown: {
        getOrCreateInstance: vi.fn(() => ({
            hide: vi.fn(),
            show: vi.fn(),
            update: vi.fn()
        }))
    },
    Tooltip: vi.fn()
}));

import server from "../services/server.js";
import QuickSearchWidget from "./quick_search.js";

describe("QuickSearchWidget", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("sends slash-bearing text as a query parameter", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue({
            searchResultNoteIds: [],
            searchResults: [],
            error: ""
        });
        const widget = new QuickSearchWidget();
        const $widget = widget.doRender();
        $widget.find(".search-string").val("中/英");

        await widget.search();

        expect(get).toHaveBeenCalledWith(
            `quick-search?searchString=${encodeURIComponent("中/英")}`
        );
    });
});

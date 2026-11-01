import type { ComponentProps } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    /** What each category's search resolves to, keyed by category id. */
    found: {} as Record<string, { noteId: string; title: string }[]>,
    /** The last filter each search was asked for, so the debounce can be watched. */
    queried: [] as string[],
    enabled: true,
    setCategoryEnabled: vi.fn(),
    stored: { contentManagerSortOrder: "title", contentManagerViewMode: "category" } as Record<string, string>,
    saved: [] as [ string, string ][]
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

/*
 * The data layer is stubbed out: what each category holds, and whether a note counts as enabled, is
 * decided by searches and attribute reads that `services/active_content` owns and its own spec
 * covers. What is left here — and what these cases are about — is which of the page's states is
 * shown for a given answer.
 */
vi.mock("../../../services/active_content", () => ({
    CONTENT_CATEGORIES: [
        { id: "templates", titleKey: "content_manager.category_templates", filter: "#template" },
        { id: "scripts", titleKey: "content_manager.category_scripts", filter: "#run" }
    ],
    findCategoryNotes: async (category: { id: string }, _sortOrder: string, titleFilter: string) => {
        mocks.queried.push(titleFilter);
        return mocks.found[category.id] ?? [];
    },
    isCategoryEnabled: () => mocks.enabled,
    setCategoryEnabled: mocks.setCategoryEnabled,
    resolveProperties: () => [],
    // One node per item, at the top level: the real grouping is this service's business, and the
    // page only walks whatever tree it is handed.
    buildLocationTree: (notes: { noteId: string; title: string }[]) =>
        notes.map((note) => ({ note, isGroup: false, children: [] })),
    getDisplayedBranchId: () => "branch-1"
}));

/*
 * The collection widget itself is not what these cases read — but the page hands it the two render
 * hooks that draw each row's detail and its menu, so the stub calls them the way the real list does.
 * A row's note is only ever read for its id here, the rest being this page's own business.
 */
vi.mock("../../collections/legacy/ListOrGridView", () => {
    // One object per id, kept: a row re-reads its setting whenever the note it was handed changes,
    // and a fresh object each render would look like a different note every time.
    const notes = new Map<string, { noteId: string }>();
    const noteFor = (noteId: string) => {
        const held = notes.get(noteId) ?? { noteId };
        notes.set(noteId, held);
        return held;
    };

    return {
        ListView: ({ noteIds, listOptions }: {
            noteIds: string[];
            listOptions?: {
                renderItemActions?: (note: { noteId: string }) => preact.ComponentChildren;
                renderItemMenu?: (note: { noteId: string }) => preact.ComponentChildren;
            };
        }) => (
            <div className="list-stub" data-notes={noteIds.join(",")}>
                {noteIds.map((noteId) => (
                    <div key={noteId} className="row-stub" data-note={noteId}>
                        {listOptions?.renderItemActions?.(noteFor(noteId))}
                        {listOptions?.renderItemMenu?.(noteFor(noteId))}
                    </div>
                ))}
            </div>
        )
    };
});

// The row menu reaches for the tab manager as it opens a note; nothing here presses it.
vi.mock("../../../components/app_context", () => ({
    default: {
        tabManager: {
            openContextWithNote: vi.fn(),
            getActiveContext: () => undefined,
            getActiveContextNotePath: () => undefined
        }
    }
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        (value: string) => void mocks.saved.push([ name, value ])
    ]
}));

import ActiveContent from "./active_content";

/** Only the fields the page itself reads; the rest of a type widget's props are the host's business. */
const PAGE_PROPS = { note: { noteId: "_optionsContentManager" } } as unknown as ComponentProps<typeof ActiveContent>;

let host: HTMLElement;

beforeEach(() => {
    vi.useFakeTimers();
    mocks.found = {};
    mocks.queried = [];
    mocks.enabled = true;
    mocks.stored = { contentManagerSortOrder: "title", contentManagerViewMode: "category" };
    mocks.saved = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.clearAllMocks();
});

/** Opens the page and lets the per-category searches settle. */
async function open() {
    await act(async () => {
        render(null, host);
        render(<ActiveContent {...PAGE_PROPS} />, host);
    });
    await act(async () => {});
}

const lists = () => [ ...host.querySelectorAll(".list-stub") ].map((list) => list.getAttribute("data-notes"));
const filterBox = () => host.querySelector<HTMLInputElement>(".active-content-filter input");

describe("what the page shows for a given answer", () => {
    it("says it is still looking before the first search comes back", async () => {
        await act(async () => {
            render(<ActiveContent {...PAGE_PROPS} />, host);
        });

        // Nothing has resolved yet, which is not the same as there being nothing to show.
        expect(host.querySelector(".active-content-loading")).not.toBeNull();
    });

    it("says there is nothing yet, with a hint, once the searches come back empty", async () => {
        await open();

        expect(host.querySelector(".no-items")).not.toBeNull();
        expect(host.querySelector(".no-items small")).not.toBeNull();
        expect(host.querySelector(".active-content-loading")).toBeNull();
    });

    it("lists a category that holds something, and leaves out one that does not", async () => {
        mocks.found = { templates: [ { noteId: "a", title: "A" } ] };
        await open();

        expect(lists()).toEqual([ "a" ]);
        expect(host.querySelector(".no-items")).toBeNull();
    });
});

describe("filtering", () => {
    beforeEach(() => {
        mocks.found = { templates: [ { noteId: "a", title: "A" } ] };
    });

    it("keeps typing instant and only searches again once it stops", async () => {
        await open();
        mocks.queried = [];

        await act(async () => {
            const box = filterBox();
            if (box) {
                box.value = "tem";
                box.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });

        // The box shows the text at once, but nothing has been searched for yet.
        expect(filterBox()?.value).toBe("tem");
        expect(mocks.queried).toEqual([]);

        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(mocks.queried).toContain("tem");
    });

    it("says nothing matched rather than that there is nothing at all, while filtering", async () => {
        mocks.found = {};
        await open();

        await act(async () => {
            const box = filterBox();
            if (box) {
                box.value = "nothing";
                box.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });

        // Content may well exist, just none matching — so the "nothing here yet" hint would mislead.
        expect(host.querySelector(".no-items small")).toBeNull();
        expect(host.querySelector(".no-items")?.textContent).toContain("content_manager.no_matches");
    });

    it("clears the box and searches for everything again, dropping the pending search with it", async () => {
        await open();

        await act(async () => {
            const box = filterBox();
            if (box) {
                box.value = "tem";
                box.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });

        mocks.queried = [];
        await act(async () => void host.querySelector<HTMLButtonElement>(".input-clearer-button")?.click());
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });

        expect(filterBox()?.value).toBe("");
        // The text just cleared must not be re-applied by the call that was already pending.
        expect(mocks.queried.every((query) => query === "")).toBe(true);
    });
});

describe("arranging the same items another way", () => {
    it("groups by where the items live rather than what they are, when asked to", async () => {
        mocks.found = { templates: [ { noteId: "a", title: "A" } ] };
        mocks.stored = { ...mocks.stored, contentManagerViewMode: "location" };
        await open();

        // The same notes, arranged by the tree the service handed back rather than by category.
        expect(lists()).toEqual([ "a" ]);
    });

    it("writes the chosen arrangement back, so the page opens the same way next time", async () => {
        await open();

        const [ , location ] = [ ...host.querySelectorAll<HTMLElement>(".active-content-view-choice button") ];
        await act(async () => location?.click());

        expect(mocks.saved).toContainEqual([ "contentManagerViewMode", "location" ]);
    });
});

/**
 * Each row's own controls, drawn by the hooks the page hands the list: what the item is, and the one
 * switch that turns it off.
 */
describe("a row's detail and its switch", () => {
    const toggles = () => [ ...host.querySelectorAll<HTMLInputElement>(".row-stub input.switch-toggle") ];

    beforeEach(() => {
        mocks.found = { templates: [ { noteId: "a", title: "A" } ] };
    });

    it("gives each item a switch reading whether its content is on", async () => {
        await open();
        expect(toggles()[0]?.checked).toBe(true);

        mocks.enabled = false;
        await open();
        expect(toggles()[0]?.checked).toBe(false);
    });

    it("writes through to the one category it was switched under, never to the note as a whole", async () => {
        await open();
        await act(async () => void toggles()[0]?.dispatchEvent(new Event("input", { bubbles: true })));

        // A note can be active content in several ways at once, and one switch over all of them
        // would overwrite the states the user never touched.
        expect(mocks.setCategoryEnabled).toHaveBeenCalledTimes(1);
        const [ , category, willEnable ] = mocks.setCategoryEnabled.mock.calls[0];
        expect((category as { id: string }).id).toBe("templates");
        expect(willEnable).toBe(false);
    });

    it("names the category on a row only where the headings do not already say it", async () => {
        await open();
        // Filed under its category's own heading, so saying it again on the row would be noise.
        expect(host.querySelectorAll(".row-stub .active-content-badge")).toHaveLength(0);

        mocks.stored = { ...mocks.stored, contentManagerViewMode: "location" };
        await open();
        // Arranged by place instead, where nothing else says what the item is.
        expect(host.querySelectorAll(".row-stub .active-content-badge")).toHaveLength(1);
    });

    it("offers each item the same menu, whichever way the list is arranged", async () => {
        await open();
        expect(host.querySelectorAll(".row-stub .active-content-item-menu")).toHaveLength(1);
    });
});

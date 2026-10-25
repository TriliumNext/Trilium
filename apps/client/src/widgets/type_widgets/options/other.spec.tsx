import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string>,
    json: {} as Record<string, unknown>,
    saved: [] as [ string, unknown ][],
    post: vi.fn(async (_url: string) => ({})),
    showMessage: vi.fn(),
    showError: vi.fn(),
    /** What a search for `#shareRoot` turns up, and whether what it found is actually shared. */
    shareRoots: [] as { title: string; isShared: () => boolean }[]
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// Replacing the shared server mock means also answering what the modules pulled in alongside the
// page ask for on import — the options load and the keyboard actions.
vi.mock("../../../services/server", () => ({
    default: {
        post: mocks.post,
        get: async (url: string) => (url === "keyboard-actions" ? [] : {})
    }
}));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

vi.mock("../../../services/search", () => ({
    default: { searchForNotes: async () => mocks.shareRoots }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteContext: () => ({ noteContext: undefined }),
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionBool: (name: string) => [
        mocks.stored[name] === "true",
        (value: boolean) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionJson: (name: string) => [
        mocks.json[name] ?? [],
        (value: unknown) => void mocks.saved.push([ name, value ])
    ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import OtherSettings, { getSearchEngineChoice } from "./other";

let host: HTMLElement;

beforeEach(() => {
    // What a real install holds: each duration row's figure and the scale it is read at.
    mocks.stored = {
        eraseEntitiesAfterTimeInSeconds: "86400", eraseEntitiesAfterTimeScale: "1",
        eraseUnusedAttachmentsAfterSeconds: "86400", eraseUnusedAttachmentsAfterTimeScale: "1",
        revisionSnapshotTimeInterval: "600", revisionSnapshotTimeIntervalTimeScale: "1",
        revisionSnapshotNumberLimit: "-1"
    };
    mocks.json = {};
    mocks.saved = [];
    mocks.shareRoots = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

function open() {
    act(() => {
        render(null, host);
        render(<OtherSettings />, host);
    });
}

const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[name='${name}']`);

describe("the search engine settings", () => {
    const engine = () => host.querySelector<HTMLSelectElement>(".search-engine-choice select");
    const urlBox = () => host.querySelector<HTMLInputElement>("input[type='url']");
    function choose(value: string) {
        const select = engine();
        expect(select).not.toBeNull();
        act(() => {
            if (!select) return;
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    it("offers none, the presets and custom, picking the entry from the stored URL", () => {
        open();
        expect([ ...engine()?.options ?? [] ].map((option) => option.text)).toEqual([
            "search_engine.none", "search_engine.duckduckgo", "search_engine.bing",
            "search_engine.baidu", "search_engine.google", "search_engine.custom"
        ]);
        expect(urlBox()).toBeNull();

        // An empty URL is DuckDuckGo, as the context menu falls back to it.
        expect(getSearchEngineChoice("")).toBe("https://duckduckgo.com/?q={keyword}");
        expect(getSearchEngineChoice("none")).toBe("none");
        expect(getSearchEngineChoice("https://www.bing.com/search?q={keyword}"))
            .toBe("https://www.bing.com/search?q={keyword}");
        expect(getSearchEngineChoice("https://example.com/?s={keyword}")).toBe("custom");
    });

    it("stores the name and address of a preset, and the sentinel for none", () => {
        open();

        choose("https://www.google.com/search?q={keyword}");
        choose("none");
        expect(mocks.saved).toEqual([
            [ "customSearchEngineName", "search_engine.google" ],
            [ "customSearchEngineUrl", "https://www.google.com/search?q={keyword}" ],
            [ "customSearchEngineName", "" ],
            [ "customSearchEngineUrl", "none" ]
        ]);
    });

    it("shows the name and URL fields only for a custom engine", () => {
        const store = (url: string) => {
            mocks.stored = { ...mocks.stored, customSearchEngineUrl: url };
        };
        store("https://example.com/?s={keyword}");
        open();
        expect(urlBox()?.type).toBe("url");
        expect(urlBox()?.value).toBe("https://example.com/?s={keyword}");

        // Switching from a preset keeps its values to edit; from none, it clears the sentinel.
        store("https://www.bing.com/search?q={keyword}");
        open();
        choose("custom");
        expect(urlBox()).not.toBeNull();
        expect(mocks.saved).toEqual([]);

        store("none");
        open();
        choose("custom");
        expect(mocks.saved).toEqual([
            [ "customSearchEngineName", "" ],
            [ "customSearchEngineUrl", "" ]
        ]);
    });
});

describe("erasing what has been deleted", () => {
    it("asks the server to erase now, for notes and for attachments alike", async () => {
        open();

        await act(async () => button("erase-deleted-notes-now-button")?.click());
        await act(async () => button("erase-unused-attachments-now-button")?.click());

        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "notes/erase-deleted-notes-now",
            "notes/erase-unused-attachments-now"
        ]);
    });
});

describe("the revision snapshot limit", () => {
    it("holds the erase action out of reach while every snapshot is being kept", () => {
        open();
        // A negative limit keeps everything, so there is no excess for the action to drop.
        expect(button("erase-excess-revisions-button")?.disabled).toBe(true);

        mocks.stored = { ...mocks.stored, revisionSnapshotNumberLimit: "10" };
        open();
        expect(button("erase-excess-revisions-button")?.disabled).toBe(false);
    });

    it("holds a limit typed below the keep-everything one up to it, rather than storing nonsense", () => {
        mocks.stored = { ...mocks.stored, revisionSnapshotNumberLimit: "10" };
        open();

        // The last figure on the page: the three durations above it are the erasure and snapshot
        // intervals, and this is the only one that is a count rather than a time.
        const box = [ ...host.querySelectorAll<HTMLInputElement>("input[type='number']") ].at(-1);
        act(() => {
            if (box) {
                box.value = "-5";
                box.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        expect(mocks.saved.at(-1)).toEqual([ "revisionSnapshotNumberLimit", -1 ]);
    });
});

describe("redirecting the bare domain", () => {
    /** Turns the redirect on, which is what sends the page looking for a share root. */
    async function turnOn() {
        const toggle = host.querySelector<HTMLInputElement>("input.switch-toggle[id^='redirect-bare-domain-']");
        await act(async () => void toggle?.dispatchEvent(new Event("input", { bubbles: true })));
        await act(async () => {});
    }

    it("names the note the bare domain will land on, once there is a shared one", async () => {
        mocks.shareRoots = [ { title: "Public", isShared: () => true } ];
        open();
        await turnOn();

        expect(mocks.showMessage).toHaveBeenCalled();
        expect(mocks.showError).not.toHaveBeenCalled();
        expect(mocks.saved).toContainEqual([ "redirectBareDomain", true ]);
    });

    it("says the note it found is not shared, which is what would make the redirect land nowhere", async () => {
        mocks.shareRoots = [ { title: "Private", isShared: () => false } ];
        open();
        await turnOn();

        expect(mocks.showError).toHaveBeenCalled();
        expect(mocks.showMessage).not.toHaveBeenCalled();
        // Stored all the same: the setting is the user's, and the note can be shared afterwards.
        expect(mocks.saved).toContainEqual([ "redirectBareDomain", true ]);
    });

    it("says there is no share root at all, which is a different thing to fix", async () => {
        mocks.shareRoots = [];
        open();
        await turnOn();

        expect(mocks.showError).toHaveBeenCalled();
    });

    it("looks for nothing when the redirect is being turned off", async () => {
        mocks.stored = { ...mocks.stored, redirectBareDomain: "true" };
        open();
        await turnOn();

        expect(mocks.showMessage).not.toHaveBeenCalled();
        expect(mocks.showError).not.toHaveBeenCalled();
        expect(mocks.saved).toContainEqual([ "redirectBareDomain", false ]);
    });
});

describe("the tags an HTML import may keep", () => {
    it("reads the stored set out as one line, and takes back what is typed over it", () => {
        mocks.json = { allowedHtmlTags: [ "p", "strong", "em" ] };
        open();

        const textarea = host.querySelector<HTMLTextAreaElement>("textarea.allowed-html-tags");
        expect(textarea?.value).toBe("p strong em");

        act(() => {
            if (textarea) {
                textarea.value = "p, strong\nem  b";
                textarea.dispatchEvent(new Event("focusout", { bubbles: true }));
            }
        });

        // Split on commas, newlines or runs of spaces alike — however the list was pasted in.
        expect(mocks.saved.at(-1)).toEqual([ "allowedHtmlTags", [ "p", "strong", "em", "b" ] ]);
    });

    it("puts back the set the sanitizer ships with", () => {
        open();
        act(() => void button("reset-allowed-html-tags-button")?.click());

        expect(mocks.saved.at(-1)).toEqual([ "allowedHtmlTags", SANITIZER_DEFAULT_ALLOWED_TAGS ]);
    });
});

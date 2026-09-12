import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({
    t: (key: string) => key,
    initLocale: vi.fn(),
    getCurrentLanguage: () => "en"
}));

// The language screen reads its own `t` off the react-i18next context, which no provider supplies
// here. Mocked to the same key-echo, so it renders rather than throwing on a null context.
vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "en", changeLanguage: vi.fn(async () => {}) }
    })
}));

const serverMock = vi.hoisted(() => ({
    // Default implementation serves the module-load-time requests transitively imported
    // modules fire (e.g. keyboard_actions fetches its shortcut list on import) — the
    // per-test routing installed in beforeEach overrides it.
    get: vi.fn(async (url: string): Promise<unknown> => {
        if (url === "keyboard-actions") {
            return [];
        }
        return {};
    }),
    post: vi.fn(async (_url: string, _data?: unknown): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

import { afterLanguage, getNetworkAddresses, initialState, openedAtRestore, renderState, SyncFailed, SyncFromServer, SyncInProgress } from "./setup";

type Stats = { outstandingPullCount: number; totalPullCount: number | null; initialized: boolean; lastSyncError?: string | null };

let container: HTMLDivElement;
function renderInto(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

// Preact flushes effects via requestAnimationFrame (~16ms under fake timers), so
// "flushing" means advancing past that; a poll tick is the hook's 1s interval on top.
const flushEffects = () => vi.advanceTimersByTimeAsync(50);
const nextPoll = () => vi.advanceTimersByTimeAsync(1000);

/** Answers the sync form enough for it to let Finish be pressed. */
function fillSyncForm(root: HTMLElement) {
    const host = root.querySelector<HTMLInputElement>("input:not([type=password])");
    const password = root.querySelector<HTMLInputElement>("input[type=password]");

    for (const [ field, value ] of [ [ host, "https://srv" ], [ password, "pw" ] ] as const) {
        if (!field) continue;
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

/** Routes the mocked server.get; `stats` can be swapped between polls. */
let stats: Stats;
function mockRoutes(extra: Record<string, unknown> = {}) {
    serverMock.get.mockImplementation(async (url: string) => {
        if (url === "sync/stats") {
            return stats;
        }
        return extra[url];
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    stats = { outstandingPullCount: 0, totalPullCount: null, initialized: false, lastSyncError: null };
    mockRoutes();
    serverMock.post.mockResolvedValue({});
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("the unlock screen, as the wizard renders it", () => {
    it("puts a real page inside the slide, not an empty one", async () => {
        // Worth asserting rather than assuming: the wizard's pages are absolutely positioned against
        // a container with a fixed height, so a page that renders nothing and a container that has
        // collapsed to nothing look exactly alike — a blank screen with no error to go on.
        const c = renderInto(renderState("unlock", vi.fn()));
        await flushEffects();

        expect(c.querySelector(".page.setup-unlock")).not.toBeNull();
        expect(c.querySelector("input[type=password]")).not.toBeNull();
        // Transparent to layout, so the page it wraps fills the frame rather than sitting in a box
        // of the width setup.css gives every other form.
        expect(c.querySelector("form.setup-unlock-form")).not.toBeNull();
    });
});

describe("the menu, and what each way out of it commits to", () => {
    /** Renders the menu as the wizard does, so the wiring between the two is covered as well. */
    function renderMenu(setState = vi.fn()) {
        renderInto(renderState("firstOptions", setState));
        return setState;
    }

    function card(title: string) {
        return [ ...container.querySelectorAll<HTMLElement>(".setup-option-card") ]
            .find((element) => element.querySelector("h3")?.textContent === title);
    }

    beforeEach(() => {
        window.glob.hasExistingData = undefined;
        vi.stubGlobal("confirm", vi.fn(() => true));
    });

    afterEach(() => {
        window.glob.hasExistingData = undefined;
        vi.unstubAllGlobals();
    });

    it("offers the way back only while there is something to go back to", async () => {
        renderMenu();
        await flushEffects();
        expect(card("setup.keep-existing")).toBeUndefined();

        render(null, container);
        window.glob.hasExistingData = true;
        renderMenu();
        await flushEffects();
        expect(card("setup.keep-existing")).toBeDefined();
    });

    it("leaves the knowledge base alone and reopens it when that way back is taken", async () => {
        window.glob.hasExistingData = true;
        renderMenu();
        await flushEffects();

        card("setup.keep-existing")?.click();
        await flushEffects();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/keep");
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
    });

    it("walks a first run straight to the screen it picked, with nothing to erase", async () => {
        const setState = renderMenu();
        await flushEffects();

        card("setup.new-document")?.click();
        expect(setState).toHaveBeenCalledWith("createNewDocumentOptions");

        card("setup.restore-from-backup")?.click();
        expect(setState).toHaveBeenCalledWith("restoreFromBackup");

        card("setup.sync-from-server")?.click();
        expect(setState).toHaveBeenCalledWith("syncFromServer");

        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
    });

    describe("connecting a desktop app, the one path that erases from here", () => {
        // Every other path erases at the moment it creates a database, server-side. This one waits
        // for another device to push one, and decides it has arrived by seeing a schema appear —
        // which the knowledge base already here would satisfy on its own. So arriving on the screen
        // is what commits, and the erasure happens on the way in.
        it("asks with the browser's own dialog before erasing, then waits for the push", async () => {
            window.glob.hasExistingData = true;
            const setState = renderMenu();
            await flushEffects();

            card("setup.sync-from-desktop")?.click();
            await flushEffects();

            expect(window.confirm).toHaveBeenCalledWith("setup.existing-data-erase-confirm");
            expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
            expect(setState).toHaveBeenCalledWith("syncFromDesktop");
        });

        it("erases nothing and goes nowhere when that dialog is answered no", async () => {
            window.glob.hasExistingData = true;
            vi.stubGlobal("confirm", vi.fn(() => false));
            const setState = renderMenu();
            await flushEffects();

            card("setup.sync-from-desktop")?.click();
            await flushEffects();

            expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
            expect(setState).not.toHaveBeenCalled();
        });

        it("asks nothing on a first run, which has nothing to clear out of the way", async () => {
            const setState = renderMenu();
            await flushEffects();

            card("setup.sync-from-desktop")?.click();
            await flushEffects();

            expect(window.confirm).not.toHaveBeenCalled();
            expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
            expect(setState).toHaveBeenCalledWith("syncFromDesktop");
        });

        it("stays put and says why when the erasure fails, rather than waiting on a push it cannot take", async () => {
            window.glob.hasExistingData = true;
            serverMock.post.mockImplementation(async (url: string) => {
                if (url === "setup/existing/delete") {
                    throw new Error("the database is in use");
                }
                return {};
            });
            const setState = renderMenu();
            await flushEffects();

            card("setup.sync-from-desktop")?.click();
            await flushEffects();

            expect(container.querySelector(".page-error")?.textContent).toContain("the database is in use");
            expect(setState).not.toHaveBeenCalled();
        });
    });
});

describe("the language step, as the wizard renders it", () => {
    it("leads to the offer of a copy, or past it where there is nothing to copy", async () => {
        // The step it leads to is worked out rather than named, and was a hardcoded state before
        // the language moved in front of the offer — so the wiring is worth asserting, not just
        // the function behind it.
        const setState = vi.fn();
        window.glob.hasExistingData = true;
        renderInto(renderState("selectLanguage", setState));
        await flushEffects();

        container.querySelector<HTMLElement>("footer button")?.click();
        expect(setState).toHaveBeenCalledWith("existingData");

        render(null, container);
        window.glob.hasExistingData = undefined;
        const firstRun = vi.fn();
        renderInto(renderState("selectLanguage", firstRun));
        await flushEffects();

        container.querySelector<HTMLElement>("footer button")?.click();
        expect(firstRun).toHaveBeenCalledWith("firstOptions");
    });
});

describe("creating the knowledge base", () => {
    it("asks for the demo content or not, and finishes when the server is done", async () => {
        renderInto(renderState("createNewDocumentWithDemo", vi.fn()));
        await flushEffects();
        expect(serverMock.post).toHaveBeenCalledWith("setup/new-document", { locale: "en" });

        render(null, container);
        serverMock.post.mockClear();
        renderInto(renderState("createNewDocumentEmpty", vi.fn()));
        await flushEffects();
        expect(serverMock.post).toHaveBeenCalledWith("setup/new-document?skipDemoDb", { locale: "en" });
    });

    it("says what stopped it instead of spinning, and offers a way back", async () => {
        // This screen has nothing to poll and no other way of ending, so a request that comes back
        // with an error would otherwise leave it turning for as long as anyone watched it.
        const setState = vi.fn();
        serverMock.post.mockRejectedValue('{"message":"DB not open."}');
        renderInto(renderState("createNewDocumentEmpty", setState));
        await flushEffects();

        expect(container.querySelector(".page-error")?.textContent).toContain("DB not open.");
        expect(container.textContent).toContain("setup.create-new-document-failed");

        container.querySelector<HTMLElement>(".back-button")?.click();
        expect(setState).toHaveBeenCalledWith("createNewDocumentOptions");
    });

    it("reads whatever the failure had to say, in each of the shapes one arrives in", async () => {
        // A rejected request is not an Error: the client's own layer rejects with the response body
        // as a string, which is JSON for a server error and a bare word when the browser dropped it.
        for (const [ rejection, expected ] of [
            [ new Error("an Error"), "an Error" ],
            [ '{"message":"a JSON body"}', "a JSON body" ],
            [ "rejected by browser", "rejected by browser" ],
            [ 42, "42" ]
        ] as const) {
            serverMock.post.mockRejectedValue(rejection);
            renderInto(renderState("createNewDocumentEmpty", vi.fn()));
            await flushEffects();

            expect(container.querySelector(".page-error")?.textContent).toContain(expected);
            render(null, container);
            container.remove();
        }
    });

    it("stops claiming there is anything to go back to once the server has erased it", async () => {
        // This path erases server-side as its first step, so a failure may well have left nothing
        // behind the wizard — and the page it fails on came from a start that still believed there
        // was. Asked again rather than assumed, since only the server knows.
        window.glob.hasExistingData = true;
        mockRoutes({ "setup/status": { hasExistingData: false } });
        serverMock.post.mockRejectedValue(new Error("the disk is full"));

        renderInto(renderState("createNewDocumentEmpty", vi.fn()));
        await flushEffects();

        expect(window.glob.hasExistingData).toBe(false);
    });
});

describe("SyncInProgress", () => {
    it("switches to the failure screen when the server reports a failed sync", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "401 Logged in session not found" };
        renderInto(<SyncInProgress device="server" setState={setState} />);
        await flushEffects();
        expect(setState).toHaveBeenCalledWith("syncFailed");
    });

    it("ignores sync errors in the sync-from-desktop flow (the other device syncs, not us)", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        renderInto(<SyncInProgress device="desktop" setState={setState} />);
        await flushEffects();
        expect(setState).not.toHaveBeenCalled();
    });

    it("stays on the progress screen while the sync is healthy", async () => {
        const setState = vi.fn();
        renderInto(<SyncInProgress device="server" setState={setState} />);
        await flushEffects();
        expect(setState).not.toHaveBeenCalled();
    });

    it("is wired for both flows in renderState", async () => {
        for (const state of ["syncFromServerInProgress", "syncFromDesktopInProgress"] as const) {
            const c = renderInto(renderState(state, vi.fn()));
            await flushEffects();
            expect(c.querySelector(".page.sync-in-progress")).not.toBeNull();
            render(null, c);
            c.remove();
        }
    });
});

describe("SyncFailed", () => {
    it("shows the recorded error and a hint, and renderState wires the syncFailed case", async () => {
        stats = { ...stats, lastSyncError: "Request to PUT https://[redacted]/api/sync/update failed" };
        const c = renderInto(renderState("syncFailed", vi.fn()));
        await flushEffects();

        const pre = c.querySelector(".admonition-body pre");
        expect(pre?.textContent).toBe("Request to PUT https://[redacted]/api/sync/update failed");
        expect(c.querySelector(".admonition-body p")?.textContent).toBe("setup.sync-failed-hint");
    });

    it("retries via sync/now and hands back to the progress screen once the attempt starts", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        const c = renderInto(<SyncFailed setState={setState} />);
        await flushEffects();

        const retry = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("setup.button-retry"));
        expect(retry).toBeDefined();
        retry?.click();
        expect(serverMock.post).toHaveBeenCalledWith("sync/now");

        // The server clears the error as the new attempt starts; the next poll notices.
        stats = { ...stats, lastSyncError: null };
        await nextPoll();
        expect(setState).toHaveBeenCalledWith("syncFromServerInProgress");
    });

    it("finishes setup directly when the retry converges before the next transition", async () => {
        const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        renderInto(<SyncFailed setState={setState} />);
        await flushEffects();

        stats = { ...stats, lastSyncError: null, initialized: true };
        await nextPoll();
        expect(reload).toHaveBeenCalled();
        expect(setState).not.toHaveBeenCalledWith("syncFromServerInProgress");
    });

    it("goes back to the server form", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        const c = renderInto(<SyncFailed setState={setState} />);
        await flushEffects();

        const back = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("setup.button-back"));
        back?.click();
        expect(setState).toHaveBeenCalledWith("syncFromServer");
    });
});

describe("SyncFromServer", () => {
    it("prefills the stored server address and proxy after a failed attempt", async () => {
        mockRoutes({ "setup/status": { syncServerHost: "https://old.example.com", syncProxy: "http://proxy:3128" } });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);
        await flushEffects();

        const inputs = [...c.querySelectorAll("input")];
        expect(inputs.some((i) => i.value === "https://old.example.com")).toBe(true);
        expect(inputs.some((i) => i.value === "http://proxy:3128")).toBe(true);
    });

    it("does not clobber a value the user already typed before the prefill resolves", async () => {
        let resolveStatus: (v: unknown) => void = () => {};
        serverMock.get.mockImplementation((url: string) => {
            if (url === "setup/status") {
                return new Promise((resolve) => {
                    resolveStatus = resolve;
                });
            }
            return Promise.resolve(stats);
        });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);

        const host = c.querySelector<HTMLInputElement>("input");
        expect(host).not.toBeNull();
        if (!host) return;
        host.value = "https://typed.example.com";
        host.dispatchEvent(new Event("input", { bubbles: true }));

        resolveStatus({ syncServerHost: "https://stored.example.com", syncProxy: "" });
        await flushEffects();

        expect(host.value).toBe("https://typed.example.com");
    });

    it("stops claiming there is anything to go back to when the failure came after the erase", async () => {
        // Reaching the server can fail on something the user corrects right here, and the knowledge
        // base is deliberately still there for those. Past the point the server answers, the last
        // step erases before it builds — so which of the two happened is asked, not assumed.
        window.glob.hasExistingData = true;
        mockRoutes({ "setup/status": { hasExistingData: false } });
        serverMock.post.mockResolvedValue({ result: "failure", error: "the disk is full" });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);
        await flushEffects();
        fillSyncForm(c);
        await flushEffects();

        c.querySelector<HTMLElement>("footer button")?.click();
        await flushEffects();

        expect(window.glob.hasExistingData).toBe(false);
        expect(c.querySelector(".page-error")?.textContent).toContain("setup.sync-failed");
    });

    it("keeps it where the server refused the credentials, which erases nothing", async () => {
        window.glob.hasExistingData = true;
        mockRoutes({ "setup/status": { hasExistingData: true } });
        serverMock.post.mockResolvedValue({ result: "failure", error: "Incorrect password" });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);
        await flushEffects();
        fillSyncForm(c);
        await flushEffects();

        c.querySelector<HTMLElement>("footer button")?.click();
        await flushEffects();

        expect(window.glob.hasExistingData).toBe(true);
    });

    it("leaves the form empty on a fresh setup (no stored sync options)", async () => {
        mockRoutes({ "setup/status": { isInitialized: false, schemaExists: false } });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);
        await flushEffects();

        const host = c.querySelector<HTMLInputElement>("input");
        expect(host?.value).toBe("");
    });
});

describe("getNetworkAddresses, deciding whose word to trust for this device's address", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("trusts the page's own address when a plain browser reached it over the network", async () => {
        vi.stubGlobal("location", { protocol: "http:", host: "192.168.1.20:8080", hostname: "192.168.1.20" });

        expect(await getNetworkAddresses()).toEqual({ addresses: [ "http://192.168.1.20:8080" ], reachableOnNetwork: true });
        expect(serverMock.get).not.toHaveBeenCalledWith("network-addresses");
    });

    it("distrusts its own loopback address and asks the server instead, as a webview on the same device would hit", async () => {
        vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8080", hostname: "127.0.0.1" });
        mockRoutes({ "network-addresses": { addresses: [ "http://192.168.1.20:8080" ], reachableOnNetwork: true } });

        expect(await getNetworkAddresses()).toEqual({ addresses: [ "http://192.168.1.20:8080" ], reachableOnNetwork: true });
        expect(serverMock.get).toHaveBeenCalledWith("network-addresses");
    });

    it("distrusts a bracketed IPv6 loopback address the same way", async () => {
        vi.stubGlobal("location", { protocol: "http:", host: "[::1]:8080", hostname: "[::1]" });
        mockRoutes({ "network-addresses": { addresses: [ "http://192.168.1.20:8080" ], reachableOnNetwork: true } });

        expect(await getNetworkAddresses()).toEqual({ addresses: [ "http://192.168.1.20:8080" ], reachableOnNetwork: true });
        expect(serverMock.get).toHaveBeenCalledWith("network-addresses");
    });

    it("still asks the server in Electron, whose location points at the internal protocol rather than a real listener", async () => {
        vi.stubGlobal("electronApi", {});
        vi.stubGlobal("location", { protocol: "trilium-app:", host: "", hostname: "" });
        mockRoutes({ "network-addresses": { addresses: [], reachableOnNetwork: false } });

        expect(await getNetworkAddresses()).toEqual({ addresses: [], reachableOnNetwork: false });
        expect(serverMock.get).toHaveBeenCalledWith("network-addresses");
    });
});

describe("where the wizard opens", () => {
    it("starts at the language step on a first run", () => {
        expect(initialState({})).toBe("selectLanguage");
    });

    it("starts there whatever a marker asked for, so the rest is read in the chosen language", () => {
        expect(initialState({ setupTargetScreen: "restore-backup" })).toBe("selectLanguage");
        expect(initialState({ hasExistingData: true })).toBe("selectLanguage");
        expect(initialState({ hasExistingData: true, setupTargetScreen: "restore-backup" }))
            .toBe("selectLanguage");
    });

    it("goes straight to the backup screen, which is the one that replaces nothing", () => {
        // Unlike a restore, a backup leaves the knowledge base exactly as it is, so the offer of a
        // copy would be offering the very thing the screen after it is about to make.
        expect(initialState({ hasExistingData: true, setupTargetScreen: "backup-database" }))
            .toBe("backupDatabase");

        // Except where there is nothing to back up, which is not a state the app can ask for.
        expect(initialState({ setupTargetScreen: "backup-database" })).toBe("selectLanguage");
    });

    it("asks for the password first where the wizard is standing over a knowledge base", () => {
        // Before everything, including the resumed sync below: what is behind the wizard is a real
        // knowledge base, and every screen past this one can replace it.
        expect(initialState({ setupAuthRequired: true, hasExistingData: true })).toBe("unlock");
        expect(initialState({ setupAuthRequired: true, hasExistingData: true, syncInProgress: true }))
            .toBe("unlock");
        expect(initialState({ setupAuthRequired: true, hasExistingData: true, setupTargetScreen: "restore-backup" }))
            .toBe("unlock");
    });

    it("resumes an interrupted sync before anything else, since that one cannot wait", () => {
        expect(initialState({ syncInProgress: true })).toBe("syncFromServerInProgress");
        expect(initialState({ syncInProgress: true, setupTargetScreen: "restore-backup" }))
            .toBe("syncFromServerInProgress");
        expect(initialState({ syncInProgress: true, hasExistingData: true, setupTargetScreen: "backup-database" }))
            .toBe("syncFromServerInProgress");
    });

    it("ignores a screen it does not know rather than guessing at one", () => {
        expect(initialState({ setupTargetScreen: "createNewDocumentEmpty" as never }))
            .toBe("selectLanguage");
        expect(afterLanguage({ setupTargetScreen: "createNewDocumentEmpty" as never }))
            .toBe("firstOptions");
    });
});

describe("where the language step leads", () => {
    it("offers a copy of the existing knowledge base, before the menu that replaces it", () => {
        // After the language rather than before, so a question about the user's own knowledge base
        // is put in the language they have just chosen.
        expect(afterLanguage({ hasExistingData: true })).toBe("existingData");
        expect(afterLanguage({ hasExistingData: true, setupTargetScreen: "restore-backup" }))
            .toBe("existingData");
    });

    it("goes straight to the menu on a first run, which has nothing to copy", () => {
        expect(afterLanguage({})).toBe("firstOptions");
    });

    it("goes where a marker asked once there is nothing left to lose", () => {
        // A restore reached this way skips the menu: it is the errand the app was sent here for.
        expect(afterLanguage({ setupTargetScreen: "restore-backup" })).toBe("restoreFromBackup");
    });

    it("knows when the restore is the whole of what the wizard was opened for", () => {
        // Which decides whether that screen offers a way back: there is one only where the user
        // walked into the restore through the wizard's own menu.
        expect(openedAtRestore({ setupTargetScreen: "restore-backup" })).toBe(true);
        expect(openedAtRestore({ hasExistingData: true, setupTargetScreen: "restore-backup" })).toBe(true);
        expect(openedAtRestore({})).toBe(false);
        expect(openedAtRestore({ setupTargetScreen: "backup-database" })).toBe(false);
    });
});

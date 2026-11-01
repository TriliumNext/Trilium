import type { ForeignResourceEntry, ResourceInfo, WebSocketMessage } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    resources: [] as ResourceInfo[],
    foreign: [] as ForeignResourceEntry[],
    freeBytes: null as number | null,
    requests: 0,
    confirmed: true,
    removed: [] as string[],
    electron: true,
    opened: [] as string[],
    revealed: [] as string[],
    handlers: [] as ((message: WebSocketMessage) => void)[]
}));

// The real i18n is not initialized under test, so `Trans` would render the bare key and drop what
// it wires in; the stub renders its values and the components themselves.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, values, components }: {
        i18nKey: string, values: object, components: Record<string, preact.VNode>
    }) => (
        <span data-i18n-key={i18nKey}>{JSON.stringify(values)}{Object.values(components)}</span>
    )
}));

vi.mock("../../../services/server", () => ({
    default: {
        get: async (url: string) => {
            if (url !== "resources") {
                return [];
            }
            mocks.requests++;
            return {
                resources: mocks.resources, foreign: mocks.foreign, freeBytes: mocks.freeBytes, download: null
            };
        },
        remove: async (url: string) => {
            mocks.removed.push(url);
        }
    }
}));

vi.mock("../../../services/dialog", () => ({
    default: { confirm: async () => mocks.confirmed }
}));

vi.mock("../../../services/ws", () => {
    const ws = {
        subscribeToMessages: (handler: (message: WebSocketMessage) => void) => {
            mocks.handlers.push(handler);
        },
        unsubscribeToMessage: (handler: (message: WebSocketMessage) => void) => {
            mocks.handlers = mocks.handlers.filter((h) => h !== handler);
        }
    };
    return { ...ws, default: ws };
});

vi.mock("../../../services/i18n", () => ({
    t: (key: string, args?: Record<string, string>) => args ? `${key} ${JSON.stringify(args)}` : key
}));

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron
}));

vi.mock("../../../services/open", () => ({
    default: {
        openDirectory: async (directory: string) => {
            mocks.opened.push(directory);
        },
        revealFile: async (filePath: string) => {
            mocks.revealed.push(filePath);
        }
    }
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import ResourcesSettings from "./resources";

const MIB = 1024 * 1024;
let host: HTMLElement;

beforeEach(() => {
    mocks.resources = [
        resource({
            id: "test.installed", installed: true, size: 2048 * MIB, downloadedSize: 2048 * MIB,
            directory: "/data/resources/test.installed-abc"
        }),
        resource({ id: "test.partial", downloadedSize: 4 * MIB }),
        resource({ id: "test.missing" })
    ];
    mocks.foreign = [];
    mocks.revealed = [];
    mocks.requests = 0;
    mocks.freeBytes = null;
    mocks.confirmed = true;
    mocks.removed = [];
    mocks.electron = true;
    mocks.opened = [];
    mocks.handlers = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => render(null, host));
    document.body.innerHTML = "";
});

async function open() {
    await act(async () => {
        render(<ResourcesSettings />, host);
    });
}

describe("ResourcesSettings", () => {
    it("lists the resources installed or partly downloaded, with their status and size", async () => {
        await open();

        const rows = [ ...host.querySelectorAll(".resources-item") ];
        expect(rows.map((row) => row.querySelector(".tn-card-option-title")?.textContent))
            .toEqual([ "test.installed", "test.partial" ]);
        expect(rows.map((row) => row.querySelector(".resources-status small")?.textContent)).toEqual([
            "resources_options.installed",
            `resources_options.partially_downloaded {"downloaded":"4.00 MiB","size":"10 MiB"}`
        ]);
        expect([ ...host.querySelectorAll(".resources-size") ].map((size) => size.textContent))
            .toEqual([ "2.00 GiB", "<0.01 GiB", "2.00 GiB" ]);
        expect(rows[0].querySelector(".resource-download-author")?.getAttribute("href"))
            .toBe("https://example.com/model");
        expect(rows[0].querySelector(".resource-download-license")?.getAttribute("href"))
            .toBe("https://opensource.org/license/mit");
    });

    it("lists files copied in but not yet checked, and counts them in the space used", async () => {
        mocks.resources = [ resource({ id: "test.copied", unverifiedSize: 6 * MIB }) ];
        await open();
        expect([ ...host.querySelectorAll(".resources-size") ].map((size) => size.textContent))
            .toEqual([ "6.00 MiB", "6.00 MiB" ]);

        const rows = [ ...host.querySelectorAll(".resources-item") ];
        expect(rows.map((row) => row.querySelector(".tn-card-option-title")?.textContent))
            .toEqual([ "test.copied" ]);
        expect(rows[0].querySelector(".resources-status small")?.textContent)
            .toBe("resources_options.unverified");
        expect(host.querySelector(".resources-total .resources-size")?.textContent).toBe("6.00 MiB");
    });

    it("opens the folder of an installed resource, on desktop only", async () => {
        await open();
        const buttons = () => [ ...host.querySelectorAll(".resources-item") ]
            .map((row) => row.querySelector<HTMLElement>(".bx-folder-open"));
        const [ installed, partial ] = buttons();
        expect(installed).not.toBeNull();
        expect(partial).toBeNull();
        await act(async () => installed?.click());
        expect(mocks.opened).toEqual([ "/data/resources/test.installed-abc" ]);

        act(() => render(null, host));
        mocks.electron = false;
        await open();
        expect(buttons()).toEqual([ null, null ]);
    });

    it("deletes a resource once confirmed, then reads the list again", async () => {
        await open();
        const click = async () => {
            const button = host.querySelector<HTMLElement>(".resources-item .destructive-action-icon");
            expect(button).not.toBeNull();
            await act(async () => button?.click());
        };

        mocks.confirmed = false;
        await click();
        expect(mocks.removed).toEqual([]);
        expect(mocks.requests).toBe(1);

        mocks.confirmed = true;
        await click();
        expect(mocks.removed).toEqual([ "resources/test.installed" ]);
        expect(mocks.requests).toBe(2);
    });

    it("states the free space below the space used, when it can be read", async () => {
        const description = () => host.querySelector(".resources-total .tn-card-option-description");
        mocks.freeBytes = 38 * 1024 * MIB;
        await open();
        expect(description()?.textContent).toBe(`resource_download.free_space {"size":"38 GiB"}`);

        act(() => render(null, host));
        mocks.freeBytes = null;
        await open();
        expect(description()).toBeNull();
    });

    it("lists the foreign entries after the resources, counting them in the space used", async () => {
        mocks.foreign = [
            foreign({ name: "notes.txt", kind: "unknown", size: 1 * MIB, isDirectory: false }),
            foreign({
                name: "test.installed-000000000000", kind: "outdated", resourceId: "test.installed",
                title: "Old model", icon: "bx bx-captions", size: 1024 * MIB
            })
        ];
        await open();

        const rows = [ ...host.querySelectorAll(".resources-item") ];
        expect(rows.map((row) => row.querySelector(".tn-card-option-title")?.textContent))
            .toEqual([ "test.installed", "test.partial", "notes.txt", "Old model" ]);
        expect(rows.slice(2).map((row) => row.querySelector(".resources-status small")?.textContent))
            .toEqual([ "resources_options.unknown", "resources_options.outdated" ]);
        expect(rows.map((row) => row.classList.contains("resources-foreign")))
            .toEqual([ false, false, true, true ]);
        expect(rows[2].querySelector(".resources-icon")?.className).toContain("bx-file");
        expect(rows[3].querySelector(".resources-icon")?.className).toContain("bx-captions");
        expect(host.querySelector(".resources-total .resources-size")?.textContent).toBe("3.00 GiB");
    });

    it("opens and deletes a foreign entry by its name", async () => {
        mocks.resources = [];
        mocks.foreign = [
            foreign({ name: "notes.txt", kind: "unknown", isDirectory: false }),
            foreign({ name: "stray" })
        ];
        await open();
        const [ file, directory ] = [ ...host.querySelectorAll(".resources-item") ];

        await act(async () => file.querySelector<HTMLElement>(".bx-folder-open")?.click());
        await act(async () => directory.querySelector<HTMLElement>(".bx-folder-open")?.click());
        expect(mocks.revealed).toEqual([ "/data/resources/notes.txt" ]);
        expect(mocks.opened).toEqual([ "/data/resources/stray" ]);

        await act(async () => directory.querySelector<HTMLElement>(".destructive-action-icon")?.click());
        expect(mocks.removed).toEqual([ "resources/foreign/stray" ]);
    });

    it("shows an empty state when nothing is downloaded", async () => {
        mocks.resources = [ resource({ id: "test.missing" }) ];
        await open();

        expect(host.querySelector(".resources-item")).toBeNull();
        expect(host.textContent).toContain("resources_options.no_resources");
    });

    it("reads the resources again once a download ends, but not while it runs", async () => {
        await open();
        expect(mocks.requests).toBe(1);

        const send = async (status: "downloading" | "succeeded") => {
            await act(async () => {
                for (const handler of mocks.handlers) {
                    handler({ type: "resource-download", download: { status } } as WebSocketMessage);
                }
            });
        };
        await send("downloading");
        expect(mocks.requests).toBe(1);
        await send("succeeded");
        expect(mocks.requests).toBe(2);
    });
});

function foreign(overrides: Partial<ForeignResourceEntry> & { name: string }): ForeignResourceEntry {
    return {
        path: `/data/resources/${overrides.name}`,
        kind: "unknown",
        resourceId: null,
        title: null,
        icon: null,
        size: MIB,
        isDirectory: true,
        ...overrides
    };
}

function resource(overrides: Partial<ResourceInfo> & { id: string }): ResourceInfo {
    return {
        title: overrides.id,
        description: "For tests",
        icon: "bx bx-test-tube",
        license: "MIT",
        size: 10 * MIB,
        downloadedSize: 0,
        unverifiedSize: 0,
        sources: [ "example.com" ],
        author: "Test Lab",
        homepage: "https://example.com/model",
        licenseUrl: "https://opensource.org/license/mit",
        installed: false,
        directory: null,
        ...overrides
    };
}

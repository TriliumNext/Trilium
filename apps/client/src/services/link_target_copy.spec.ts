import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MenuCommandItem } from "../menus/context_menu.js";
import { buildNote } from "../test/easy-froca";
import type { LinkTarget } from "./link_targets.js";

const { showMenu, showError, showMessage, showPersistent, getNoteShareLink } = vi.hoisted(() => ({
    showMenu: vi.fn(),
    showError: vi.fn(),
    showMessage: vi.fn(),
    showPersistent: vi.fn(),
    getNoteShareLink: vi.fn<() => string | null>(() => null)
}));
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));
vi.mock("./toast.js", () => ({ default: { showError, showMessage, showPersistent } }));
vi.mock("../menus/context_menu.js", () => ({ default: { show: showMenu } }));
vi.mock("./share_link.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./share_link.js")>(),
    getNoteShareLink
}));

import { showTargetReferenceMenu, type TargetReferenceSource } from "./link_target_copy.js";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

/** The data of each write, read as text once the write has read it. */
let writes: Promise<Record<string, string>>[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    writes = [];
    (globalThis as any).ClipboardItem = class {
        constructor(public readonly data: Record<string, Promise<Blob>>) {}
    };
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            write: vi.fn((items: { data: Record<string, Promise<Blob>> }[]) => {
                const entries = Object.entries(items[0].data).map(async ([ type, blob ]) =>
                    [ type, await (await blob).text() ] as const);
                const written = Promise.all(entries).then(Object.fromEntries);
                writes.push(written);
                return written.then(() => undefined);
            })
        }
    });
});

afterEach(() => {
    delete (globalThis as any).ClipboardItem;
    if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
});

/** A heading target of `note` with the block id `block`, given by `createReference()` if set. */
function heading(title: string, params?: Record<string, string>, reference?: string): LinkTarget {
    const target: LinkTarget = {
        kind: "heading",
        title,
        params,
        createLinkPath: () => `root/abc${target.params?.block ? `?block=${target.params.block}` : ""}`
    };
    if (reference) {
        target.createReference = async () => {
            target.params = { block: reference };
        };
    }
    return target;
}

/** Opens the menu for `source` and returns its rows. */
function openMenu(source: TargetReferenceSource) {
    const event = new MouseEvent("contextmenu", { clientX: 10, clientY: 20 });
    showTargetReferenceMenu(event, source);
    return showMenu.mock.calls.at(-1)?.[0].items as MenuCommandItem<string>[];
}

/** Picks the row at `index` of `items`, as the context menu does. */
function pick(items: MenuCommandItem<string>[], index: number) {
    const item = items[index];
    item.handler?.(item, new MouseEvent("click"));
}

async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("showTargetReferenceMenu", () => {
    it("offers the public link only for a shared note whose page lands on the target", () => {
        const note = buildNote({ title: "Guide" });
        const source = { note, getTarget: async () => null, hasPublicLinks: true };

        expect(openMenu(source).map((item) => [ item.title, item.uiIcon ])).toStrictEqual([
            [ "block_reference.copy_reference", "bx bx-link" ]
        ]);
        getNoteShareLink.mockReturnValue("https://example.com/share/guide");
        expect(openMenu(source).map((item) => [ item.title, item.uiIcon ])).toStrictEqual([
            [ "block_reference.copy_reference", "bx bx-link" ],
            [ "block_reference.copy_share_link", "bx bx-world" ]
        ]);
        expect(openMenu({ ...source, hasPublicLinks: false })).toHaveLength(1);
    });

    it("starts the write in the pick, and copies a reference link once the target has one", async () => {
        const note = buildNote({ title: "Guide" });
        let resolveTarget: (target: LinkTarget | null) => void = () => {};
        const getTarget = vi.fn(() => new Promise<LinkTarget | null>((resolve) => {
            resolveTarget = resolve;
        }));
        const items = openMenu({ note, getTarget, hasPublicLinks: true });
        expect(getTarget).not.toHaveBeenCalled();

        pick(items, 0);
        expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
        resolveTarget(heading("Setup", undefined, "New"));
        expect(await writes[0]).toStrictEqual({
            "text/plain": "#root/abc?block=New",
            "text/html": `<a class="reference-link" href="#root/abc?block=New">Guide - Setup</a>`
        });
        await flush();
        expect(showMessage).toHaveBeenCalledExactlyOnceWith("clipboard.copy_success");

        // A target without a title is named by the note.
        pick(openMenu({ note, getTarget: async () => heading("", { block: "a" }), hasPublicLinks: true }), 0);
        expect((await writes[1])["text/html"]).toContain(">Guide</a>");
    });

    it("copies the link on the shared page, with the block alone", async () => {
        const note = buildNote({ title: "Guide" });
        getNoteShareLink.mockReturnValue("https://example.com/share/guide");
        const target = heading("Setup", { block: "a b", page: "3" });
        const items = openMenu({ note, getTarget: async () => target, hasPublicLinks: true });

        pick(items, 1);
        expect(await writes[0]).toStrictEqual({
            "text/plain": "https://example.com/share/guide?block=a%20b"
        });
    });

    it("shows one toast for a target that cannot be linked, and writes nothing", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const note = buildNote({ title: "Guide" });
        getNoteShareLink.mockReturnValue("https://example.com/share/guide");
        const failing: Array<() => Promise<LinkTarget | null>> = [
            async () => null,
            async () => { throw new Error("offline"); },
            async () => heading("Setup"),
            async () => {
                const target = heading("Setup");
                target.createReference = async () => { throw new Error("409"); };
                return target;
            }
        ];

        for (const getTarget of failing) {
            for (const row of [ 0, 1 ]) {
                showError.mockClear();
                pick(openMenu({ note, getTarget, hasPublicLinks: true }), row);
                await expect(writes.at(-1)).rejects.toThrow();
                await flush();
                expect(showError).toHaveBeenCalledExactlyOnceWith("block_reference.copy_failed");
            }
        }

        // A target that a public link cannot reach: an anchor, which has no block.
        showError.mockClear();
        const anchor: LinkTarget = {
            kind: "anchor", title: "top", params: { bookmark: "top" },
            createLinkPath: () => "root/abc?bookmark=top"
        };
        pick(openMenu({ note, getTarget: async () => anchor, hasPublicLinks: true }), 1);
        await expect(writes.at(-1)).rejects.toThrow();
        await flush();
        expect(showError).toHaveBeenCalledExactlyOnceWith("block_reference.copy_failed");
        expect(showMessage).not.toHaveBeenCalled();
        expect(showPersistent).not.toHaveBeenCalled();
    });
});

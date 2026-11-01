import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MergedFind, { type FindTarget, type HostFindTarget } from "./merged_find";
import {
    registerEmbedFindTarget, revealContentEmbed
} from "./type_widgets/text/content_embed_tools";

vi.mock("./type_widgets/text/content_embed_tools", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./type_widgets/text/content_embed_tools")>()),
    revealContentEmbed: vi.fn()
}));

const OPTIONS = { matchCase: false, wholeWord: false };

let log: string[];
let cleanups: (() => void)[];

beforeEach(() => {
    log = [];
    cleanups = [];
    vi.mocked(revealContentEmbed).mockImplementation((embed, isRevealed) => {
        log.push(`${embed.id}.box(${isRevealed})`);
    });
});

afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    document.body.replaceChildren();
    vi.clearAllMocks();
});

describe("MergedFind", () => {
    it("searches the host and the embeds that have a target as one document", async () => {
        const { find, host, targets } = setUp();

        expect(await find.find("needle", OPTIONS)).toBe(8);
        expect(host.find).toHaveBeenCalledWith("needle", OPTIONS);
        expect(targets.a.find).toHaveBeenCalledWith("needle", OPTIONS);

        const order: string[] = [];
        for (let index = 0; index < 8; index++) {
            log = [];
            find.highlight(index);
            order.push(log.find((entry) => !entry.includes("null") && entry.includes(".highlight"))
                ?? "");
        }
        expect(order).toEqual([
            "host.highlight(0)", "host.highlight(1)", "a.highlight(0)", "a.highlight(1)",
            "c.highlight(0)", "host.highlight(2)", "host.highlight(3)", "host.highlight(4)"
        ]);
    });

    it("clears the match it leaves before revealing and highlighting the next", async () => {
        const { find } = setUp();
        await find.find("needle", OPTIONS);

        find.highlight(1);
        log = [];
        find.highlight(2);
        expect(log).toEqual([
            "host.highlight(null)", "host.revealEmbed(a)", "a.box(true)", "a.highlight(0)"
        ]);

        log = [];
        find.highlight(4);
        expect(log).toEqual([
            "a.highlight(null)", "host.revealEmbed(c)", "c.box(true)", "c.highlight(0)",
            "a.box(false)"
        ]);

        log = [];
        find.highlight(5);
        expect(log).toEqual([
            "c.highlight(null)", "host.highlight(2)", "c.box(false)", "host.revealEmbed(null)"
        ]);

        log = [];
        find.highlight(null);
        expect(log).toEqual([ "host.highlight(null)" ]);
    });

    it("starts at the selection of the host, else at the first match below the top", async () => {
        const { find, host, targets } = setUp();
        await find.find("needle", OPTIONS);

        host.getSelectedMatch = () => 3;
        expect(find.getStartMatch(100)).toBe(6);

        host.getSelectedMatch = () => null;
        host.firstBelow = 2;
        targets.a.firstBelow = 1;
        expect(find.getStartMatch(100)).toBe(3);
        expect(targets.a.getFirstMatchBelow).toHaveBeenCalledWith(100);

        host.firstBelow = null;
        targets.a.firstBelow = null;
        expect(find.getStartMatch(100)).toBe(0);
    });

    it("replaces matches only where the content can change", async () => {
        const { find, host, targets } = setUp({ isAReadOnly: true });
        await find.find("needle", OPTIONS);

        expect(find.canReplace(2)).toBe(false);
        expect(await find.replace(2, "pin")).toBe(8);
        expect(targets.a.replace).not.toHaveBeenCalled();

        expect(find.canReplace(5)).toBe(true);
        expect(await find.replace(5, "pin")).toBe(7);
        expect(host.replace).toHaveBeenCalledWith(2, "pin");

        expect(await find.replaceAll("pin")).toBe(2);
        expect(host.replaceAll).toHaveBeenCalledWith("pin");
        expect(targets.c.replaceAll).toHaveBeenCalledWith("pin");
        find.highlight(1);
        expect(log.at(-1)).toBe("a.highlight(1)");
    });

    it("closes every target, the one of the current match on that match", async () => {
        const { find, host, targets } = setUp();
        await find.find("needle", OPTIONS);
        find.highlight(3);
        targets.a.close.mockReturnValue(true);

        expect(find.close(3)).toBe(true);
        expect(targets.a.close).toHaveBeenCalledWith(1);
        expect(targets.c.close).toHaveBeenCalledWith(null);
        expect(host.close).toHaveBeenCalledWith(null);
        expect(log).toContain("a.box(false)");
        expect(find.canReplace(0)).toBe(false);
    });

    it("watches the content of its host, where the host can change", () => {
        const { find, host } = setUp();
        expect(() => find.watchContent(vi.fn())()).not.toThrow();

        const stop = vi.fn();
        const watchContent = vi.fn((_callback: () => void) => stop);
        Object.assign(host, { watchContent });
        const callback = vi.fn();
        expect(find.watchContent(callback)).toBe(stop);
        expect(watchContent).toHaveBeenCalledWith(callback);
    });

    it("closes the targets of embeds that left, and ignores an overtaken search", async () => {
        const { find, host, targets, unregisterA } = setUp();
        await find.find("needle", OPTIONS);
        unregisterA();

        let finishSlowSearch: (count: number) => void = () => {};
        host.find.mockImplementationOnce(() => new Promise((resolve) => {
            finishSlowSearch = resolve;
        }));
        const slowSearch = find.find("slow", OPTIONS);
        expect(targets.a.close).toHaveBeenCalledWith(null);

        host.count = 1;
        expect(await find.find("fast", OPTIONS)).toBe(2);
        finishSlowSearch(5);
        await slowSearch;
        expect(find.canReplace(1)).toBe(true);
        expect(find.canReplace(2)).toBe(false);
        expect(targets.a.find).toHaveBeenCalledTimes(1);
    });
});

/**
 * A host with five matches and four embeds: `a` with two matches after the second match of the
 * host, `b` with no target, `c` with one match right after `a`, and `d` with none.
 */
function setUp({ isAReadOnly = false } = {}) {
    const embeds = Object.fromEntries([ "a", "b", "c", "d" ].map((id) => [ id, createEmbed(id) ]));
    const matchesBefore = new Map([
        [ embeds.a, 2 ], [ embeds.b, 2 ], [ embeds.c, 2 ], [ embeds.d, 4 ]
    ]);
    const hostTarget = createTarget("host", 5);
    const host = Object.assign(hostTarget, {
        getEmbeds: vi.fn(() => Object.values(embeds)),
        countMatchesBefore: vi.fn((embed: HTMLElement) => (
            Math.min(matchesBefore.get(embed) ?? 0, hostTarget.count)
        )),
        revealEmbed: vi.fn((embed: HTMLElement | null) => {
            log.push(`host.revealEmbed(${embed?.id ?? null})`);
        }),
        getSelectedMatch: (): number | null => null
    }) satisfies HostFindTarget;
    const targets = {
        a: createTarget("a", 2, !isAReadOnly),
        c: createTarget("c", 1),
        d: createTarget("d", 0)
    };
    const unregisterA = register(embeds.a, targets.a);
    register(embeds.c, targets.c);
    register(embeds.d, targets.d);

    return { find: new MergedFind(host), host, targets, unregisterA };
}

function createTarget(name: string, initialCount: number, isEditable = true) {
    const target = {
        count: initialCount,
        firstBelow: null as number | null,
        find: vi.fn(async (_term: string, _options: typeof OPTIONS) => target.count),
        highlight: vi.fn((index: number | null) => {
            log.push(`${name}.highlight(${index})`);
        }),
        getFirstMatchBelow: vi.fn((_top: number) => target.firstBelow),
        canReplace: vi.fn((_index: number) => isEditable),
        replace: vi.fn(async (_index: number, _text: string) => --target.count),
        replaceAll: vi.fn(async (_text: string) => {
            if (isEditable) target.count = 0;
            return target.count;
        }),
        close: vi.fn((_index: number | null) => false)
    } satisfies FindTarget & { count: number; firstBelow: number | null };
    return target;
}

function createEmbed(id: string) {
    const embed = document.createElement("figure");
    embed.className = "include-note";
    embed.id = id;
    embed.innerHTML = `<div class="include-note-wrapper"><div class="include-note-content">`
        + `<div class="content"></div></div></div>`;
    document.body.append(embed);
    return embed;
}

function register(embed: HTMLElement | undefined, target: FindTarget) {
    const content = embed?.querySelector<HTMLElement>(".content");
    if (!content) throw new Error("The embed has no content.");
    const unregister = registerEmbedFindTarget(content, target);
    cleanups.push(unregister);
    return unregister;
}

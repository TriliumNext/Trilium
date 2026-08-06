import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFaviconContrastClass } from "./favicon_contrast.js";
import { renderMentionPreview } from "./link_embed.js";

/**
 * The verdicts are cached for the life of the page — a note linking one site twenty times measures
 * it once — so every test names its own icon rather than sharing one with the test before it.
 */
let counter = 0;
const freshIcon = () => `api/attachments/att${++counter}/image/icon.png`;

/** The icon the browser would have loaded, with its `load`/`error` left for the test to fire. */
class FakeImage {
    static instances: FakeImage[] = [];

    src = "";
    private handlers: Record<string, () => void> = {};

    constructor() {
        FakeImage.instances.push(this);
    }

    addEventListener(type: string, handler: () => void) {
        this.handlers[type] = handler;
    }

    fire(type: "load" | "error") {
        this.handlers[type]?.();
    }
}

/**
 * A canvas that answers with the pixels the test names, so a verdict can be reached at all: happy-dom
 * implements no 2d context, and without one the measurement rightly declines to judge anything.
 */
function stubCanvas(pixels: Uint8ClampedArray) {
    const realCreateElement = document.createElement.bind(document);

    vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
        if (tag !== "canvas") {
            return realCreateElement(tag, options);
        }

        return {
            width: 0,
            height: 0,
            getContext: () => ({
                drawImage: () => {},
                getImageData: () => ({ data: pixels })
            })
        } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
}

/** An icon that is a black mark on nothing — GitHub's octocat, which a dark theme has to correct. */
const BLACK_ON_NOTHING = new Uint8ClampedArray([
    ...Array.from({ length: 60 }, () => [ 0, 0, 0, 0 ]).flat(),
    ...Array.from({ length: 40 }, () => [ 0, 0, 0, 255 ]).flat()
]);

function Probe({ src }: { src?: string | null }) {
    return <span className={useFaviconContrastClass(src) ?? "unjudged"} />;
}

const containers: HTMLDivElement[] = [];

function renderProbe(src?: string | null) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    act(() => render(<Probe src={src} />, container));

    return () => container.querySelector("span")?.className;
}

/** Lets the measurement's promise resolve and the render it schedules run. */
const settle = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal("Image", FakeImage);
    stubCanvas(BLACK_ON_NOTHING);
});

afterEach(() => {
    for (const container of containers) {
        act(() => render(null, container));
        container.remove();
    }
    containers.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("useFaviconContrastClass", () => {
    it("measures an icon, then hands the verdict to the theme as a class", async () => {
        const src = freshIcon();
        const classOf = renderProbe(src);

        // Drawn as the site drew it while the measurement runs: guessing first would mean
        // occasionally correcting an icon that turns out to be fine.
        expect(classOf()).toBe("unjudged");
        expect(FakeImage.instances).toHaveLength(1);
        expect(FakeImage.instances[0].src).toBe(src);

        FakeImage.instances[0].fire("load");
        await settle();

        expect(classOf()).toBe("link-embed-favicon-dark");
    });

    it("answers a second preview of the same icon without measuring it again", async () => {
        const src = freshIcon();
        const first = renderProbe(src);
        FakeImage.instances[0].fire("load");
        await settle();
        expect(first()).toBe("link-embed-favicon-dark");

        // A note linking one site twenty times draws twenty of these.
        const second = renderProbe(src);
        await settle();

        expect(second()).toBe("link-embed-favicon-dark");
        expect(FakeImage.instances).toHaveLength(1);
    });

    it("shares one measurement between the previews that ask for it at once", async () => {
        const src = freshIcon();
        const first = renderProbe(src);
        const second = renderProbe(src);

        // Both mounted before either answer arrived: one load, one measurement, one verdict.
        expect(FakeImage.instances).toHaveLength(1);

        FakeImage.instances[0].fire("load");
        await settle();

        expect(first()).toBe("link-embed-favicon-dark");
        expect(second()).toBe("link-embed-favicon-dark");
    });

    it("leaves an icon alone when there is nothing to measure", async () => {
        // Nothing to draw at all.
        expect(renderProbe(undefined)()).toBe("unjudged");
        // A remote address, which no preview may load — the reader would be announced to whoever
        // serves it. It never reaches an <img>, so it is never measured either.
        expect(renderProbe("https://tracker.test/favicon.ico")()).toBe("unjudged");
        expect(FakeImage.instances).toEqual([]);

        // An icon that will not load is one the preview already shows its placeholder for.
        const classOf = renderProbe(freshIcon());
        FakeImage.instances[0].fire("error");
        await settle();
        expect(classOf()).toBe("unjudged");

        // And an icon the canvas will not give up its pixels for is left as the site drew it.
        vi.restoreAllMocks();
        const unreadable = renderProbe(freshIcon());
        FakeImage.instances[1].fire("load");
        await settle();
        expect(unreadable()).toBe("unjudged");
    });

    it("puts the verdict on the icon a preview actually draws", async () => {
        // What the class is for: the theme corrects the icon by it, so it has to arrive on the
        // rendered <img> alongside the class that sizes it, rather than in place of it.
        const container = document.createElement("div");
        document.body.appendChild(container);
        containers.push(container);

        act(() => renderMentionPreview(container, {
            url: "https://example.com",
            favicon: freshIcon()
        }));

        FakeImage.instances[0].fire("load");
        await settle();

        expect(container.querySelector("img.link-embed-mention-favicon")?.className)
            .toBe("link-embed-mention-favicon link-embed-favicon-dark");
    });

    it("drops the verdict of a preview that has gone before its measurement arrives", async () => {
        const src = freshIcon();
        const classOf = renderProbe(src);
        const [ image ] = FakeImage.instances;

        // Scrolling away from a note unmounts its previews mid-measurement, which must not be a
        // state update against something no longer rendered.
        act(() => render(null, containers[containers.length - 1]));
        image.fire("load");
        await settle();

        expect(classOf()).toBeUndefined();
    });
});

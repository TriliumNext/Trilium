import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    type ContentEmbedToolProvider, registerContentEmbedTools, useContentEmbedDisplayMode,
    watchContentEmbedTools
} from "./content_embed_tools";

const containers: HTMLElement[] = [];

afterEach(() => {
    for (const container of containers) {
        act(() => render(null, container));
        container.remove();
    }
    containers.length = 0;
});

describe("watchContentEmbedTools", () => {
    it("hears of content that adds its buttons apart, once it joins the container", async () => {
        const container = document.createElement("div");
        document.body.append(container);
        containers.push(container);
        const callback = vi.fn();
        const stopWatching = watchContentEmbedTools(container, callback);

        const content = document.createElement("div");
        const unregister = registerContentEmbedTools(content, {} as ContentEmbedToolProvider);
        expect(callback).not.toHaveBeenCalled();

        container.append(content);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());

        unregister();
        expect(callback).toHaveBeenCalledTimes(2);
        stopWatching();
    });
});

describe("useContentEmbedDisplayMode", () => {
    it("follows the mode of the embed, and is null while it has none", async () => {
        const figure = document.createElement("figure");
        figure.className = "include-note";
        figure.dataset.editable = "true";
        const probe = await mountProbe(figure);
        expect(probe.mode).toBeNull();

        await act(async () => {
            figure.dataset.displayMode = "source";
            await Promise.resolve();
        });
        expect(probe.mode).toBe("source");

        await act(async () => {
            figure.dataset.displayMode = "preview";
            await Promise.resolve();
        });
        expect(probe.mode).toBe("preview");
    });

    it("is null outside an embed", async () => {
        expect((await mountProbe(document.createElement("div"))).mode).toBeNull();
    });

    it("finds the embed that content rendered apart joins later", async () => {
        const container = document.createElement("div");
        const probe = await mountProbe(container, false);
        expect(probe.mode).toBeNull();

        const figure = document.createElement("figure");
        figure.className = "include-note";
        figure.dataset.displayMode = "source";
        document.body.append(figure);
        await act(async () => {
            figure.append(container);
            await Promise.resolve();
        });
        expect(probe.mode).toBe("source");

        await act(async () => {
            figure.dataset.displayMode = "split";
            await Promise.resolve();
        });
        expect(probe.mode).toBe("split");
        figure.remove();
    });
});

async function mountProbe(parent: HTMLElement, isConnected = true) {
    if (isConnected) {
        document.body.append(parent);
    }
    containers.push(parent);

    const probe = { mode: undefined as string | null | undefined };
    function Probe() {
        const ref = useRef<HTMLDivElement>(null);
        probe.mode = useContentEmbedDisplayMode(ref);
        return <div ref={ref} />;
    }

    await act(async () => render(<Probe />, parent));
    return probe;
}

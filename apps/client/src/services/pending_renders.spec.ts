import { beforeEach, describe, expect, it } from "vitest";

import { trackPendingRender, waitForPendingRenders } from "./pending_renders.js";

function deferred() {
    let resolve: () => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Lets every already-queued microtask (and the promise chains they queue) run to completion. */
function flushMicrotasks() {
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Whether `waitForPendingRenders(root)` has resolved, without blocking on it. */
function watchCompletion(root: Node) {
    const state = { done: false };
    void waitForPendingRenders(root).then(() => {
        state.done = true;
    });
    return state;
}

let root: HTMLElement;
/** A container rendering inside `root` — what a real transform pass registers itself against. */
let child: HTMLElement;
/** A container outside `root`, standing in for a note rendering in another pane. */
let elsewhere: HTMLElement;

describe("pending renders", () => {
    beforeEach(() => {
        root = document.createElement("div");
        child = document.createElement("div");
        root.appendChild(child);
        elsewhere = document.createElement("div");
    });

    it("resolves immediately when nothing is tracked", async () => {
        await expect(waitForPendingRenders(root)).resolves.toBeUndefined();
    });

    it("waits for work inside the root, including work scheduled by that work", async () => {
        const first = deferred();
        const second = deferred();
        trackPendingRender(child, first.promise);

        const completion = watchCompletion(root);
        await flushMicrotasks();
        expect(completion.done).toBe(false);

        // An included note renders its own content: work that only gets tracked once the first
        // pass has finished must still be waited for.
        first.resolve();
        trackPendingRender(child, second.promise);
        await flushMicrotasks();
        expect(completion.done).toBe(false);

        second.resolve();
        await flushMicrotasks();
        expect(completion.done).toBe(true);
    });

    it("ignores work rendering outside the root", async () => {
        const unrelated = deferred();
        trackPendingRender(elsewhere, unrelated.promise);

        // Never resolved: a hover preview must not stall on another pane's render.
        await expect(waitForPendingRenders(root)).resolves.toBeUndefined();

        unrelated.resolve();
    });

    it("does not stall or reject when tracked work fails", async () => {
        const failing = deferred();
        trackPendingRender(child, failing.promise);

        failing.reject(new Error("mermaid blew up"));

        await expect(waitForPendingRenders(root)).resolves.toBeUndefined();
    });
});

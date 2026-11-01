/**
 * Tracks the asynchronous tail of content rendering.
 *
 * Most render paths are awaitable: `content_renderer.getRenderedContent()` returns once the note's
 * content is in the DOM. Components are not — a widget that renders HTML kicks off its transform
 * passes (mermaid, KaTeX, syntax highlighting, included notes, all of which lazily import their
 * library) from a layout effect and never awaits them, because on screen they simply paint when they
 * are ready.
 *
 * That breaks any caller that snapshots the finished DOM instead of watching it: printing / PDF
 * export captures the page once, and the note tooltip serializes its preview to an HTML string, so a
 * transform that lands after the capture is silently missing from the output. Such a caller awaits
 * {@link waitForPendingRenders} on the container it is about to capture.
 *
 * Work is tracked against the container it renders into, so waiting is scoped to that subtree: a
 * tooltip capturing a hovered note never blocks on a heavy note rendering in another pane.
 */
interface PendingRender {
    /** The element the work renders into — what scopes a wait to the subtree being captured. */
    container: Node;
    /** Never rejects: see {@link trackPendingRender}. */
    work: Promise<unknown>;
}

const pending = new Set<PendingRender>();

/** Registers async render work against its container, for {@link waitForPendingRenders} to await. */
export function trackPendingRender(container: Node, work: Promise<unknown>) {
    // Failures are the tracked work's own business: a transform that throws still finishes, and a
    // caller waiting for a settled DOM should proceed rather than inherit the rejection.
    const entry: PendingRender = { container, work: work.catch(() => undefined) };
    pending.add(entry);
    void entry.work.then(() => pending.delete(entry));
}

/**
 * Resolves once the render work within `root` has settled — including work that other work scheduled
 * (an included note renders its own content, which highlights its own code blocks, …). Work rendering
 * outside `root` is left alone.
 */
export async function waitForPendingRenders(root: Node) {
    for (;;) {
        const within = [...pending]
            .filter(({ container }) => container === root || root.contains(container))
            .map(({ work }) => work);

        if (!within.length) return;

        await Promise.all(within);
    }
}

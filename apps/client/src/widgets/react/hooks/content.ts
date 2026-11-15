import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

import { parseNavigationStateFromUrl, type ViewScope } from "../../../services/link";

/**
 * Renders math equations within elements that have the `.math-tex` class.
 * Used by sidebar widgets like Table of Contents and Highlights list to display math content.
 *
 * @param containerRef - Ref to the container element that may contain math elements
 * @param deps - Dependencies that trigger re-rendering (e.g., text content)
 */
export function useMathRendering(containerRef: RefObject<HTMLElement | null>, deps: unknown[]) {
    useEffect(() => {
        if (!containerRef.current) return;
        const mathElements = containerRef.current.querySelectorAll(".math-tex");
        if (!mathElements.length) return;

        // KaTeX is heavy, so the math service is only loaded once there are equations to render.
        void import("../../../services/math").then(({ default: math }) => {
            for (const mathEl of mathElements) {
                // Skip if already rendered by KaTeX
                if (mathEl.querySelector(".katex")) continue;

                try {
                    // CKEditor's data format wraps the equation with \(...\) or \[...\]
                    // delimiters. katex.render() expects raw LaTeX without them.
                    const raw = mathEl.textContent?.trim() ?? "";
                    let equation: string;
                    let displayMode = false;

                    if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
                        equation = raw.slice(2, -2);
                    } else if (raw.startsWith("\\[") && raw.endsWith("\\]")) {
                        equation = raw.slice(2, -2);
                        displayMode = true;
                    } else {
                        equation = raw;
                    }

                    // throwOnError: false renders invalid formulas as an inline red error
                    // instead of throwing (the catch below stays as a final safety net).
                    math.render(equation, mathEl as HTMLElement, { displayMode, throwOnError: false });
                } catch (e) {
                    console.warn("Failed to render math:", e);
                }
            }
        });
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Keeps navigation that follows internal note links (note links, reference links, "Related settings",
 * etc.) inside a popup dialog — whose note context lives outside the tab manager — instead of letting
 * the global link handler resolve to the active tab in the background. The dialog decides what to do
 * with the parsed target via `onNavigate` (typically `noteContext.setNote()` or routing to another
 * dialog).
 *
 * The listener is attached to `containerRef` in the capture phase so it runs before the
 * document-level `goToLink` handler (and before anything that might stop propagation). Modified or
 * middle clicks and external links are left untouched so they can still open in a new tab/window or
 * externally, and clicks inside editable rich text are ignored so they keep placing the caret.
 * Links that implement their own navigation (and would otherwise never see the click, since this
 * runs first) can opt out entirely via a `data-no-contained-navigation` attribute.
 */
export function useContainedLinkNavigation(
    containerRef: RefObject<HTMLElement | null>,
    onNavigate: (notePath: string, viewScope: ViewScope | undefined) => void
) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function onClick(e: MouseEvent) {
            if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            const link = (e.target as HTMLElement).closest("a");
            if (!link || link.getAttribute("target") === "_blank" || link.isContentEditable) return;
            if (link.hasAttribute("data-no-contained-navigation")) return;

            const href = link.getAttribute("href") ?? link.getAttribute("data-href");
            if (!href?.startsWith("#root/")) return; // external links / in-page anchors handled elsewhere

            const { notePath, viewScope } = parseNavigationStateFromUrl(href);
            if (!notePath) return;

            e.preventDefault();
            e.stopPropagation();
            // A double-click also fires a separate `dblclick` event that the global handler in
            // link.ts treats as "open in a new tab", which would navigate away and dismiss the
            // surrounding dialog. The preceding `click` already navigated, so for `dblclick` we
            // only need to swallow the event and skip the redundant navigation.
            if (e.type !== "dblclick") {
                onNavigate(notePath, viewScope);
            }
        }

        container.addEventListener("click", onClick, true);
        container.addEventListener("dblclick", onClick, true);
        return () => {
            container.removeEventListener("click", onClick, true);
            container.removeEventListener("dblclick", onClick, true);
        };
    }, [ containerRef, onNavigate ]);
}

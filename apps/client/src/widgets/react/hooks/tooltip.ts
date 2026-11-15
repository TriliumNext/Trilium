import "../tooltip.css";

import type { Tooltip } from "bootstrap";
import type { RefObject } from "preact";
import { useCallback, useDebugValue, useEffect, useRef } from "preact/hooks";

type TooltipClass = typeof Tooltip;

/**
 * A Bootstrap tooltip whose lifetime follows the element it hangs off.
 *
 * @param enabled while false the tooltip is put away and kept away, for a host with something of its own
 *                to put in front of the user — see {@link Dropdown}, which silences its toggle's title
 *                for as long as the menu that title opened is on screen.
 */
export function useTooltip(
    elRef: RefObject<HTMLElement | null>,
    config: Partial<Tooltip.Options>,
    enabled = true
) {
    const tooltipRef = useRef<Tooltip | null>(null);
    /** Whether `showTooltip()` was called before Bootstrap had loaded. */
    const showWhenLoaded = useRef(false);
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    useEffect(() => {
        if (!elRef?.current) return;

        const element = elRef.current;
        return whenTooltipsLoad(element, (Tooltip) => {
            // Held on to rather than looked up again through `Tooltip.getInstance`: Bootstrap keeps one
            // component instance per element and refuses to register a second (it logs and returns), so on
            // an element another Bootstrap component has already claimed — a dropdown's toggle, say — the
            // lookup comes back empty. The tooltip works all the same, being a live object with its own
            // listeners, but nothing can reach it to dispose it, and whatever it has shown is left on
            // screen for good.
            Tooltip.getInstance(element)?.dispose();
            const tooltip = new Tooltip(element, config);
            tooltipRef.current = tooltip;
            if (!enabledRef.current) {
                tooltip.disable();
            } else if (showWhenLoaded.current) {
                showWhenLoaded.current = false;
                tooltip.show();
            }

            return () => {
                tooltipRef.current = null;
                // Dispose even when the trigger element is already detached (e.g. a keyed remount
                // replaced it before this cleanup ran) — dispose() also removes a currently-shown
                // popup from the DOM, and with the trigger gone nothing else ever would (#10567).
                // The pending-callback crash of bootstrap#37474 is handled by `patchDispose()`.
                tooltip.dispose();
            };
        });
    }, [ elRef, config ]);

    // Runs after the effect above, so a tooltip just recreated for a new config is caught by it too —
    // hence the same dependencies alongside `enabled`.
    useEffect(() => {
        const tooltip = tooltipRef.current;
        if (!tooltip) return;

        if (enabled) {
            tooltip.enable();
        } else {
            tooltip.hide();
            tooltip.disable();
        }
    }, [ enabled, elRef, config ]);

    const showTooltip = useCallback(() => {
        const tooltip = tooltipRef.current;
        if (!tooltip) {
            showWhenLoaded.current = true;
            void loadTooltips();
            return;
        }

        clearStaleHoverState(tooltip);
        tooltip.show();
    }, []);

    const hideTooltip = useCallback(() => {
        showWhenLoaded.current = false;
        tooltipRef.current?.hide();
    }, []);

    useDebugValue(config.title);

    return { showTooltip, hideTooltip };
}

/**
 * Clears the hover state Bootstrap keeps of its own accord, so that a manual `show()` isn't undone by
 * the hover before it.
 *
 * Bootstrap tracks `_isHovered` even under `trigger: "manual"`, and leans on `hide()` resetting it to
 * `null` — the value that tells a later `show()` there is no hover to act on ("a trick to support
 * manual triggering", as it puts it). But `show()` writes `false` into the same flag from a callback
 * deferred until the fade-in has finished, so a hover ended before then reverses the two writes:
 * `hide()` sets `null`, and the deferred callback then sets `false` over it. The flag is left standing
 * with nothing shown, and the next `show()` reads it, takes the tooltip to have been left already and
 * calls `_leave()` — which hides it a moment after it appeared, with the pointer still on the trigger.
 *
 * A quick pass over a trigger is enough to leave it in that state, which is why the `?` of the sidebar
 * card headers (a {@link Dropdown} title, shown from its own mouseenter) so often vanished under the
 * pointer. Bootstrap offers no public way to reach the flag, and no public call that clears it without
 * a tooltip already being shown.
 */
function clearStaleHoverState(tooltip: Tooltip) {
    (tooltip as unknown as { _isHovered: boolean | null })._isHovered = null;
}

const tooltips = new Set<Tooltip>();

/**
 * Similar to {@link useTooltip}, but doesn't expose methods to imperatively hide or show the tooltip.
 *
 * @param elRef the element to bind the tooltip to.
 * @param config optionally, the tooltip configuration.
 */
export function useStaticTooltip(
    elRef: RefObject<Element | null>,
    config?: Partial<Tooltip.Options>
) {
    useEffect(() => {
        const hasTooltip = config?.title || elRef.current?.getAttribute("title");
        if (!elRef?.current || !hasTooltip) return;

        // Capture element now, since elRef.current may be null during cleanup.
        const element = elRef.current;
        return whenTooltipsLoad(element, (Tooltip) => {

            // Dispose any existing tooltip before creating a new one
            Tooltip.getInstance(element)?.dispose();

            const tooltip = new Tooltip(element, config);
            element.addEventListener("show.bs.tooltip", () => {
                // Hide all the other tooltips.
                for (const otherTooltip of tooltips) {
                    if (otherTooltip === tooltip) continue;
                    otherTooltip.hide();
                }
            });
            tooltips.add(tooltip);

            // A tooltip triggered by hover *and focus* — Bootstrap's default — outstays the press that
            // opened something: the press leaves the trigger focused, and while any trigger is still active
            // Bootstrap declines to put the tooltip away, pointer gone or not. So it sits over whatever the
            // press brought up rather than beside it, until focus moves on. The status bar's connection
            // badges are where that shows worst: the tooltip is left standing over the sidebar the press
            // peeked. Dismissed on press, as the legacy button widgets did (`onclick_button.ts`).
            const dismissOnPress = (event: Event) => {
                // A delegated (`selector:`) config spawns an instance per hovered child, so the one showing
                // belongs to the child the press landed on rather than to the container the config sits on.
                const delegate = config?.selector && event.target instanceof Element
                    ? event.target.closest(config.selector)
                    : null;
                (delegate ? Tooltip.getInstance(delegate) : tooltip)?.hide();
            };
            element.addEventListener("click", dismissOnPress);

            // For delegated (`selector:`) configs, a hovered child gets its own per-target Tooltip
            // instance (see the sweep at the end of the cleanup below) that only ever hides on its
            // own mouseleave. If that child leaves the DOM while its popup is still shown — the note
            // icon picker's virtualized grid re-keys its cells on every keystroke in the search box,
            // and does the same on scroll — no mouseleave ever fires, so the instance never hides and
            // its popup is orphaned in `document.body` until reload (#10680). While a delegate has its
            // popup up, watch the container for removals and put the popup away the moment its trigger
            // is gone — the hook's own cleanup cannot be relied on, since a grid re-render driven by the
            // grid's own state never re-runs this effect. The observer is connected only for as long
            // as a popup is shown, so it costs nothing while the grid is merely typed into or scrolled.
            let disposeDelegateTracking = () => {};
            if (config?.selector) {
                const shownDelegates = new Set<Element>();
                const delegateObserver = new MutationObserver(() => {
                    for (const target of shownDelegates) {
                        if (target.isConnected) continue;
                        const instance = Tooltip.getInstance(target);
                        if (instance) {
                            // Reuses the bootstrap#37474 guard of `patchDispose()`.
                            instance.dispose();
                        } else {
                            // Belt-and-braces: the instance may already be gone on its own.
                            const popupId = target.getAttribute("aria-describedby");
                            if (popupId) {
                                document.getElementById(popupId)?.remove();
                            }
                        }
                        shownDelegates.delete(target);
                    }
                    if (!shownDelegates.size) stopWatching();
                });
                // Hides a shown delegate once a scroll moves it partly out of the view of the element
                // that scrolled, so that its popup does not follow it outside that element.
                const onScroll = (event: Event) => {
                    const scroller = event.target;
                    if (!(scroller instanceof Element)) return;
                    const view = scroller.getBoundingClientRect();
                    for (const target of shownDelegates) {
                        const box = target.getBoundingClientRect();
                        const isInView = box.top >= view.top && box.bottom <= view.bottom
                            && box.left >= view.left && box.right <= view.right;
                        if (!isInView && scroller.contains(target)) {
                            Tooltip.getInstance(target)?.hide();
                        }
                    }
                };
                const startWatching = () => {
                    delegateObserver.observe(element, { childList: true, subtree: true });
                    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
                };
                const stopWatching = () => {
                    delegateObserver.disconnect();
                    document.removeEventListener("scroll", onScroll, { capture: true });
                };
                // Bootstrap's component events bubble from the delegate up to the container.
                const onDelegateShown = (event: Event) => {
                    if (!(event.target instanceof Element) || event.target === element) return;
                    if (!shownDelegates.size) startWatching();
                    shownDelegates.add(event.target);
                };
                const onDelegateHidden = (event: Event) => {
                    if (!(event.target instanceof Element)) return;
                    shownDelegates.delete(event.target);
                    if (!shownDelegates.size) stopWatching();
                };
                element.addEventListener("inserted.bs.tooltip", onDelegateShown);
                element.addEventListener("hidden.bs.tooltip", onDelegateHidden);

                disposeDelegateTracking = () => {
                    stopWatching();
                    element.removeEventListener("inserted.bs.tooltip", onDelegateShown);
                    element.removeEventListener("hidden.bs.tooltip", onDelegateHidden);
                };
            }

            return () => {
                disposeDelegateTracking();
                element.removeEventListener("click", dismissOnPress);
                tooltips.delete(tooltip);
                // Dispose even when the trigger element is already detached (e.g. a keyed remount
                // replaced it before this cleanup ran) — dispose() also removes a currently-shown
                // popup from the DOM, and with the trigger gone nothing else ever would (#10567).
                // The pending-callback crash of bootstrap#37474 is handled by `patchDispose()`.
                tooltip.dispose();

                // For delegated (`selector:`) configs, hovered children spawn per-target
                // Tooltip instances whose popups the parent's dispose() does not remove;
                // sweep them here. Scope by walking the container's descendants that
                // still carry `aria-describedby` — Bootstrap stamps that attribute
                // while a tooltip is shown and clears it on hide, so the ids we find
                // point exactly at the currently-visible popups this delegated config
                // owns. A blanket `document.querySelectorAll(".tooltip")` would wipe
                // unrelated tooltips (e.g. CKEditor plugins') every time this hook's
                // effect re-runs — which is what caused the checkbox tooltip in
                // `TodoListMultistateEditing` to vanish whenever the "note saved" badge
                // transitioned states.
                if (config?.selector) {
                    for (const target of element.querySelectorAll<HTMLElement>("[aria-describedby]")) {
                        const popupId = target.getAttribute("aria-describedby");
                        if (popupId) {
                            document.getElementById(popupId)?.remove();
                        }
                    }
                }
            };
        });
    }, [ elRef, config ]);
}

/** Bootstrap's `Tooltip`, once it has loaded. */
let BootstrapTooltip: TooltipClass | undefined;
let bootstrapLoad: Promise<typeof import("bootstrap")> | undefined;
/** The tooltips waiting for Bootstrap to load. */
const pendingTooltips = new Set<(Tooltip: TooltipClass) => void>();

/**
 * Loads Bootstrap with `Tooltip.dispose()` patched (see `patchDispose()`), and attaches every
 * tooltip waiting for it. Every module that creates a tooltip loads Bootstrap here, so each tooltip
 * is created with the patch in place. A failed load is tried again on the next call.
 */
export function loadBootstrap() {
    bootstrapLoad ??= import("bootstrap").then((bootstrap) => {
        patchDispose(bootstrap.Tooltip);
        BootstrapTooltip = bootstrap.Tooltip;
        for (const attach of [ ...pendingTooltips ]) attach(bootstrap.Tooltip);
        pendingTooltips.clear();
        return bootstrap;
    }, (err: unknown) => {
        bootstrapLoad = undefined;
        throw err;
    });
    return bootstrapLoad;
}

/**
 * Loads Bootstrap's tooltips, and attaches every tooltip waiting for them. A tooltip's own element
 * starts the load when the pointer enters it or it takes focus; a spec that inspects a tooltip
 * right after rendering preloads it.
 */
export async function loadTooltips() {
    return (await loadBootstrap()).Tooltip;
}

/**
 * Attaches a Bootstrap tooltip to `element` once Bootstrap has loaded, as the hooks do, for a
 * widget that is not a Preact component.
 *
 * @returns a function that disposes of the tooltip, or stops waiting for it.
 */
export function attachTooltip(element: Element, config: Partial<Tooltip.Options>) {
    return whenTooltipsLoad(element, (Tooltip) => {
        const tooltip = new Tooltip(element, config);
        return () => tooltip.dispose();
    });
}

/** The tooltip on `element`, if Bootstrap has loaded and one is attached. */
export function getTooltipInstance(element: Element) {
    return BootstrapTooltip?.getInstance(element) ?? null;
}

/**
 * Runs `attach` with Bootstrap's `Tooltip` at once if it has loaded, or else once the pointer
 * enters `element` or it takes focus and Bootstrap has loaded. The hover or focus that started the
 * load is replayed, so the tooltip shows as if it had been attached all along.
 *
 * @returns a function that detaches the tooltip, or stops waiting for it.
 */
function whenTooltipsLoad(element: HTMLElement | Element, attach: (Tooltip: TooltipClass) => (() => void)) {
    if (BootstrapTooltip) return attach(BootstrapTooltip);

    let detach: (() => void) | undefined;
    let intent: "hover" | "focus" | undefined;
    const start = (Tooltip: TooltipClass) => {
        stopListening();
        detach = attach(Tooltip);
        if (intent) replayIntent(element, intent);
    };
    const onPointerEnter = () => {
        intent = "hover";
        void loadTooltips();
    };
    const onFocusIn = () => {
        intent = "focus";
        void loadTooltips();
    };
    const stopListening = () => {
        element.removeEventListener("pointerenter", onPointerEnter);
        element.removeEventListener("focusin", onFocusIn);
    };
    element.addEventListener("pointerenter", onPointerEnter);
    element.addEventListener("focusin", onFocusIn);
    pendingTooltips.add(start);

    return () => {
        pendingTooltips.delete(start);
        stopListening();
        detach?.();
    };
}

/** Repeats the hover or focus that loaded Bootstrap, for the tooltip attached after it. */
function replayIntent(element: Element, intent: "hover" | "focus") {
    if (intent === "hover" && element.matches(":hover")) {
        const hovered = [ ...element.querySelectorAll(":hover") ].at(-1) ?? element;
        hovered.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    } else if (intent === "focus" && document.activeElement && element.contains(document.activeElement)) {
        document.activeElement.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }
}

/**
 * Works around https://github.com/twbs/bootstrap/issues/37474: `dispose()` sets every property to
 * `null`, and animation callbacks still pending crash on them, so it leaves safe placeholders instead.
 */
function patchDispose(Tooltip: TooltipClass) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prototype = Tooltip.prototype as any;
    const originalDispose = prototype.dispose;
    const placeholder = {
        activeTrigger: {},
        element: document.createElement("noscript")
    };

    prototype.dispose = function () {
        originalDispose.call(this);
        this._activeTrigger = placeholder.activeTrigger;
        this._element = placeholder.element;
    };
}

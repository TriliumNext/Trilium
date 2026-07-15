import { OptionNames } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import options from "../../services/options";

/**
 * A reusable side pane that can be in one of three modes:
 * - `closed`: hidden.
 * - `docked`: a persistent pane that reflows the content (resizable).
 * - `peek`: a transient pane that floats over the content without reflowing it, dismissed on outside
 *   interaction or Escape.
 *
 * These primitives are side-agnostic (left/right) and content-agnostic; a consumer supplies the
 * persisted option key, the commands/keyboard actions, and the DOM (see RightPanelContainer for the
 * reference implementation). Only the docked/closed distinction is persisted — peek is runtime-only.
 */
export type PaneMode = "closed" | "peek" | "docked";
// `togglePeek` and `dismiss` are *soft* closes (content stays mounted, hidden, so re-peeking preserves
// widget state); `close` (the × button) and the docked toggle are *hard* closes that unmount. The
// mode result is the same; the mount distinction lives in usePaneMode.
export type PaneAction = "togglePeek" | "toggleDocked" | "dock" | "close" | "dismiss";

/** The next mode for a given action (pure). `toggle*` open from closed and close otherwise. */
export function reducePaneMode(prev: PaneMode, action: PaneAction): PaneMode {
    switch (action) {
        case "togglePeek": return prev === "closed" ? "peek" : "closed";
        case "toggleDocked": return prev === "closed" ? "docked" : "closed";
        case "dock": return "docked";
        case "close": return "closed";
        case "dismiss": return "closed";
    }
}

/**
 * The value to write to the persisted visibility option for a transition, or null when it shouldn't
 * change — only the docked/closed distinction is persisted; peek is runtime-only.
 */
export function persistedPaneVisible(prev: PaneMode, next: PaneMode): boolean | null {
    return (prev === "docked") !== (next === "docked") ? next === "docked" : null;
}

export interface PaneModeController {
    mode: PaneMode;
    /** Whether the pane is shown (peek or docked) — drives CSS show/hide. */
    visible: boolean;
    /** Whether the content should be in the DOM. Stays true across a soft `dismiss` so the content
        persists between consecutive peeks; goes false on a hard `close`. */
    mounted: boolean;
    togglePeek: () => void;
    toggleDocked: () => void;
    dock: () => void;
    close: () => void;
    dismiss: () => void;
}

interface PaneState {
    mode: PaneMode;
    mounted: boolean;
}

/**
 * Owns a pane's mode, mount lifecycle and persistence. `visibleOption` stores only the docked/closed
 * distinction. The state updater stays pure (it can run more than once, e.g. in Strict Mode);
 * persistence runs in an effect so it isn't duplicated by re-invoked updaters.
 */
export function usePaneMode(visibleOption: OptionNames): PaneModeController {
    const [ { mode, mounted }, setState ] = useState<PaneState>(() => {
        const docked = options.is(visibleOption);
        return { mode: docked ? "docked" : "closed", mounted: docked };
    });

    const apply = useCallback((action: PaneAction) => {
        setState(prev => {
            const mode = reducePaneMode(prev.mode, action);
            let mounted: boolean;
            if (mode !== "closed") {
                mounted = true;                                         // shown → mounted
            } else if (action === "togglePeek" || action === "dismiss") {
                mounted = prev.mounted;                                 // soft close: peek button / outside-press / Esc keep the content mounted (hidden)
            } else {
                mounted = false;                                        // hard close: the × button (`close`) / docked toggle unmount the content
            }
            return { mode, mounted };
        });
    }, []);

    const prevModeRef = useRef<PaneMode>(mode);
    useEffect(() => {
        const prev = prevModeRef.current;
        if (prev !== mode) {
            const persist = persistedPaneVisible(prev, mode);
            if (persist !== null) {
                options.save(visibleOption, persist.toString());
            }
            prevModeRef.current = mode;
        }
    }, [ mode, visibleOption ]);

    const togglePeek = useCallback(() => apply("togglePeek"), [ apply ]);
    const toggleDocked = useCallback(() => apply("toggleDocked"), [ apply ]);
    const dock = useCallback(() => apply("dock"), [ apply ]);
    const close = useCallback(() => apply("close"), [ apply ]);
    const dismiss = useCallback(() => apply("dismiss"), [ apply ]);

    return { mode, visible: mode !== "closed", mounted, togglePeek, toggleDocked, dock, close, dismiss };
}

// App-wide popup roots that render outside the pane (on document.body) but must NOT dismiss a peek:
// resize gutters, Bootstrap dropdowns/tooltips/modals/popovers, CKEditor balloons, Flatpickr calendars.
const DEFAULT_KEEP_OPEN_SELECTOR = ".gutter, .dropdown-menu, .tooltip, .modal, .popover, .ck-balloon-panel, .ck-body, .flatpickr-calendar";

/** Whether an event target lies within the peek pane or an allowlisted popup (i.e. should keep it open). */
export function isWithinPeek(target: EventTarget | null, keepOpenSelector: string): boolean {
    return target instanceof Element && target.closest(keepOpenSelector) !== null;
}

export interface PeekDismissOptions {
    /** Instance selectors whose clicks keep the peek open — typically the pane element and its button. */
    keepOpenSelector: string;
    /** Element focused after Escape closes the peek (e.g. the peek button), for keyboard return. */
    focusSelector?: string;
}

/**
 * While `active`, closes the peek on an outside press or Escape. Presses over the content area land
 * on the pane's backdrop and so reach this listener; presses on chrome the backdrop doesn't cover
 * (tree, toolbar, tabs) are caught directly. Capture phase so a child's `stopPropagation` can't keep
 * a stale peek open.
 */
export function usePeekDismiss(active: boolean, onDismiss: () => void, { keepOpenSelector, focusSelector }: PeekDismissOptions) {
    useEffect(() => {
        if (!active) return;

        const selector = `${keepOpenSelector}, ${DEFAULT_KEEP_OPEN_SELECTOR}`;
        const onPointerDown = (e: PointerEvent) => {
            if (!isWithinPeek(e.target, selector)) onDismiss();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            // Skip if an inner element already handled Escape (e.g. closed a dropdown or cleared an input).
            if (e.key === "Escape" && !e.defaultPrevented) {
                onDismiss();
                if (focusSelector) document.querySelector<HTMLElement>(focusSelector)?.focus();
            }
        };

        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [ active, onDismiss, keepOpenSelector, focusSelector ]);
}

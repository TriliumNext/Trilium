import "./peek_pane.css";

import { OptionNames } from "@triliumnext/commons";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useRef, useState
} from "preact/hooks";

import type { EventData } from "../../components/app_context";
import options from "../../services/options";
import { FLOATING_LAYER_SELECTOR } from "./floating_layers";
import { useTriliumEvent } from "./hooks";
import { ParentComponent } from "./react_utils";

/**
 * A reusable side pane that can be in one of three modes:
 * - `closed`: hidden.
 * - `docked`: a persistent pane that reflows the content (resizable).
 * - `peek`: a transient pane that floats over the content without reflowing it, dismissed on outside
 *   interaction or Escape.
 *
 * These primitives are side-agnostic (left/right) and content-agnostic; a consumer supplies the
 * persisted option key, the commands/keyboard actions, and the DOM. `RightPanelContainer` uses the
 * hooks; the jQuery `LeftPaneContainer` uses `reducePaneMode`, `persistedPaneVisible` and
 * `watchPeekDismiss`. Both share `PeekPaneButton` and `peek_pane.css`. Only the docked/closed
 * distinction is persisted; peek is runtime-only.
 *
 * Each pane raises `paneModeChanged` when its mode changes, and dismisses its own peek when another
 * pane starts peeking, so that only one peek is open at a time.
 */
export type PaneMode = "closed" | "peek" | "docked";
export type PaneId = "left" | "right";
// `togglePeek` and `dismiss` are *soft* closes (content stays mounted, hidden, so re-peeking preserves
// widget state); `close` (the × button) and the docked toggle are *hard* closes that unmount. The
// mode result is the same; the mount distinction lives in usePaneMode.
export type PaneAction = "togglePeek" | "toggleDocked" | "dock" | "close" | "dismiss";

/**
 * The next mode for a given action (pure). `toggle*` open from closed and close otherwise;
 * `dismiss` closes a peek only.
 */
export function reducePaneMode(prev: PaneMode, action: PaneAction): PaneMode {
    switch (action) {
        case "togglePeek": return prev === "closed" ? "peek" : "closed";
        case "toggleDocked": return prev === "closed" ? "docked" : "closed";
        case "dock": return "docked";
        case "close": return "closed";
        case "dismiss": return prev === "peek" ? "closed" : prev;
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
 *
 * @param pane the pane's id in `paneModeChanged`.
 */
export function usePaneMode(visibleOption: OptionNames, pane: PaneId): PaneModeController {
    const parentComponent = useContext(ParentComponent);
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
    // A layout effect, so that another pane's peek closes before the paint that shows this one.
    useLayoutEffect(() => {
        const prev = prevModeRef.current;
        if (prev !== mode) {
            const persist = persistedPaneVisible(prev, mode);
            if (persist !== null) {
                options.save(visibleOption, persist.toString());
            }
            prevModeRef.current = mode;
            parentComponent?.triggerEvent("paneModeChanged", { pane, mode });
        }
    }, [ mode, visibleOption, pane, parentComponent ]);

    useTriliumEvent("paneModeChanged", useCallback((data: EventData<"paneModeChanged">) => {
        if (data.pane !== pane && data.mode === "peek") {
            apply("dismiss");
        }
    }, [ pane, apply ]));

    const togglePeek = useCallback(() => apply("togglePeek"), [ apply ]);
    const toggleDocked = useCallback(() => apply("toggleDocked"), [ apply ]);
    const dock = useCallback(() => apply("dock"), [ apply ]);
    const close = useCallback(() => apply("close"), [ apply ]);
    const dismiss = useCallback(() => apply("dismiss"), [ apply ]);

    return { mode, visible: mode !== "closed", mounted, togglePeek, toggleDocked, dock, close, dismiss };
}

// The app-wide popup roots that render outside the pane (on document.body) but must NOT dismiss a
// peek — shared with every other surface that closes on an outside press (see floating_layers.ts).
const DEFAULT_KEEP_OPEN_SELECTOR = FLOATING_LAYER_SELECTOR;

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
 * While `active`, closes the peek on an outside press or Escape. See {@link watchPeekDismiss}.
 */
export function usePeekDismiss(active: boolean, onDismiss: () => void, { keepOpenSelector, focusSelector }: PeekDismissOptions) {
    useEffect(() => {
        if (!active) return;
        return watchPeekDismiss(onDismiss, { keepOpenSelector, focusSelector });
    }, [ active, onDismiss, keepOpenSelector, focusSelector ]);
}

/** Running {@link watchPeekDismiss} calls; a new peek starts before the old one stops. */
let openPeekCount = 0;

/**
 * Closes a peek on an outside press or Escape until the returned function is called; the
 * framework-free core of {@link usePeekDismiss}. Presses over the content area land on the pane's
 * backdrop and so reach this listener; presses on chrome the backdrop doesn't cover (toolbar, tabs)
 * are caught directly. Capture phase so a child's `stopPropagation` can't keep a stale peek open.
 * While it runs, `body` has the `peek-pane-open` class.
 */
export function watchPeekDismiss(onDismiss: () => void, dismissOptions: PeekDismissOptions) {
    const { keepOpenSelector, focusSelector } = dismissOptions;
    const selector = `${keepOpenSelector}, ${DEFAULT_KEEP_OPEN_SELECTOR}`;
    const onPointerDown = (e: PointerEvent) => {
        if (!isWithinPeek(e.target, selector)) onDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        // Skip an Escape that an inner element handled, e.g. a dropdown closing itself.
        if (e.key === "Escape" && !e.defaultPrevented) {
            onDismiss();
            if (focusSelector) document.querySelector<HTMLElement>(focusSelector)?.focus();
        }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    openPeekCount++;
    document.body.classList.add("peek-pane-open");
    return () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown);
        openPeekCount--;
        document.body.classList.toggle("peek-pane-open", openPeekCount > 0);
    };
}

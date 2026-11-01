import { Tooltip } from "bootstrap";

/**
 * Workaround for https://github.com/twbs/bootstrap/issues/37474.
 *
 * Bootstrap's Tooltip.dispose() sets `_activeTrigger` and `_element` to null,
 * but a fade transition disposed mid-flight will still fire its scheduled
 * transitionend handler, which walks into `_isWithActiveTrigger` and crashes
 * with `TypeError: Cannot convert undefined or null to object`. We hit this
 * whenever the manager disposes the current popup before an in-progress
 * fade completes (e.g. a fresh push targets a different element, or the
 * manager is destroyed with a fade queued).
 *
 * Patch `dispose` once per module load to leave harmless placeholders behind
 * so the stale transitionend handler falls through cleanly. Guarded so this
 * file can be imported alongside the client's own copy of the patch in
 * `apps/client/src/widgets/react/hooks.tsx` without double-wrapping.
 */
{
    const proto = Tooltip.prototype as unknown as {
        dispose(): void;
        __contentHintManagerDisposePatched?: true;
    };
    /* v8 ignore next -- the "already-patched" branch is unreachable in a
       single-process test run: the module loads exactly once and the flag is
       unset. The guard exists so the client's own copy of the patch (see
       `apps/client/src/widgets/react/hooks.tsx`) can co-exist with this one. */
    if (!proto.__contentHintManagerDisposePatched) {
        const originalDispose = proto.dispose;
        const disposedPlaceholder = {
            activeTrigger: {} as Record<string, boolean>,
            element: document.createElement("noscript"),
            // `_config.delay.hide` is read from within `_leave` (see the queued
            // transitionend handler); nulling `_config` in Bootstrap's own
            // `dispose` causes that call site to explode. A zero-delay,
            // zero-trigger placeholder makes the code path a no-op.
            config: { delay: { show: 0, hide: 0 }, trigger: "manual" }
        };
        proto.dispose = function (this: unknown) {
            originalDispose.call(this);
            const self = this as {
                _activeTrigger: Record<string, boolean>;
                _element: Element;
                _config: { delay: { show: number; hide: number }; trigger: string };
            };
            self._activeTrigger = disposedPlaceholder.activeTrigger;
            self._element = disposedPlaceholder.element;
            self._config = disposedPlaceholder.config;
        };
        proto.__contentHintManagerDisposePatched = true;
    }
}

/**
 * A hint request registered with a {@link ContentHintManager}. Any number of
 * independent handles (hover, caret, keyboard-focus …) can be created and
 * pushed onto the manager's visibility stack independently; only the top of
 * the stack is actually rendered, and popping it reveals whatever was pushed
 * underneath.
 *
 * All methods are safe to call after {@link dispose}, in any order.
 */
export interface HintHandle {
    /**
     * Push this handle onto the visibility stack. If it's already on the stack,
     * move it to the top. Cancels any pending {@link showAfter}. No-op if the
     * handle's element is detached from the DOM.
     */
    show(): void;
    /**
     * Schedule a {@link show} `ms` from now. If the user calls {@link hide},
     * {@link dispose}, or {@link show} before the timer fires, the pending
     * timer is cancelled. Calling {@link showAfter} again resets the timer.
     * Used for the hover / caret dwell delay so brief flyovers don't pop the
     * hint.
     */
    showAfter(ms: number): void;
    /**
     * Remove this handle from the visibility stack (revealing whatever is
     * below) AND cancel any pending {@link showAfter}.
     */
    hide(): void;
    /**
     * Replace the HTML this handle will show. Takes effect immediately if this
     * handle is currently on top of the stack.
     */
    setContent(content: string): void;
    /**
     * Remove this handle from the manager permanently. Idempotent — safe to call
     * from cleanup code even when a `hide()` already ran.
     */
    dispose(): void;
}

/**
 * Stamped on every popup a manager renders, on top of whatever `customClass` the
 * consumer asked for. Gives content hints — which are spread across several plugins
 * and use different placements — a single hook to address as a group (zen mode hides
 * them with it).
 */
export const CONTENT_HINT_CLASS = "content-hint";

export interface ContentHintManagerOptions {
    /**
     * Bootstrap Tooltip config applied to the popup this manager renders each
     * hint into. `trigger` is always forced to `"manual"` because the stack,
     * not Bootstrap's hover/focus event bindings, decides when a hint is
     * visible. `html` is always forced to `true`, and {@link CONTENT_HINT_CLASS}
     * is always added to `customClass`.
     */
    tooltipOptions?: Partial<Tooltip.Options>;
    /**
     * If set, the visible hint is auto-popped after this many milliseconds of
     * manager inactivity. Every push, content update, or top-change resets
     * the timer, so the hint stays up as long as *something* is happening;
     * once events stop, it dismisses itself. When it pops, whatever was
     * underneath in the stack becomes visible (and starts its own timer).
     * `null` / `undefined` disables auto-hide.
     */
    autoHideAfterMs?: number;
}

interface StackEntry {
    handle: HintHandle;
    element: HTMLElement;
    content: string;
}

/**
 * Stack-based coordinator for content-area hints in an editor — the popup
 * bubbles that document the affordance under the caret or pointer (task
 * state, collapsible-summary shortcut, drag-handle hint, …). Scoped to the
 * editor's content; toolbar/status tooltips are unrelated.
 *
 * Solves two long-standing problems the per-source event-binding approach has:
 *
 *  - **Overlap**: hover and caret sources racing to show/hide the same hint
 *    end up flickering as each source's Bootstrap listeners fight the other's
 *    manual `show()`/`hide()` calls.
 *  - **Unwanted teardown**: a source hiding "its" hint while a different
 *    source still wants it visible (mouse leaves the checkbox while the caret
 *    is still inside its item) blanks the popup unnecessarily.
 *
 * The manager rents one Bootstrap Tooltip per visible element and mediates
 * every push/pop through {@link _render}, so exactly one popup is on screen at
 * a time and switches are atomic.
 */
export class ContentHintManager {

    private _stack: StackEntry[] = [];
    private _currentElement: HTMLElement | null = null;
    private _currentTooltip: Tooltip | null = null;
    /**
     * The content the current tooltip was last rendered with. Used to skip
     * Bootstrap's `setContent` when the top-of-stack push is a no-op — that
     * call disposes the popper and re-runs `show()`, which redraws the popup
     * and restarts its fade-in (~150-300 ms of visible glitch). Idempotent
     * pushes on the same element with the same content are effectively
     * free.
     */
    private _currentContent: string | null = null;
    private readonly _baseOptions: Partial<Tooltip.Options>;
    private readonly _autoHideAfterMs: number | null;
    private _autoHideTimer: ReturnType<typeof setTimeout> | null = null;
    /** Cleanup registered while a fade-out is in progress; call to cancel it mid-fade. */
    private _pendingHideCleanup: (() => void) | null = null;
    /**
     * Set to `true` by {@link destroy}. Once set, every path that could
     * re-activate the manager (push, render, auto-hide scheduling) short-circuits
     * so outstanding handles genuinely become inert — even if their
     * `showAfter` timers fire late, or their consumer calls `show()` after
     * teardown.
     */
    private _destroyed = false;

    constructor(options: ContentHintManagerOptions = {}) {
        this._baseOptions = options.tooltipOptions ?? {};
        this._autoHideAfterMs = options.autoHideAfterMs ?? null;
    }

    /**
     * Register a hint on `element`. The returned handle is persistent — the
     * caller pushes it on/off the visibility stack at will via `show()`/`hide()`.
     * Call `dispose()` when the source is done with it (e.g. the element was
     * removed from the DOM).
     */
    createHandle(element: HTMLElement, initialContent: string): HintHandle {
        // Content lives in the closure so `setContent` can update it lazily —
        // the stack entry (if any) will pick up the new value from the closure
        // through `_render()`'s next content sync.
        let currentContent = initialContent;
        const currentElement = element;
        let pendingTimer: ReturnType<typeof setTimeout> | null = null;
        const cancelPending = () => {
            if (pendingTimer !== null) {
                clearTimeout(pendingTimer);
                pendingTimer = null;
            }
        };
        const self = this;
        const handle: HintHandle = {
            show(): void {
                cancelPending();
                if (!currentElement.isConnected) {
                    return;
                }
                self._pushOrMoveTop(this, currentElement, currentContent);
            },
            showAfter(ms: number): void {
                cancelPending();
                pendingTimer = setTimeout(() => {
                    pendingTimer = null;
                    if (!currentElement.isConnected) {
                        return;
                    }
                    self._pushOrMoveTop(handle, currentElement, currentContent);
                }, ms);
            },
            hide(): void {
                cancelPending();
                self._removeEntry(this);
            },
            setContent(newContent: string): void {
                currentContent = newContent;
                const entry = self._stack.find(e => e.handle === handle);
                if (entry) {
                    entry.content = newContent;
                    self._render();
                }
            },
            dispose(): void {
                cancelPending();
                self._removeEntry(this);
            }
        };
        return handle;
    }

    /**
     * Dispose the manager. Any outstanding handles become inert (their
     * `show()`/`setContent()` calls no-op because the stack is empty and won't
     * be repopulated).
     */
    destroy(): void {
        this._destroyed = true;
        this._cancelAutoHide();
        this._cancelPendingHide();
        if (this._currentTooltip) {
            this._currentTooltip.dispose();
        }
        this._currentTooltip = null;
        this._currentElement = null;
        this._currentContent = null;
        this._stack.length = 0;
    }

    private _pushOrMoveTop(handle: HintHandle, element: HTMLElement, content: string): void {
        // The choke point for every path that could add or resurface an entry —
        // fresh `show()`, `showAfter` timer fire, `show()` on a re-used handle.
        // Gating here keeps handles inert after {@link destroy}.
        if (this._destroyed) {
            return;
        }
        const existingIdx = this._stack.findIndex(e => e.handle === handle);
        if (existingIdx >= 0) {
            const [entry] = this._stack.splice(existingIdx, 1);
            entry.element = element;
            entry.content = content;
            this._stack.push(entry);
        } else {
            this._stack.push({ handle, element, content });
        }
        this._render();
    }

    private _removeEntry(handle: HintHandle): void {
        const idx = this._stack.findIndex(e => e.handle === handle);
        if (idx < 0) {
            return;
        }
        this._stack.splice(idx, 1);
        this._render();
    }

    private _render(): void {
        /* v8 ignore start -- defensively unreachable. Every caller
           (`_pushOrMoveTop`, `_removeEntry`, `setContent`, the auto-hide
           timer) either checks `_destroyed` themselves or is disarmed by
           `destroy`: `destroy` clears `_stack` (so `_removeEntry`/`setContent`
           find no entry and skip the `_render` call) and cancels the auto-hide
           timer (so its callback never fires). Kept as a belt-and-braces guard
           in case a new call site is added later. */
        if (this._destroyed) {
            return;
        }
        /* v8 ignore stop */
        // A push or setContent interrupts any fade currently in progress —
        // the user has done something, so we shouldn't tear the popup down.
        const wasFading = this._cancelPendingHide();

        // Reap dead entries anywhere in the stack — a source may have gone away
        // between pushes, and we don't want its stale slot resurfacing on pop.
        this._stack = this._stack.filter(e => e.element.isConnected);

        const top: StackEntry | undefined = this._stack[this._stack.length - 1];
        const targetElement = top?.element ?? null;

        // Same element on top → refresh content on the existing popup, but
        // ONLY if content actually changed. Bootstrap's `setContent` does a
        // full `_disposePopper()` + `show()` internally, which redraws the
        // tip and restarts the fade-in transition (~150-300 ms of visible
        // glitch). Skipping when content is unchanged makes idempotent
        // pushes (e.g. hover + caret driving the same handle with the same
        // title) free.
        if (this._currentElement === targetElement) {
            /* v8 ignore next -- if we're in this branch, either both are the
               same non-null element (then `_currentTooltip` is truthy and `top`
               is defined) or both are null (then the outer `_render` was called
               on an already-empty state, which no live code path does — pushes
               always precede a same-element render). */
            if (this._currentTooltip && top) {
                if (top.content !== this._currentContent) {
                    this._currentTooltip.setContent({ ".tooltip-inner": top.content });
                    this._currentContent = top.content;
                }
                if (wasFading) {
                    // We interrupted a fade-out — Bootstrap already removed the
                    // `show` class, so call `show()` again to restore visibility.
                    this._currentTooltip.show();
                }
            }
            this._resetAutoHide();
            return;
        }

        // Element changed (or nothing on top). Dispose the outgoing popup;
        // create + show a fresh one for the new element.
        if (this._currentTooltip) {
            this._currentTooltip.dispose();
            this._currentTooltip = null;
        }
        this._currentElement = targetElement;
        this._currentContent = top?.content ?? null;

        if (top) {
            this._currentTooltip = new Tooltip(top.element, {
                ...this._baseOptions,
                customClass: this._customClass(),
                title: top.content,
                html: true,
                trigger: "manual"
            });
            this._currentTooltip.show();
        }
        this._resetAutoHide();
    }

    /**
     * The consumer's `customClass` with {@link CONTENT_HINT_CLASS} prepended.
     * Bootstrap also accepts a function form, so preserve that shape when given one.
     */
    private _customClass(): Tooltip.Options["customClass"] {
        const base = this._baseOptions.customClass;
        if (typeof base === "function") {
            return function (this: unknown) {
                return `${CONTENT_HINT_CLASS} ${base.call(this)}`;
            };
        }
        return base ? `${CONTENT_HINT_CLASS} ${base}` : CONTENT_HINT_CLASS;
    }

    /**
     * (Re)start the auto-hide countdown. Called after every `_render` that
     * leaves state stable, so any push / setContent / re-order effectively
     * "keeps the hint alive" for another `_autoHideAfterMs` ms. When the
     * countdown fires it pops the current top; if nothing else is on the
     * stack it fades the popup out (via {@link _hideWithTransition}),
     * otherwise it delegates to `_render` for the swap.
     */
    private _resetAutoHide(): void {
        this._cancelAutoHide();
        if (this._autoHideAfterMs === null || !this._currentTooltip) {
            return;
        }
        this._autoHideTimer = setTimeout(() => {
            this._autoHideTimer = null;
            /* v8 ignore start -- defensively unreachable. The timer is only
               scheduled by `_resetAutoHide` when `_currentTooltip` is truthy,
               i.e. the stack is non-empty. Every path that could empty the
               stack (`hide`, `dispose`, `destroy`) runs synchronously and
               either cancels this timer (`_cancelAutoHide`) or falls through
               to `_render`, which re-runs `_resetAutoHide` after the mutation
               and would clear us before we fire. Kept as a belt-and-braces
               guard in case a new mutation path is added later. */
            if (this._stack.length === 0) {
                return;
            }
            /* v8 ignore stop */
            this._stack.pop();
            if (this._stack.length === 0) {
                // Nothing left — fade the popup out with Bootstrap's transition.
                this._hideWithTransition();
            } else {
                // Reveal whatever's now on top. `_render` picks same-element vs
                // different-element and does the appropriate thing.
                this._render();
            }
        }, this._autoHideAfterMs);
    }

    private _cancelAutoHide(): void {
        if (this._autoHideTimer !== null) {
            clearTimeout(this._autoHideTimer);
            this._autoHideTimer = null;
        }
    }

    /**
     * Play Bootstrap's built-in fade-out transition on the current popup and
     * dispose it once the fade completes. Interruption-safe: a push arriving
     * mid-fade cancels the cleanup via {@link _cancelPendingHide}, so the
     * partly-faded popup can be re-shown in place instead of blinked out.
     */
    private _hideWithTransition(): void {
        const tooltip = this._currentTooltip;
        const element = this._currentElement;
        /* v8 ignore start -- defensively unreachable. `_hideWithTransition`
           is only called from the auto-hide timer, which is only scheduled
           when `_currentTooltip` is truthy; `_currentElement` is set alongside
           `_currentTooltip` in every `_render` code path. Kept as a
           belt-and-braces guard in case a new call site is added later. */
        if (!tooltip || !element) {
            return;
        }
        /* v8 ignore stop */
        const onHidden = () => {
            element.removeEventListener("hidden.bs.tooltip", onHidden);
            this._pendingHideCleanup = null;
            // If we're still the current popup (no interrupting push landed)
            // then dispose ourselves and reset state.
            /* v8 ignore next -- the false branch (currentTooltip changed while
               the fade was in flight) is defensively unreachable: every
               interruption path (`_render` on a push, `destroy`) first calls
               `_cancelPendingHide`, which removes this listener before it can
               fire. Kept for safety if a new interruption path forgets to. */
            if (this._currentTooltip === tooltip) {
                tooltip.dispose();
                this._currentTooltip = null;
                this._currentElement = null;
                this._currentContent = null;
            }
        };
        this._pendingHideCleanup = () => {
            element.removeEventListener("hidden.bs.tooltip", onHidden);
            this._pendingHideCleanup = null;
        };
        element.addEventListener("hidden.bs.tooltip", onHidden);
        // `hide()` triggers Bootstrap's opacity transition; when it completes,
        // the `hidden.bs.tooltip` event fires and `onHidden` disposes.
        tooltip.hide();
    }

    /**
     * Cancel a pending fade-out (if any). Returns `true` if a fade was actually
     * cancelled — callers use that to re-`show()` the popup so it isn't left
     * mid-transition with the `show` class removed.
     */
    private _cancelPendingHide(): boolean {
        if (this._pendingHideCleanup) {
            this._pendingHideCleanup();
            return true;
        }
        return false;
    }

}

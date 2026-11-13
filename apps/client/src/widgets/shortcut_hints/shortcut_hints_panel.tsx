import "./shortcut_hints_kbd.css";
import "./shortcut_hints_panel.css";

import { autoUpdate } from "@floating-ui/dom";
import clsx from "clsx";
import { createPortal, Fragment } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n.js";
import keyboard_actions from "../../services/keyboard_actions.js";
import type { ShortcutHint, ShortcutHintSection } from "../../services/shortcut_hints.js";
import { useTriliumEvent } from "../react/hooks.js";
import { placeFloating } from "../react/Popup.js";
import { renderShortcutKbds } from "../react/shortcut_kbd.js";

/** How long the panel stays up when left untouched. Paused while hovered; other signals dismiss it sooner. */
const AUTO_DISMISS_MS = 5000;
/** Gap between an anchor (help button) and the dropdown. */
const ANCHOR_GAP = 6;

/** Closes the panel that is open, or `null` while none is. */
let closeOpenPanel: (() => void) | null = null;

interface OpenState {
    sections: ShortcutHintSection[];
    /** When set, the pane is a dropdown anchored to this element; otherwise it sits in the corner. */
    anchor: HTMLElement | null;
}

export default function ShortcutHintsPanel() {
    // `undefined` means closed. Only ever set with a non-empty section list, so presence == open.
    const [ state, setState ] = useState<OpenState>();
    const panelRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | undefined>(undefined);
    // Kept in a ref so the outside-click handler always sees the current anchor without re-subscribing.
    const anchorRef = useRef<HTMLElement | null>(null);
    anchorRef.current = state?.anchor ?? null;

    const close = useCallback(() => setState(undefined), []);
    const clearTimer = useCallback(() => {
        if (timerRef.current !== undefined) {
            window.clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
    }, []);
    const startTimer = useCallback(() => {
        clearTimer();
        timerRef.current = window.setTimeout(close, AUTO_DISMISS_MS);
    }, [ clearTimer, close ]);

    // Toggle: close if open, otherwise open (unless there's nothing to show).
    useTriliumEvent("shortcutHintsRequested", useCallback(({ sections, anchor }) => {
        setState(prev => (prev !== undefined || sections.length === 0) ? undefined : { sections, anchor: anchor ?? null });
    }, []));
    useTriliumEvent("activeContextChanged", close);

    const isOpen = state !== undefined;
    const isPersistent = !!state?.sections.some((section) => section.isPersistent);
    useEffect(() => {
        if (!isOpen) {
            clearTimer();
            return;
        }
        if (!isPersistent) {
            startTimer();
        }
        closeOpenPanel = close;

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") close();
        }
        function onMouseDown(e: MouseEvent) {
            const target = e.target as Node;
            // Clicks on the panel keep it open; clicks on the anchor are handled by its own toggle.
            if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
            close();
        }
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("mousedown", onMouseDown);
        return () => {
            clearTimer();
            if (closeOpenPanel === close) {
                closeOpenPanel = null;
            }
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("mousedown", onMouseDown);
        };
    }, [ isOpen, isPersistent, startTimer, clearTimer, close ]);

    // Under the anchor with the right edges lined up, flipped and shifted as the window requires,
    // and following the anchor while it moves.
    const anchor = state?.anchor;
    // The tooltip of the anchor would cover the panel, so it stays hidden while the panel is open.
    useEffect(() => {
        if (!anchor) return;
        const preventTooltip = (event: Event) => event.preventDefault();
        anchor.addEventListener("show.bs.tooltip", preventTooltip);
        return () => anchor.removeEventListener("show.bs.tooltip", preventTooltip);
    }, [ anchor ]);
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel || !anchor) return;
        return autoUpdate(anchor, panel, () => void placeFloating(panel, anchor, {
            placement: "bottom-end",
            offset: ANCHOR_GAP
        }));
    }, [ anchor ]);

    if (!state) {
        return null;
    }

    // Portal to <body> so no transformed / contained / overflow-clipped ancestor breaks the fixed
    // positioning or hides it behind content.
    return createPortal(
        <div
            ref={panelRef}
            className={clsx("shortcut-hints-panel tn-shortcut-hints-kbd", state.anchor && "anchored")}
            onMouseEnter={clearTimer}
            onMouseLeave={isPersistent ? undefined : startTimer}
        >
            <ShortcutHintsSections sections={state.sections} />
            {/* Keyboard users get the Esc reminder; mouse users (opened via the button) click away. */}
            {!state.anchor && (
                <div className="shortcut-hints-footer">
                    {renderShortcutKbds("Escape")} {t("shortcut_hints.esc_hint")}
                </div>
            )}
        </div>,
        document.body
    );
}

/** Closes the open panel, as Escape does. Returns whether one was open. */
export function closeShortcutHints(): boolean {
    const close = closeOpenPanel;
    close?.();
    return !!close;
}

export function ShortcutHintsSections({ sections }: { sections: ShortcutHintSection[] }) {
    return (
        <>
            {sections.map((section, i) => section.content
                ? <Fragment key={i}>{section.content()}</Fragment>
                : (
                    <div className="shortcut-hints-section" key={i}>
                        {section.titleKey && <div className="shortcut-hints-section-title">{t(section.titleKey)}</div>}
                        <dl className="shortcut-hints-list">
                            {section.hints.map((hint, j) => <HintRow hint={hint} key={j} />)}
                        </dl>
                    </div>
                ))}
        </>
    );
}

function HintRow({ hint }: { hint: ShortcutHint }) {
    const [ shortcuts, setShortcuts ] = useState<string[]>(() => "keys" in hint ? hint.keys : []);
    const [ friendlyName, setFriendlyName ] = useState<string>();

    useEffect(() => {
        if ("keys" in hint) {
            setShortcuts(hint.keys);
            return;
        }
        // `action` hints resolve to the user's current, rebindable binding.
        let cancelled = false;
        keyboard_actions.getAction(hint.action).then(action => {
            if (cancelled) return;
            setShortcuts(action?.effectiveShortcuts ?? []);
            setFriendlyName(action?.friendlyName);
        });
        return () => { cancelled = true; };
    }, [ hint ]);

    const description = hint.labelKey ? t(hint.labelKey) : friendlyName ?? "";

    // `dt`/`dd` are direct children of the section's `dl`, so they align as the two grid columns:
    // action label (left) then shortcut keys (right).
    return (
        <>
            <dt className="shortcut-hint-description">{description}</dt>
            <dd className="shortcut-hint-keys">
                {shortcuts.map((shortcut, i) => (
                    <span className="shortcut-hint-alt" key={i}>{renderShortcutKbds(shortcut)}</span>
                ))}
            </dd>
        </>
    );
}

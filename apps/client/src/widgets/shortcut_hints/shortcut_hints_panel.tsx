import "./shortcut_hints_kbd.css";
import "./shortcut_hints_panel.css";

import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n.js";
import keyboard_actions from "../../services/keyboard_actions.js";
import type { ShortcutHint, ShortcutHintSection } from "../../services/shortcut_hints.js";
import { useTriliumEvent } from "../react/hooks.js";
import { renderShortcutKbds } from "../react/shortcut_kbd.js";

/** How long the panel stays up when left untouched. Paused while hovered; other signals dismiss it sooner. */
const AUTO_DISMISS_MS = 5000;
/** Gap between an anchor (help button) and the dropdown. */
const ANCHOR_GAP = 6;

interface OpenState {
    sections: ShortcutHintSection[];
    /** When set, the pane is a dropdown anchored to this element; otherwise it sits in the corner. */
    anchor: HTMLElement | null;
}

export default function ShortcutHintsPanel() {
    // `undefined` means closed. Only ever set with a non-empty section list, so presence == open.
    const [ state, setState ] = useState<OpenState>();
    const panelRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number>();
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
    useEffect(() => {
        if (!isOpen) {
            clearTimer();
            return;
        }
        startTimer();

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
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("mousedown", onMouseDown);
        };
    }, [ isOpen, startTimer, clearTimer, close ]);

    if (!state) {
        return null;
    }

    // Anchored: position the dropdown under the anchor, right edges aligned. The rect is a genuinely
    // dynamic value, so it belongs in an inline style rather than CSS.
    const anchorRect = state.anchor?.getBoundingClientRect();
    const style = anchorRect
        ? { top: `${anchorRect.bottom + ANCHOR_GAP}px`, right: `${Math.max(ANCHOR_GAP, window.innerWidth - anchorRect.right)}px`, bottom: "auto" }
        : undefined;

    // Portal to <body> so no transformed / contained / overflow-clipped ancestor breaks the fixed
    // positioning or hides it behind content.
    return createPortal(
        <div ref={panelRef} className="shortcut-hints-panel tn-shortcut-hints-kbd" style={style} onMouseEnter={clearTimer} onMouseLeave={startTimer}>
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

export function ShortcutHintsSections({ sections }: { sections: ShortcutHintSection[] }) {
    return (
        <>
            {sections.map((section, i) => (
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

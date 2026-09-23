import "./shortcut_hints_kbd.css";
import "./shortcut_hint_button.css";

import clsx from "clsx";
import type { TargetedMouseEvent } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";

import appContext from "../../components/app_context.js";
import { t } from "../../services/i18n.js";
import keyboard_actions from "../../services/keyboard_actions.js";
import { formatShortcut, joinShortcut } from "../../services/keyboard_shortcut_display.js";
import { collectShortcutHints } from "../../services/shortcut_hints.js";
import OverlayControlGroup, {
    OverlayControlButton, type OverlayPlacement
} from "../react/OverlayControlGroup.js";
import { ParentComponent } from "../react/react_utils.js";

/**
 * Standalone shortcut-hints button in its own overlay group; `className` positions the group. Use
 * this when the widget has no existing overlay controls. To add the button to an *existing*
 * {@link OverlayControlGroup}, use the {@link ShortcutHintOverlayButton} named export instead.
 */
export default function ShortcutHintButton(
    { className, placement = "top-end" }: { className?: string; placement?: OverlayPlacement }
) {
    return (
        // The group opens its tooltips away from the edge it is pinned to, of its own accord (see
        // `placement` on OverlayControlGroup).
        <OverlayControlGroup
            className={clsx("shortcut-hint-button-group", className)}
            placement={placement}
        >
            <ShortcutHintOverlayButton />
        </OverlayControlGroup>
    );
}

/**
 * Just the overlay button (no group wrapper), for placing alongside other buttons inside an existing
 * {@link OverlayControlGroup} — whose tooltip direction it then takes, as its neighbours do. It opens
 * the contextual shortcut-hints pane as a dropdown, collecting the hints from its own widget context.
 */
export function ShortcutHintOverlayButton() {
    const parentComponent = useContext(ParentComponent);
    const [ shortcut, setShortcut ] = useState("Alt+F1");

    useEffect(() => {
        keyboard_actions.getAction("showShortcutHints", true).then(action => {
            const first = action?.effectiveShortcuts?.[0];
            if (first) setShortcut(joinShortcut(formatShortcut(first), "+"));
        });
    }, []);

    // The pane is anchored to the button the press landed on, which the press itself names — no ref
    // of our own to hold it.
    const onClick = useCallback((e: TargetedMouseEvent<HTMLButtonElement>) => {
        const sections = collectShortcutHints(parentComponent);
        appContext.triggerEvent("shortcutHintsRequested", { sections, anchor: e.currentTarget });
    }, [ parentComponent ]);

    return (
        <OverlayControlButton
            title={t("shortcut_hints.show_button")}
            // A keycap standing for itself rather than words that would name the button, so what it
            // is called is said outright.
            aria-label={t("shortcut_hints.show_button")}
            text={<>
                <kbd>?</kbd>
                <span className="shortcut-hint-button-key">{shortcut}</span>
            </>}
            className="shortcut-hint-button tn-shortcut-hints-kbd"
            onClick={onClick}
        />
    );
}

import "./ContextualHelp.css";

import { Tooltip } from "bootstrap";
import type { RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";
import { useStaticTooltip } from "./hooks";
import Modal from "./Modal";

interface ContextualHelpProps {
    /** What the icon explains, shown on hover or — on a phone — on tap. */
    helpMessage: string;
}

/**
 * The small info affordance that sits beside a label or a figure and explains it on hover — for a
 * remark too slight to be spelled out in the interface itself, and which nothing is lost by missing.
 *
 * The explanation goes on the app's tooltip rather than the browser's: a native one would appear
 * somewhere else, after its own delay and in its own styling, while whatever this icon sits beside
 * already carries the app's. Where a subject warrants a paragraph, markup or a help page of its own,
 * reach for `HelpTooltipButton` instead — this one is the passing remark.
 */
export default function ContextualHelp({ helpMessage }: ContextualHelpProps) {
    return IS_MOBILE
        ? <TappedHelp helpMessage={helpMessage} />
        : <HoveredHelp helpMessage={helpMessage} />;
}

/** Which affordance the icon carries, read once: the layout it answers to holds for the session. */
const IS_MOBILE = isMobile();

/** The pointer's: the explanation is a hover — or a focus, or a key press — away. */
function HoveredHelp({ helpMessage }: ContextualHelpProps) {
    const ref = useRef<HTMLSpanElement>(null);

    useStaticTooltip(ref, useMemo(() => ({
        title: helpMessage,
        placement: "bottom" as const,
        // These icons are often shown inside the settings dialog, and the dialog's own overlays
        // (the content manager's, say) lift themselves above the base tooltip layer. `tooltip-top`
        // is the app's "above everything" layer, so the hint clears those too.
        customClass: "tooltip-top"
    }), [ helpMessage ]));

    return (
        <HelpIcon
            iconRef={ref}
            helpMessage={helpMessage}
            // Reaching the icon reveals the explanation by itself — Bootstrap's default trigger is
            // "hover focus" — so what the key press adds is the other half: dismissing it again
            // without tabbing away, and answering a screen reader's activation of the control.
            onActivate={() => toggleTooltip(ref)}
            onDismiss={() => dismissTooltip(ref)}
        />
    );
}

/**
 * The thumb's: nothing hovers on a phone, so the explanation is a tap away — in the sheet that
 * rises from the bottom of the screen, which is where this app already puts what a thumb opens.
 *
 * Portalled to the body, since the icon sits wherever it explains something — inside a chart, a
 * table cell, a scroll container — and a sheet left there is laid out and clipped by that, rather
 * than by the screen it is supposed to rise from. Stackable for the same reason of place: the icon
 * is usually inside a dialog of its own (the settings pages, above all), and opening the sheet must
 * not take that dialog down with it.
 */
function TappedHelp({ helpMessage }: ContextualHelpProps) {
    const [ shown, setShown ] = useState(false);

    return (
        <>
            <HelpIcon
                helpMessage={helpMessage}
                popup="dialog"
                onActivate={() => setShown(true)}
            />

            {createPortal((
                <Modal
                    className="contextual-help-sheet"
                    size="md"
                    show={shown}
                    onHidden={() => setShown(false)}
                    stackable
                    // It carries no title — one sentence needs no heading over it — so without this
                    // a screen reader would announce it as an unnamed dialog and leave the reader
                    // to work out what had just opened.
                    ariaLabel={t("contextual_help.sheet_label")}
                >
                    {helpMessage}
                </Modal>
            ), document.body)}
        </>
    );
}

interface HelpIconProps {
    iconRef?: RefObject<HTMLSpanElement>;
    helpMessage: string;
    /** What activating the icon opens, for anything that is not simply revealed in place. */
    popup?: "dialog";
    onActivate: () => void;
    /** Closes whatever the icon has open, answering whether there was anything to close. */
    onDismiss?: () => boolean;
}

/**
 * The icon both affordances are drawn as: a control rather than a decoration, so it is reachable by
 * keyboard, announced as something that can be activated, and answers `Enter`/`Space` with whatever
 * a pointer would have done.
 *
 * Its accessible name carries the explanation itself. Bootstrap points `aria-describedby` at the
 * tooltip while one is shown and takes the attribute away again on hide, so leaning on that would
 * leave the message reachable only during the moments it happens to be on screen — and on a phone
 * there is no tooltip at all.
 */
function HelpIcon({ iconRef, helpMessage, popup, onActivate, onDismiss }: HelpIconProps) {
    return (
        <span
            ref={iconRef}
            className="bx bx-info-circle contextual-help-icon"
            role="button"
            tabIndex={0}
            aria-label={t("contextual_help.label", { message: helpMessage })}
            aria-haspopup={popup}
            onClick={onActivate}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    // Space scrolls the page under the icon otherwise, which is exactly the thing
                    // the explanation was meant to be read against.
                    e.preventDefault();
                    onActivate();
                } else if (e.key === "Escape" && onDismiss?.()) {
                    // Held back only when it actually dismissed something. These icons usually sit
                    // inside a dialog, which closes on an Escape that reaches it — discarding
                    // whatever was being filled in there to put away a tooltip. With nothing open
                    // the key is not ours, and the dialog is welcome to it.
                    e.stopPropagation();
                }
            }}
        />
    );
}

/** Shows the icon's explanation, or puts it away again if it is already up. */
function toggleTooltip(iconRef: RefObject<HTMLSpanElement>) {
    const element = iconRef.current;

    if (element) {
        Tooltip.getInstance(element)?.toggle();
    }
}

/**
 * Puts the explanation away if it is up, answering whether there was one to put away.
 *
 * Bootstrap stamps `aria-describedby` on the trigger for as long as its tooltip is on screen and
 * takes it off again on hide, which is the only public sign of whether one is open — and asking
 * matters, because the answer decides whether the key press is ours to keep.
 */
function dismissTooltip(iconRef: RefObject<HTMLSpanElement>) {
    const element = iconRef.current;

    if (!element?.hasAttribute("aria-describedby")) {
        return false;
    }

    Tooltip.getInstance(element)?.hide();
    return true;
}

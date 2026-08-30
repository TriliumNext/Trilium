import "./OptionsPageHeader.css";

import clsx from "clsx";
import { ComponentChildren, createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";

import HelpButton from "../../../react/HelpButton";
import { useNoteContext } from "../../../react/hooks";

/**
 * Where a page's help mark goes when the banner is no place for it: the phone's master-detail flow,
 * whose own header carries the page name and so is where a mark explaining that page belongs. A
 * host that offers this takes the mark; one that does not leaves the banner to draw it.
 */
export const PageHelpSlot = createContext<((helpUrl: string | undefined) => void) | undefined>(undefined);

interface OptionsPageHeaderProps {
    /**
     * Page-specific controls shown on the title row — e.g. a master enable toggle or, for the
     * shortcuts page, the conflicts badge and reset buttons.
     */
    actions?: ComponentChildren;
    /**
     * Content shown on its own full-width row beneath the title row but still inside the header bar
     * — e.g. the shortcuts page's filter/search box.
     */
    below?: ComponentChildren;
    /**
     * In-app help page shown as a help button next to the title. Use this for single-section pages
     * where the help is page-level rather than scoped to one card.
     */
    helpUrl?: string;
    /** Title of a page that is not a note of its own, such as the options search. */
    title?: string;
    /** Icon to go with {@link OptionsPageHeaderProps.title}, in `bx bx-…` form. */
    icon?: string;
}

/**
 * The header banner an options page renders at the top of its content: the page title and icon
 * beside any page-defined {@link OptionsPageHeaderProps.actions}, with optional
 * {@link OptionsPageHeaderProps.below} content on a full-width row underneath.
 *
 * This header is the page's title everywhere it renders — in the settings dialog, and (for a page
 * opened standalone in a tab) in place of the note's own title chrome, which `InlineTitle` suppresses
 * for options pages. The sticky-bar styling differs per context (see the CSS), but each page owns its
 * header the same way in all of them.
 */
export default function OptionsPageHeader({
    actions, below, helpUrl, title, icon
}: OptionsPageHeaderProps) {
    const { note } = useNoteContext();
    const shownTitle = title ?? note?.title;
    const shownIcon = icon ?? note?.getIcon();
    const liftHelp = useContext(PageHelpSlot);

    // Handed over for as long as this page is the one on show, and taken back when it is not.
    useEffect(() => {
        if (!liftHelp) return;

        liftHelp(helpUrl);
        return () => liftHelp(undefined);
    }, [ liftHelp, helpUrl ]);

    // Nothing to render: the note isn't available yet and the page provided no content.
    if (!shownTitle && !actions && !below) return null;

    return (
        // A header carrying nothing but the page's name is marked as such: on a phone the name is
        // shown beside the way back instead, leaving this with no band of its own to draw (see CSS).
        <div className={clsx("options-page-header", !actions && !below && "options-page-header-title-only")}>
            <div className="options-page-header-inner">
                {(shownTitle || actions) && (
                    <div className="options-page-header-main">
                        {shownTitle && (
                            <div className="options-page-header-titles">
                                <span className={`options-page-header-icon ${shownIcon}`} aria-hidden="true" />
                                <h2 className="options-page-header-title">{shownTitle}</h2>
                                {helpUrl && !liftHelp &&
                                    <HelpButton className="options-page-header-help" helpPage={helpUrl} />}
                            </div>
                        )}
                        {actions && <div className="options-page-header-actions">{actions}</div>}
                    </div>
                )}
                {below && <div className="options-page-header-below">{below}</div>}
            </div>
        </div>
    );
}

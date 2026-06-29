import "./OptionsPageHeader.css";

import { ComponentChildren } from "preact";

import { useNoteContext } from "../../../react/hooks";
import HelpButton from "../../../react/HelpButton";

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
export default function OptionsPageHeader({ actions, below, helpUrl }: OptionsPageHeaderProps) {
    const { note } = useNoteContext();

    // Nothing to render: the note isn't available yet and the page provided no content.
    if (!note && !actions && !below) return null;

    return (
        <div className="options-page-header">
            <div className="options-page-header-inner">
                {(note || actions) && (
                    <div className="options-page-header-main">
                        {note && (
                            <div className="options-page-header-titles">
                                <span className={`options-page-header-icon ${note.getIcon()}`} aria-hidden="true" />
                                <h2 className="options-page-header-title">{note.title}</h2>
                                {helpUrl && <HelpButton helpPage={helpUrl} />}
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

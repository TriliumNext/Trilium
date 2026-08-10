import "./SidebarHelp.css";

import { t } from "../../services/i18n";
import { bySidebarSection, SidebarSectionId } from "../../services/in_app_help";
import HelpDropdown from "../react/HelpDropdown";

/**
 * The `?` of one card of the right sidebar: the short answer given in place, with a link on to the
 * in-app help page the section belongs to. What it says of each section is kept with the rest of the
 * in-app help pointers, in {@link bySidebarSection}.
 *
 * Goes in the card's `buttons`, ahead of whatever else the header holds — so it sits in the same place
 * from one card to the next, the way the attributes card already has it.
 *
 * A dropdown rather than a plain `HelpButton`: the questions a sidebar card raises are short-answer
 * ones, and sending the reader of a glance-sized pane off into a help page over the note they were
 * reading is a long way round for a sentence. The full page is still a press away at the foot of the
 * popup — as a quick-edit popup rather than a split, for the same reason the pane is a glance: a
 * split would rearrange the window around a note that is only being looked up, and while the pane is
 * peeked it would open underneath the overlay the reader is reading from.
 */
export default function SidebarHelp({ section }: { section: SidebarSectionId }) {
    const { helpPage, paragraphs } = bySidebarSection[section];

    return (
        <HelpDropdown helpPage={helpPage} openInPopup>
            {/* The popup is portalled to the body, so the styling has to hang off a class within it
                rather than off the dropdown's own. */}
            <div class="sidebar-help">
                {paragraphs.map((key) => <p key={key}>{t(key)}</p>)}
            </div>
        </HelpDropdown>
    );
}

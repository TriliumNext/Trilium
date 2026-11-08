import "./HelpDropdown.css";

import { ComponentChildren } from "preact";

import { t } from "../../services/i18n";
import { DropdownPanel } from "./Dropdown";
import { openHelpPage } from "./HelpButton";
import LinkButton from "./LinkButton";

interface HelpDropdownProps {
    /** The help content itself, rendered inside the popup. */
    children: ComponentChildren;
    /** In-app help note ID; when set, a link to the full help page is appended below the content. */
    helpPage?: string;
    /**
     * Open {@link helpPage} as a quick-edit popup over the app instead of in a split beside the note.
     * For hosts the split would be lost behind or would shove aside — see {@link openHelpPage}.
     */
    openInPopup?: boolean;
    className?: string;
    /** Called as the popup opens, for hosts that need to dismiss their own popups first. */
    onShown?: () => void;
}

/**
 * A `?` icon button revealing a popup with inline help, optionally linking to the full help page.
 *
 * Prefer this over {@link HelpButton} when there is a short explanation worth showing in place, and
 * over a Bootstrap tooltip whenever the help is more than a few words: the popup is dismissed
 * explicitly (click outside or <kbd>Escape</kbd>) instead of on blur, so its content stays readable
 * and selectable.
 */
export default function HelpDropdown({ children, helpPage, openInPopup, className, onShown }: HelpDropdownProps) {
    return (
        <DropdownPanel
            onShown={onShown}
            className={`help-dropdown ${className ?? ""}`}
            buttonClassName="bx bx-help-circle"
            dropdownContainerClassName="help-dropdown-content"
            title={t("show-help")}
            iconAction
            hideToggleArrow
            noSelectButtonStyle
        >
            {children}

            {helpPage && (
                <LinkButton
                    text={t("open-help-page")}
                    onClick={() => openHelpPage(helpPage, !!openInPopup)}
                />
            )}
        </DropdownPanel>
    );
}

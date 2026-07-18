import "./SettingsNavigation.css";

import clsx from "clsx";

import { useOptionPages } from "../../../dialogs/OptionsDialog";

interface SettingsNavigationProps {
    /** Note ID of the settings page currently being displayed (e.g. `_optionsAppearance`). */
    activeNoteId: string;
}

/**
 * In-content selector for the settings pages, rendered alongside the active options page.
 *
 * It mirrors the list of pages otherwise reached through the note tree, reading them straight from
 * the `_options` subtree so titles, icons and ordering stay in sync. Each entry is a plain internal
 * link; navigation within the quick-edit popup is handled by the popup's own link interceptor, while
 * modified clicks (ctrl/middle/shift) fall through to the global handler to open a new tab/window.
 */
export default function SettingsNavigation({ activeNoteId }: SettingsNavigationProps) {
    const pages = useOptionPages();

    return (
        <nav className="settings-navigation">
            {pages.map((page) => {
                const isActive = page.noteId === activeNoteId;
                return (
                    <a
                        key={page.noteId}
                        href={`#root/_hidden/_options/${page.noteId}`}
                        className={clsx("settings-navigation-item no-tooltip-preview", { active: isActive })}
                        aria-current={isActive ? "page" : undefined}
                    >
                        <span className={page.getIcon()} />
                        <span className="settings-navigation-title">{page.title}</span>
                    </a>
                );
            })}
        </nav>
    );
}

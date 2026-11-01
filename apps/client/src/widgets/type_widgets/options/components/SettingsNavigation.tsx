import "./SettingsNavigation.css";

import clsx from "clsx";

import type FNote from "../../../../entities/fnote";
import { t } from "../../../../services/i18n";
import { useOptionPages } from "../../../dialogs/OptionsDialog";
import { Badge } from "../../../react/Badge";

interface SettingsNavigationProps {
    /** Note ID of the settings page currently being displayed (e.g. `_optionsAppearance`). */
    activeNoteId: string;
}

/**
 * In-content selector for the settings pages, rendered alongside the active options page. A page
 * labeled `#beta` in the hidden subtree carries a "Beta" badge, and the pages labeled `#adminOnly`
 * come last, under an "Administration" heading.
 *
 * It mirrors the list of pages otherwise reached through the note tree, reading them straight from
 * the `_options` subtree so titles, icons and ordering stay in sync. Each entry is a plain internal
 * link; navigation within the quick-edit popup is handled by the popup's own link interceptor, while
 * modified clicks (ctrl/middle/shift) fall through to the global handler to open a new tab/window.
 */
export default function SettingsNavigation({ activeNoteId }: SettingsNavigationProps) {
    const { pages, adminPages } = groupOptionPages(useOptionPages());

    return (
        <nav className="settings-navigation">
            {pages.map((page) => <SettingsNavigationItem key={page.noteId} page={page} activeNoteId={activeNoteId} />)}
            {adminPages.length > 0 && <div className="settings-navigation-heading">{t("settings.administration")}</div>}
            {adminPages.map((page) => <SettingsNavigationItem key={page.noteId} page={page} activeNoteId={activeNoteId} />)}
        </nav>
    );
}

function SettingsNavigationItem({ page, activeNoteId }: { page: FNote; activeNoteId: string }) {
    const isActive = page.noteId === activeNoteId;
    return (
        <a
            href={`#root/_hidden/_options/${page.noteId}`}
            className={clsx("settings-navigation-item no-tooltip-preview", { active: isActive })}
            aria-current={isActive ? "page" : undefined}
        >
            <span className={page.getIcon()} />
            <span className="settings-navigation-title">{page.title}</span>
            {page.hasLabel("beta") && (
                <Badge text={t("common.beta")} className="settings-navigation-beta-badge" outline />
            )}
        </a>
    );
}

/** Splits the settings pages into the ones every user gets and the `#adminOnly` ones, keeping each in tree order. */
export function groupOptionPages(allPages: FNote[]) {
    return {
        pages: allPages.filter((page) => !page.hasLabel("adminOnly")),
        adminPages: allPages.filter((page) => page.hasLabel("adminOnly"))
    };
}

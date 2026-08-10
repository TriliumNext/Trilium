import appContext from "../../../../components/app_context";
import { t } from "../../../../services/i18n";
import type { OptionPages } from "../../ContentWidget";
import { OptionsRowLink } from "./OptionsRow";
import OptionsSection from "./OptionsSection";

interface RelatedSettingsItem {
    title: string;
    description?: string;
    /** Link to another options page. */
    targetPage?: OptionPages;
    /** Link to an arbitrary hidden-subtree note (e.g. `_taskStates`). */
    targetNoteId?: string;
    /**
     * Navigates by itself, for an entry that has something to do before or instead of following its
     * link. It has to stop the event, since the global link handler would otherwise navigate as
     * well — and for the same reason the entry opts out of the dialog's contained navigation, which
     * would swallow the click before it ever arrives here.
     */
    onClick?: (e: MouseEvent) => void;
    enabled?: boolean;
}

interface RelatedSettingsProps {
    items: RelatedSettingsItem[];
    /** Heading of the section, when these entries are something other than related settings. */
    title?: string;
}

export default function RelatedSettings({ items, title }: RelatedSettingsProps) {
    const filteredItems = items.filter(item => item.enabled !== false);

    if (filteredItems.length === 0) {
        return null;
    }

    return (
        <OptionsSection title={title ?? t("settings.related_settings")}>
            {filteredItems.map((item) => {
                const { targetPage, targetNoteId, onClick } = item;
                return (
                    <OptionsRowLink
                        key={targetPage ?? targetNoteId}
                        label={item.title}
                        description={item.description}
                        href={targetNoteId
                            ? `#root/_hidden/${targetNoteId}`
                            : `#root/_hidden/_options/${targetPage}`}
                        noContainedNavigation={!!targetNoteId || !!onClick}
                        onClick={onClick ?? (targetNoteId
                            ? (e) => {
                                // Hidden-subtree config notes open hoisted, in a tree-sidebar popup.
                                // stopPropagation keeps the global `a` click handler
                                // (link.ts `goToLink`) from navigating by href instead.
                                e.preventDefault();
                                e.stopPropagation();
                                void appContext.triggerCommand("openInTreePopup", { noteIdOrPath: targetNoteId, hoistedNoteId: targetNoteId });
                            }
                            : undefined)}
                    />
                );
            })}
        </OptionsSection>
    );
}

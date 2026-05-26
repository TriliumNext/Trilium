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
    enabled?: boolean;
}

interface RelatedSettingsProps {
    items: RelatedSettingsItem[];
}

export default function RelatedSettings({ items }: RelatedSettingsProps) {
    const filteredItems = items.filter(item => item.enabled !== false);

    if (filteredItems.length === 0) {
        return null;
    }

    return (
        <OptionsSection title={t("settings.related_settings")}>
            {filteredItems.map((item) => {
                const { targetPage, targetNoteId } = item;
                return (
                    <OptionsRowLink
                        key={targetPage ?? targetNoteId}
                        label={item.title}
                        description={item.description}
                        href={targetNoteId
                            ? `#root/_hidden/${targetNoteId}`
                            : `#root/_hidden/_options/${targetPage}`}
                        onClick={targetNoteId
                            ? (e) => {
                                // Hidden-subtree config notes open hoisted, in their own tab.
                                // stopPropagation keeps the global `a` click handler
                                // (link.ts `goToLink`) from navigating by href instead.
                                e.preventDefault();
                                e.stopPropagation();
                                void appContext.tabManager.openInNewTab(targetNoteId, targetNoteId, true);
                            }
                            : undefined}
                    />
                );
            })}
        </OptionsSection>
    );
}

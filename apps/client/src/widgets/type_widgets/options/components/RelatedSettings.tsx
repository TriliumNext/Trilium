import { t } from "../../../../services/i18n";
import type { OptionPages } from "../../ContentWidget";
import { OptionsRowLink } from "./OptionsRow";
import OptionsSection from "./OptionsSection";

interface RelatedSettingsItem {
    title: string;
    description?: string;
    targetPage: OptionPages;
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
            {filteredItems.map((item) => (
                <OptionsRowLink
                    key={item.targetPage}
                    label={item.title}
                    description={item.description}
                    href={`#root/_hidden/_options/${item.targetPage}`}
                />
            ))}
        </OptionsSection>
    );
}

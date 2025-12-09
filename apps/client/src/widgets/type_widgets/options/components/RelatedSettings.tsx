import OptionsSection from "./OptionsSection";
import type { OptionPages } from "../../ContentWidget";
import { t } from "../../../../services/i18n";

interface RelatedSettingsProps {
    items: {
        title: string;
        targetPage: OptionPages;
    }[];
}

export default function RelatedSettings({ items }: RelatedSettingsProps) {
    return (
        <OptionsSection title={t("settings.related_settings")}>
            <nav className="use-tn-links" style={{ padding: 0, margin: 0, listStyleType: "none" }}>
                {items.map(item => (
                    <li>
                        <a href={`#root/_hidden/_options/${item.targetPage}`}>{item.title}</a>
                    </li>
                ))}
            </nav>
        </OptionsSection>
    );
}

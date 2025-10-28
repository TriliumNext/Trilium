import { CSSProperties } from "preact/compat";
import { t } from "../../services/i18n";
import { openInAppHelpFromUrl } from "../../services/utils";

interface HelpButtonProps {
    className?: string;
    helpPage: string;
    title?: string;
    style?: CSSProperties;
}

export default function HelpButton({ className, helpPage, title, style }: HelpButtonProps) {
    return (
        <button
            class={`${className ?? ""} icon-action bx bx-help-circle`}
            type="button"
            onClick={() => openInAppHelpFromUrl(helpPage)}
            title={title ?? t("open-help-page")}
            style={style}
        />
    );
}

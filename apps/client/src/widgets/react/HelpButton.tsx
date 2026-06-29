import { CSSProperties } from "preact/compat";
import { useContext } from "preact/hooks";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import { openInAppHelpFromUrl } from "../../services/utils";
import { NoteContextContext } from "./react_utils";

interface HelpButtonProps {
    className?: string;
    helpPage: string;
    title?: string;
    style?: CSSProperties;
}

export default function HelpButton({ className, helpPage, title, style }: HelpButtonProps) {
    // Inside a modal-hosted note context (e.g. the options dialog) the help split would open
    // hidden behind the dialog, so the help page opens in the quick-edit popup instead.
    const noteContext = useContext(NoteContextContext);
    const isInModal = noteContext?.ntxId?.startsWith("_") ?? false;

    return (
        <button
            class={`${className ?? ""} icon-action bx bx-help-circle`}
            type="button"
            onClick={() => {
                if (isInModal) {
                    void appContext.triggerCommand("openInPopup", { noteIdOrPath: `_help_${helpPage}` });
                } else {
                    void openInAppHelpFromUrl(helpPage);
                }
            }}
            title={title ?? t("open-help-page")}
            style={style}
        />
    );
}

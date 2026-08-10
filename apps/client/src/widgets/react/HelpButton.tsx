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
            onClick={() => openHelpPage(helpPage, isInModal)}
            title={title ?? t("open-help-page")}
            style={style}
        />
    );
}

/**
 * Opens an in-app help page, either as a quick-edit popup over the app or — by default — in a split
 * beside the note being read.
 *
 * The popup is for hosts a split would be lost behind or would shove aside: a modal such as the
 * options dialog, or the right sidebar, whose cards are a glance rather than a place to settle into.
 *
 * @param inAppHelpPage the ID of the help note (excluding the `_help_` prefix).
 * @param inPopup whether to open it as a quick-edit popup rather than a split.
 */
export function openHelpPage(inAppHelpPage: string, inPopup: boolean) {
    if (inPopup) {
        void appContext.triggerCommand("openInPopup", { noteIdOrPath: `_help_${inAppHelpPage}` });
    } else {
        void openInAppHelpFromUrl(inAppHelpPage);
    }
}

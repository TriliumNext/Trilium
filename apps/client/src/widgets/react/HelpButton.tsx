import { CSSProperties } from "preact";
import { useContext } from "preact/hooks";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import { openInAppHelpFromUrl } from "../../services/utils";
import { NoteContextContext, POPUP_EDITOR_NTX_ID } from "./react_utils";

interface HelpButtonProps {
    className?: string;
    helpPage: string;
    title?: string;
    style?: CSSProperties;
}

export default function HelpButton({ className, helpPage, title, style }: HelpButtonProps) {
    const noteContext = useContext(NoteContextContext);

    return (
        <button
            class={`${className ?? ""} icon-action bx bx-help-circle`}
            type="button"
            onClick={() => openHelpPageFor(helpPage, noteContext?.ntxId)}
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

/**
 * Opens an in-app help page where the note context named by `ntxId` can show it: a split beside a
 * tab's note, the quick-edit popup over a modal-hosted context such as the options dialog's, and a
 * nested popup over the quick-edit popup itself, which a split or the popup would hide or replace.
 *
 * @param inAppHelpPage the ID of the help note (excluding the `_help_` prefix).
 */
export function openHelpPageFor(inAppHelpPage: string, ntxId: string | null | undefined) {
    if (ntxId?.startsWith(POPUP_EDITOR_NTX_ID)) {
        void appContext.triggerCommand("openInNestedPopup", { noteIdOrPath: `_help_${inAppHelpPage}` });
    } else {
        openHelpPage(inAppHelpPage, !!ntxId?.startsWith("_"));
    }
}

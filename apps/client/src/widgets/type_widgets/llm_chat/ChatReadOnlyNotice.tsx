import "./ChatReadOnlyNotice.css";

import { t } from "../../../services/i18n.js";

/** Subtle grayed note shown in place of the reply input when a chat is read-only (`#readOnly`). */
export default function ChatReadOnlyNotice() {
    return <p className="llm-chat-read-only-notice">{t("llm_chat.read_only_notice")}</p>;
}

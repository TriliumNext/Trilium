import "./AttributeHelp.css";

import { t } from "../../services/i18n";
import { RawHtmlBlock } from "../react/RawHtml";

/**
 * Quick reference on how to type attributes into the attribute editor. Rendered inside a
 * `HelpDropdown` in the title bar of the status bar's attributes panel.
 */
export default function AttributeHelp() {
    return (
        <div className="attribute-help">
            <RawHtmlBlock html={t("attribute_editor.help_text_body1")} />
            <RawHtmlBlock html={t("attribute_editor.help_text_body2")} />
            <RawHtmlBlock html={t("attribute_editor.help_text_body3")} />
        </div>
    );
}

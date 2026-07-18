import { t } from "../../../services/i18n";
import FormText from "../../react/FormText";
import { useTriliumOptionJson } from "../../react/hooks";
import CheckboxList from "./components/CheckboxList";

/**
 * Lives in its own module (rather than in `text_notes.tsx`) because it is also rendered by the
 * always-loaded highlights list sidebar, while the rest of the text note options pull in heavy
 * dependencies such as highlight.js.
 */
export function HighlightsListOptions() {
    const [ highlightsList, setHighlightsList ] = useTriliumOptionJson<string[]>("highlightsList");

    return (
        <>
            <FormText>{t("highlights_list.description")}</FormText>
            <CheckboxList
                values={[
                    { val: "bold", title: t("highlights_list.bold") },
                    { val: "italic", title: t("highlights_list.italic") },
                    { val: "underline", title: t("highlights_list.underline") },
                    { val: "color", title: t("highlights_list.color") },
                    { val: "bgColor", title: t("highlights_list.bg_color") }
                ]}
                keyProperty="val" titleProperty="title"
                currentValue={highlightsList} onChange={setHighlightsList}
            />
        </>
    );
}

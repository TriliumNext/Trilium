import { t } from "../../../services/i18n";
import FormText from "../../react/FormText";
import { useTriliumOptionJson } from "../../react/hooks";
import CheckboxList from "./components/CheckboxList";

/**
 * Lives in its own module (rather than in `text_notes.tsx`) because the always-loaded highlights list
 * sidebar reads {@link HIGHLIGHT_FORMATS} from here — and used to render this page itself, before it
 * grew a menu of its own — while the rest of the text note options pull in heavy dependencies such as
 * highlight.js.
 */
export function HighlightsListOptions() {
    const [ highlightsList, setHighlightsList ] = useTriliumOptionJson<HighlightFormat[]>("highlightsList");

    return (
        <>
            <FormText>{t("highlights_list.description")}</FormText>
            <CheckboxList
                values={HIGHLIGHT_FORMATS.map(({ val, titleKey }) => ({ val, title: t(titleKey) }))}
                keyProperty="val" titleProperty="title"
                currentValue={highlightsList}
                onChange={(values) => setHighlightsList(values as HighlightFormat[])}
            />
        </>
    );
}

/**
 * The formats that can each be counted as a highlight or left out, in the order they are offered.
 * Shared with the sidebar's highlights list, which offers the same choice from its own gear menu —
 * where each row carries the icon the format is marked with in the formatting toolbar, so the choice
 * is read at a glance rather than word by word.
 *
 * The titles are held as keys rather than resolved here: a module-level `t()` would run before the
 * translations have loaded.
 */
export const HIGHLIGHT_FORMATS = [
    { val: "bold", titleKey: "highlights_list.bold", icon: "bx bx-bold" },
    { val: "italic", titleKey: "highlights_list.italic", icon: "bx bx-italic" },
    { val: "underline", titleKey: "highlights_list.underline", icon: "bx bx-underline" },
    { val: "color", titleKey: "highlights_list.color", icon: "bx bx-font-color" },
    { val: "bgColor", titleKey: "highlights_list.bg_color", icon: "bx bx-highlight" }
] as const;

/** One of the formats the list can be told to count; the option holds a set of these. */
export type HighlightFormat = typeof HIGHLIGHT_FORMATS[number]["val"];

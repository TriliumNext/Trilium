import { useMemo, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import { getAvailableLocales, getLocaleById, t } from "../../services/i18n";
import { resolveContentLanguage } from "../../utils/formatters";
import { useNoteLabel, useTriliumEvent, useTriliumOption } from "../react/hooks.jsx";
import Modal from "../react/Modal";
import { ContentLanguagesList } from "../type_widgets/options/i18n";

/**
 * The content-languages modal, summoned by a command rather than owned by whatever offers it.
 *
 * The status bar's language switcher holds its own copy behind a `useState`. The AI assistant's
 * Translate submenu is built imperatively by CKEditor and the context menu, so it has nowhere to
 * mount a modal; it raises this one with the `showContentLanguagesDialog` command instead.
 */
export default function ContentLanguagesDialog() {
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showContentLanguagesDialog", () => setShown(true));

    return <ContentLanguagesModal modalShown={shown} setModalShown={setShown} />;
}

export function useLanguageSwitcher(note: FNote | null | undefined) {
    const [ languages ] = useTriliumOption("languages");
    // Subscribed to for the re-render alone — the values are read below through
    // `resolveContentLanguage`, which goes to the options store directly. Without these, changing
    // the default in the settings would leave the picker naming a stale language until reopened.
    useTriliumOption("defaultContentLanguage");
    useTriliumOption("locale");

    /**
     * The locale a note without a `#language` of its own is actually written in.
     *
     * Not memoized: it is a lookup over a two-dozen-entry catalog, and `resolveContentLanguage`
     * reads the options directly — so the subscriptions above, not a dependency array, are what
     * make this follow a change to the setting.
     */
    const resolvedDefaultLocale = getLocaleById(resolveContentLanguage(null));

    // Naming the resolved language here is the point: the entry used to read "No language set",
    // which denied the existence of the default that was in fact deciding text direction and
    // quotation marks. The id stays empty — it is the sentinel that clears the label.
    const DEFAULT_LOCALE = {
        id: "",
        name: resolvedDefaultLocale
            ? t("note_language.not_set_with_default", { language: resolvedDefaultLocale.name })
            : t("note_language.not_set")
    };
    const [ currentNoteLanguage, setCurrentNoteLanguage ] = useNoteLabel(note, "language");
    const locales = useMemo(() => {
        const enabledLanguages = JSON.parse(languages ?? "[]") as string[];
        const filteredLanguages = getAvailableLocales().filter((l) => typeof l !== "object" || enabledLanguages.includes(l.id));
        return filteredLanguages;
    }, [ languages ]);

    /**
     * The locale the note is actually written in — its own if it has one, the default otherwise.
     * What the compact displays (the status bar badge, the mobile submenu title) name, so that a
     * note without a `#language` reads as the language in force rather than as a bare dash.
     */
    const effectiveLocale = useMemo(
        () => (currentNoteLanguage ? getLocaleById(currentNoteLanguage) : resolvedDefaultLocale),
        [ currentNoteLanguage, resolvedDefaultLocale ]
    );

    return { locales, DEFAULT_LOCALE, resolvedDefaultLocale, effectiveLocale, currentNoteLanguage, setCurrentNoteLanguage };
}

export function ContentLanguagesModal({ modalShown, setModalShown }: { modalShown: boolean, setModalShown: (shown: boolean) => void }) {
    return (
        <Modal
            className="content-languages-modal"
            title={t("content_language.title")}
            show={modalShown} onHidden={() => setModalShown(false)}
            size="lg" scrollable
        >
            <ContentLanguagesList />
        </Modal>
    );
}

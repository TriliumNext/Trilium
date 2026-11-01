import "./content_languages_card.css";

import { LOCALES } from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useCallback, useMemo } from "preact/hooks";

import dialog from "../../../services/dialog";
import { getAvailableLocales, getEnglishAnnotation, t } from "../../../services/i18n";
import options from "../../../services/options";
import ActionButton from "../../react/ActionButton";
import { Card, CardSection, ItemCreationRow } from "../../react/Card";
import { useTriliumOption } from "../../react/hooks";
import Icon from "../../react/Icon";

const LANGUAGE_ICON = "bx bx-globe";

interface ContentLanguagesCardProps {
    /** Left out in a dialog whose title already names the card. */
    heading?: string;
    actions?: ComponentChildren;
}

/**
 * The languages offered when the language of a text note is chosen, sorted by their native names
 * as `LOCALES` is.
 *
 * In its own module because the content languages dialog renders it too.
 */
export function ContentLanguagesCard({ heading, actions }: ContentLanguagesCardProps) {
    const [ storedLanguages, setStoredLanguages ] = useTriliumOption("languages");
    const languages = useMemo(
        () => readLanguages(),
        [ storedLanguages ]); // eslint-disable-line react-hooks/exhaustive-deps
    const setLanguages = useCallback(
        (ids: string[]) => setStoredLanguages(JSON.stringify(ids)), [ setStoredLanguages ]);

    const enabled = useMemo(() => LOCALES
        .filter((locale) => languages.includes(locale.id))
        .map((locale) => ({
            id: locale.id,
            name: locale.name,
            englishName: getEnglishAnnotation(locale)
        })), [ languages ]);
    const availableCount = LOCALES.length - enabled.length;

    const remove = useCallback((id: string) => {
        setLanguages(languages.filter((candidate) => candidate !== id));
    }, [ languages, setLanguages ]);

    /** Opens the item picker on the languages that are not enabled yet, and adds the one picked. */
    const add = useCallback(async () => {
        const picked = await dialog.pickSingleItem({
            title: t("content_language.add_title"),
            items: getAvailableLocales()
                .filter((locale) => !languages.includes(locale.id))
                .map((locale) => ({ key: locale.id, caption: locale.name, icon: LANGUAGE_ICON }))
        });

        // Read again: another window can change the list while the picker is open.
        const current = readLanguages();
        if (picked && !current.includes(picked.key)) {
            setLanguages([ ...current, picked.key ]);
        }
    }, [ languages, setLanguages ]);

    return (
        <Card
            className="content-languages-card"
            heading={heading}
            actions={actions}
            description={t("content_language.description")}
        >
            {enabled.map((language) => (
                <CardSection key={language.id} className="content-languages-item">
                    <Icon icon={LANGUAGE_ICON} />
                    <span className="content-languages-title">
                        <span className="content-languages-native-name">{language.name}</span>
                        {language.englishName && (
                            <span className="content-languages-english-name">
                                {language.englishName}
                            </span>
                        )}
                    </span>
                    <ActionButton
                        className="content-languages-remove"
                        icon="bx bx-x"
                        text={t("content_language.remove")}
                        onClick={(event) => {
                            if (document.activeElement === event.currentTarget) {
                                focusNearestLanguage(event.currentTarget);
                            }
                            remove(language.id);
                        }}
                    />
                </CardSection>
            ))}

            <ItemCreationRow buttons={[ {
                label: enabled.length
                    ? t("content_language.add_another", { count: availableCount })
                    : t("content_language.add_first", { count: availableCount }),
                icon: "bx bx-plus",
                disabled: !availableCount,
                onClick: add
            } ]} />
        </Card>
    );
}

function readLanguages() {
    return (options.getJson("languages") as string[] | null) ?? [];
}

/**
 * Moves the focus off a remove button whose language is about to go: to the next language's remove
 * button, else the previous one's, else the add button. The rows are keyed, so the one focused here
 * stays in the document when the other is removed.
 */
function focusNearestLanguage(removeButton: HTMLElement) {
    const row = removeButton.closest(".content-languages-item");
    const nearest = [ row?.nextElementSibling, row?.previousElementSibling ]
        .find((sibling) => sibling?.classList.contains("content-languages-item"));
    const target = nearest?.querySelector<HTMLElement>(".content-languages-remove")
        ?? row?.parentElement?.querySelector<HTMLElement>(".tn-card-adder");
    target?.focus();
}

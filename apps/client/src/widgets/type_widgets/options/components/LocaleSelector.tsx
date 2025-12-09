import { Locale } from "@triliumnext/commons";
import Dropdown from "../../../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../../../react/FormList";
import { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";

export function LocaleSelector({ id, locales, currentValue, onChange, defaultLocale, extraChildren }: {
    id?: string;
    locales: Locale[],
    currentValue: string,
    onChange: (newLocale: string) => void,
    defaultLocale?: Locale,
    extraChildren?: ComponentChildren
}) {
    const [ activeLocale, setActiveLocale ] = useState(defaultLocale?.id === currentValue ? defaultLocale : locales.find(l => l.id === currentValue));

    const processedLocales = useMemo(() => {
        const leftToRightLanguages = locales.filter((l) => !l.rtl);
        const rightToLeftLanguages = locales.filter((l) => l.rtl);

        let items: ("---" | Locale)[] = [];
        if (defaultLocale) items.push(defaultLocale);

        if (leftToRightLanguages.length > 0) {
            if (items.length > 0) items.push("---");
            items = [ ...items, ...leftToRightLanguages ];
        }

        if (rightToLeftLanguages.length > 0) {
            items = [
                ...items,
                "---",
                ...rightToLeftLanguages
            ];
        }

        if (extraChildren) {
            items.push("---");
        }
        return items;
    }, [ locales ]);

    return (
        <Dropdown id={id} text={activeLocale?.name}>
            {processedLocales.map(locale => {
                if (typeof locale === "object") {
                    return <FormListItem
                        rtl={locale.rtl}
                        checked={locale.id === currentValue}
                        onClick={() => {
                            setActiveLocale(locale);
                            onChange(locale.id);
                        }}
                    >{locale.name}</FormListItem>
                } else {
                    return <FormDropdownDivider />
                }
            })}
            {extraChildren}
        </Dropdown>
    )
}

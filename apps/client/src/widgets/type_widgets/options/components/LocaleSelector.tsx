import { Locale } from "@triliumnext/commons";
import { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import Dropdown from "../../../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../../../react/FormList";

export function LocaleSelector({ id, locales, currentValue, onChange, defaultLocale, extraChildren }: {
    id?: string;
    locales: Locale[],
    currentValue: string | null | undefined,
    onChange: (newLocale: string) => void,
    defaultLocale?: Locale,
    extraChildren?: ComponentChildren,
}) {
    const currentValueWithDefault = currentValue ?? defaultLocale?.id ?? "";
    const { activeLocale, processedLocales } = useProcessedLocales(locales, defaultLocale, currentValueWithDefault);
    // Deliberately not `portalToBody`, unlike the shorter menus on the other options pages. The card
    // around it is a container and so a backdrop root, which leaves this menu a flat tint rather than
    // frosted. That is the lesser cost: the list runs to every locale Trilium speaks and nothing caps
    // a menu's height, so carried out to the body it would stand in a page that does not scroll, and
    // every locale past the fold would be out of reach.
    return (
        <Dropdown id={id} text={activeLocale?.name} mobileBottomSheet>
            {processedLocales.map((locale, index) => (
                (typeof locale === "object") ? (
                    <FormListItem
                        key={locale.id}
                        rtl={locale.rtl}
                        checked={locale.id === currentValue}
                        onClick={() => {
                            onChange(locale.id);
                        }}
                    >{locale.name}</FormListItem>
                ) : (
                    <FormDropdownDivider key={`divider-${index}`} />
                )
            ))}
            {extraChildren && (
                <>
                    <FormDropdownDivider />
                    {extraChildren}
                </>
            )}
        </Dropdown>
    );
}

export function useProcessedLocales(locales: Locale[], defaultLocale: Locale | undefined, currentValue: string) {
    const activeLocale = defaultLocale?.id === currentValue ? defaultLocale : locales.find(l => l.id === currentValue);

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

        return items;
    }, [ locales, defaultLocale ]);

    return { activeLocale, processedLocales };
}

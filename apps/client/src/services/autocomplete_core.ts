import type { AutocompleteSource, BaseItem } from "@algolia/autocomplete-core";

export function withHeadlessSourceDefaults<TItem extends BaseItem>(
    source: AutocompleteSource<TItem>
): AutocompleteSource<TItem> {
    return {
        getItemUrl() {
            return undefined;
        },
        onActive() {
            // Headless consumers handle highlight side effects themselves.
        },
        ...source
    };
}

import { autocomplete } from "@algolia/autocomplete-js";
import type { AutocompleteApi } from "@algolia/autocomplete-js";
import type { BaseItem } from "@algolia/autocomplete-core";
import type { AttributeType } from "../entities/fattribute.js";
import server from "./server.js";

// ---------------------------------------------------------------------------
// Global instance registry for "close all" functionality
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeInstances = new Set<AutocompleteApi<any>>();

export function closeAllAttributeAutocompletes(): void {
    for (const api of activeInstances) {
        api.setIsOpen(false);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const instanceMap = new WeakMap<HTMLElement, AutocompleteApi<any>>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NameItem extends BaseItem {
    name: string;
}

/** New API: pass a container div, autocomplete-js creates its own input inside. */
interface NewInitOptions {
    container: HTMLElement;
    attributeType?: AttributeType | (() => AttributeType);
    open: boolean;
    onValueChange?: (value: string) => void;
}

/** Old API: pass a jQuery input element, uses legacy autocomplete.js plugin. */
interface OldInitOptions {
    $el: JQuery<HTMLElement>;
    attributeType?: AttributeType | (() => AttributeType);
    open: boolean;
}

type InitAttributeNameOptions = NewInitOptions | OldInitOptions;

function isNewApi(opts: InitAttributeNameOptions): opts is NewInitOptions {
    return "container" in opts;
}

// ---------------------------------------------------------------------------
// Attribute name autocomplete
// ---------------------------------------------------------------------------

function initAttributeNameAutocomplete(opts: InitAttributeNameOptions) {
    if (isNewApi(opts)) {
        initAttributeNameNew(opts);
    } else {
        initAttributeNameLegacy(opts);
    }
}

/** New implementation using @algolia/autocomplete-js */
function initAttributeNameNew({ container, attributeType, open, onValueChange }: NewInitOptions) {
    // Only init once per container
    if (instanceMap.has(container)) {
        if (open) {
            const api = instanceMap.get(container)!;
            api.setIsOpen(true);
            api.refresh();
        }
        return;
    }

    const api = autocomplete<NameItem>({
        container,
        panelContainer: document.body,
        openOnFocus: true,
        detachedMediaQuery: "none",
        placeholder: "",
        classNames: {
            input: "form-control",
        },

        getSources({ query }) {
            return [
                {
                    sourceId: "attribute-names",
                    getItems() {
                        const type = typeof attributeType === "function" ? attributeType() : attributeType;
                        return server
                            .get<string[]>(`attribute-names/?type=${type}&query=${encodeURIComponent(query)}`)
                            .then((names) => names.map((name) => ({ name })));
                    },
                    getItemInputValue({ item }) {
                        return item.name;
                    },
                    onSelect({ item }) {
                        onValueChange?.(item.name);
                    },
                    templates: {
                        item({ item, html }) {
                            return html`<div>${item.name}</div>`;
                        },
                    },
                },
            ];
        },

        onStateChange({ state, prevState }) {
            if (!state.isOpen && prevState.isOpen) {
                onValueChange?.(state.query);
            }
        },

        shouldPanelOpen() {
            return true;
        },
    });

    instanceMap.set(container, api);
    activeInstances.add(api);

    if (open) {
        api.setIsOpen(true);
        api.refresh();
    }
}

/** Legacy implementation using old autocomplete.js jQuery plugin */
function initAttributeNameLegacy({ $el, attributeType, open }: OldInitOptions) {
    if (!$el.hasClass("aa-input")) {
        $el.autocomplete(
            {
                appendTo: document.querySelector("body"),
                hint: false,
                openOnFocus: true,
                minLength: 0,
                tabAutocomplete: false
            },
            [
                {
                    displayKey: "name",
                    cache: false,
                    source: async (term, cb) => {
                        const type = typeof attributeType === "function" ? attributeType() : attributeType;
                        const names = await server.get<string[]>(`attribute-names/?type=${type}&query=${encodeURIComponent(term)}`);
                        const result = names.map((name) => ({ name }));
                        cb(result);
                    }
                }
            ]
        );

        $el.on("autocomplete:opened", () => {
            if ($el.attr("readonly")) {
                $el.autocomplete("close");
            }
        });
    }

    if (open) {
        $el.autocomplete("open");
    }
}

// ---------------------------------------------------------------------------
// Label value autocomplete (still using old autocomplete.js)
// ---------------------------------------------------------------------------

interface LabelValueInitOptions {
    $el: JQuery<HTMLElement>;
    open: boolean;
    nameCallback?: () => string;
}

async function initLabelValueAutocomplete({ $el, open, nameCallback }: LabelValueInitOptions) {
    if ($el.hasClass("aa-input")) {
        $el.autocomplete("destroy");
    }

    let attributeName = "";
    if (nameCallback) {
        attributeName = nameCallback();
    }

    if (attributeName.trim() === "") {
        return;
    }

    const attributeValues = (await server.get<string[]>(`attribute-values/${encodeURIComponent(attributeName)}`)).map((attribute) => ({ value: attribute }));

    if (attributeValues.length === 0) {
        return;
    }

    $el.autocomplete(
        {
            appendTo: document.querySelector("body"),
            hint: false,
            openOnFocus: false,
            minLength: 0,
            tabAutocomplete: false
        },
        [
            {
                displayKey: "value",
                cache: false,
                source: async function (term, cb) {
                    term = term.toLowerCase();
                    const filtered = attributeValues.filter((attr) => attr.value.toLowerCase().includes(term));
                    cb(filtered);
                }
            }
        ]
    );

    $el.on("autocomplete:opened", () => {
        if ($el.attr("readonly")) {
            $el.autocomplete("close");
        }
    });

    if (open) {
        $el.autocomplete("open");
    }
}

// ---------------------------------------------------------------------------
// Utilities for the new autocomplete-js containers
// ---------------------------------------------------------------------------

function getInput(container: HTMLElement): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>(".aa-Input");
}

function setInputValue(container: HTMLElement, value: string): void {
    const input = getInput(container);
    if (input) {
        input.value = value;
    }
    const api = instanceMap.get(container);
    if (api) {
        api.setQuery(value);
    }
}

function getInputValue(container: HTMLElement): string {
    const input = getInput(container);
    return input?.value ?? "";
}

export default {
    initAttributeNameAutocomplete,
    initLabelValueAutocomplete,
    closeAllAttributeAutocompletes,
    getInput,
    setInputValue,
    getInputValue,
};

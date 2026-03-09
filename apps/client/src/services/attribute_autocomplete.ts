import type { AutocompleteApi as CoreAutocompleteApi, BaseItem } from "@algolia/autocomplete-core";
import { createAutocomplete } from "@algolia/autocomplete-core";

import type { AttributeType } from "../entities/fattribute.js";
import server from "./server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NameItem extends BaseItem {
    name: string;
}

interface InitAttributeNameOptions {
    /** The <input> element where the user types */
    $el: JQuery<HTMLElement>;
    attributeType?: AttributeType | (() => AttributeType);
    open: boolean;
    /** Called when the user selects a value or the panel closes */
    onValueChange?: (value: string) => void;
}

// ---------------------------------------------------------------------------
// Instance tracking
// ---------------------------------------------------------------------------

interface ManagedInstance {
    autocomplete: CoreAutocompleteApi<NameItem>;
    panelEl: HTMLElement;
    cleanup: () => void;
}

const instanceMap = new WeakMap<HTMLElement, ManagedInstance>();

// ---------------------------------------------------------------------------
// Dropdown panel DOM helpers
// ---------------------------------------------------------------------------

function createPanelEl(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "aa-core-panel";
    panel.style.display = "none";
    document.body.appendChild(panel);
    return panel;
}

function renderItems(panelEl: HTMLElement, items: NameItem[], activeItemId: number | null, onSelect: (item: NameItem) => void): void {
    panelEl.innerHTML = "";
    if (items.length === 0) {
        panelEl.style.display = "none";
        return;
    }
    const list = document.createElement("ul");
    list.className = "aa-core-list";
    items.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = "aa-core-item";
        if (index === activeItemId) {
            li.classList.add("aa-core-item--active");
        }
        li.textContent = item.name;
        li.addEventListener("mousedown", (e) => {
            e.preventDefault(); // prevent input blur
            onSelect(item);
        });
        list.appendChild(li);
    });
    panelEl.appendChild(list);
}

function positionPanel(panelEl: HTMLElement, inputEl: HTMLElement): void {
    const rect = inputEl.getBoundingClientRect();
    const top = `${rect.bottom}px`;
    const left = `${rect.left}px`;
    const width = `${rect.width}px`;

    panelEl.style.position = "fixed";
    if (panelEl.style.top !== top) panelEl.style.top = top;
    if (panelEl.style.left !== left) panelEl.style.left = left;
    if (panelEl.style.width !== width) panelEl.style.width = width;
    if (panelEl.style.display !== "block") panelEl.style.display = "block";
}

// ---------------------------------------------------------------------------
// Attribute name autocomplete — new (autocomplete-core, headless)
// ---------------------------------------------------------------------------

function initAttributeNameAutocomplete({ $el, attributeType, open, onValueChange }: InitAttributeNameOptions) {
    const inputEl = $el[0] as HTMLInputElement;
    const syncQueryFromInputValue = (autocomplete: CoreAutocompleteApi<NameItem>) => {
        autocomplete.setQuery(inputEl.value || "");
    };

    // Already initialized — just open if requested
    if (instanceMap.has(inputEl)) {
        if (open) {
            const inst = instanceMap.get(inputEl)!;
            syncQueryFromInputValue(inst.autocomplete);
            inst.autocomplete.setIsOpen(true);
            inst.autocomplete.refresh();
        }
        return;
    }

    const panelEl = createPanelEl();

    let isPanelOpen = false;
    let hasActiveItem = false;

    let rafId: number | null = null;
    function startPositioning() {
        if (rafId !== null) return;
        const update = () => {
            positionPanel(panelEl, inputEl);
            rafId = requestAnimationFrame(update);
        };
        update();
    }
    function stopPositioning() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    const autocomplete = createAutocomplete<NameItem>({
        openOnFocus: true,
        defaultActiveItemId: 0,
        shouldPanelOpen() {
            return true;
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
                        inputEl.value = item.name;
                        autocomplete.setQuery(item.name);
                        autocomplete.setIsOpen(false);
                        onValueChange?.(item.name);
                    },
                },
            ];
        },

        onStateChange({ state }) {
            isPanelOpen = state.isOpen;
            hasActiveItem = state.activeItemId !== null;

            // Render items
            const collections = state.collections;
            const items = collections.length > 0 ? (collections[0].items as NameItem[]) : [];
            const activeId = state.activeItemId ?? null;

            if (state.isOpen && items.length > 0) {
                renderItems(panelEl, items, activeId, (item) => {
                    inputEl.value = item.name;
                    autocomplete.setQuery(item.name);
                    autocomplete.setIsOpen(false);
                    onValueChange?.(item.name);
                });
                startPositioning();
            } else {
                panelEl.style.display = "none";
                stopPositioning();
            }

            if (!state.isOpen) {
                panelEl.style.display = "none";
                stopPositioning();
            }
        },
    });

    // Wire up the input events
    const handlers = autocomplete.getInputProps({ inputElement: inputEl });
    const onInput = (e: Event) => {
        handlers.onChange(e as any);
    };
    const onFocus = (e: Event) => {
        syncQueryFromInputValue(autocomplete);
        handlers.onFocus(e as any);
    };
    const onBlur = () => {
        // Delay to allow mousedown on panel items
        setTimeout(() => {
            autocomplete.setIsOpen(false);
            panelEl.style.display = "none";
            stopPositioning();
            onValueChange?.(inputEl.value);
        }, 50);
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && isPanelOpen && hasActiveItem) {
            // Prevent the enter key from propagating to parent dialogs
            // (which might interpret it as "submit" or "save and close")
            e.stopPropagation();
            // We shouldn't preventDefault here because we want handlers.onKeyDown
            // to process it properly. OnSelect will correctly close the panel.
        }
        handlers.onKeyDown(e as any);
    };

    inputEl.addEventListener("input", onInput);
    inputEl.addEventListener("focus", onFocus);
    inputEl.addEventListener("blur", onBlur);
    inputEl.addEventListener("keydown", onKeyDown);

    const cleanup = () => {
        inputEl.removeEventListener("input", onInput);
        inputEl.removeEventListener("focus", onFocus);
        inputEl.removeEventListener("blur", onBlur);
        inputEl.removeEventListener("keydown", onKeyDown);
        stopPositioning();
        if (panelEl.parentElement) {
            panelEl.parentElement.removeChild(panelEl);
        }
    };

    instanceMap.set(inputEl, { autocomplete, panelEl, cleanup });

    if (open) {
        syncQueryFromInputValue(autocomplete);
        autocomplete.setIsOpen(true);
        autocomplete.refresh();
        startPositioning();
    }
}



// ---------------------------------------------------------------------------
// Label value autocomplete (headless autocomplete-core)
// ---------------------------------------------------------------------------

interface LabelValueInitOptions {
    $el: JQuery<HTMLElement>;
    open: boolean;
    nameCallback?: () => string;
    onValueChange?: (value: string) => void;
}

function initLabelValueAutocomplete({ $el, open, nameCallback, onValueChange }: LabelValueInitOptions) {
    const inputEl = $el[0] as HTMLInputElement;
    const syncQueryFromInputValue = (autocomplete: CoreAutocompleteApi<NameItem>) => {
        autocomplete.setQuery(inputEl.value || "");
    };

    if (instanceMap.has(inputEl)) {
        if (open) {
            const inst = instanceMap.get(inputEl)!;
            syncQueryFromInputValue(inst.autocomplete);
            inst.autocomplete.setIsOpen(true);
            inst.autocomplete.refresh();
        }
        return;
    }

    const panelEl = createPanelEl();

    let isPanelOpen = false;
    let hasActiveItem = false;
    let isSelecting = false;

    let rafId: number | null = null;
    function startPositioning() {
        if (rafId !== null) return;
        const update = () => {
            positionPanel(panelEl, inputEl);
            rafId = requestAnimationFrame(update);
        };
        update();
    }
    function stopPositioning() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    let cachedAttributeName = "";
    let cachedAttributeValues: NameItem[] = [];

    const handleSelect = (item: NameItem) => {
        isSelecting = true;
        inputEl.value = item.name;
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        autocomplete.setQuery(item.name);
        autocomplete.setIsOpen(false);
        onValueChange?.(item.name);
        isSelecting = false;

        setTimeout(() => {
            // Preserve the legacy contract: several consumers still commit the
            // selected value from their existing Enter key handlers instead of
            // listening to the autocomplete selection event directly.
            inputEl.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            }));
        }, 0);
    };

    const autocomplete = createAutocomplete<NameItem>({
        openOnFocus: true,
        defaultActiveItemId: null,
        shouldPanelOpen() {
            return true;
        },

        getSources({ query }) {
            return [
                {
                    sourceId: "attribute-values",
                    async getItems() {
                        const attributeName = nameCallback ? nameCallback() : "";
                        if (!attributeName.trim()) {
                            return [];
                        }

                        if (attributeName !== cachedAttributeName || cachedAttributeValues.length === 0) {
                            cachedAttributeName = attributeName;
                            const values = await server.get<string[]>(`attribute-values/${encodeURIComponent(attributeName)}`);
                            cachedAttributeValues = values.map((name) => ({ name }));
                        }

                        const q = query.toLowerCase();
                        return cachedAttributeValues.filter((attr) => attr.name.toLowerCase().includes(q));
                    },
                    getItemInputValue({ item }) {
                        return item.name;
                    },
                    onSelect({ item }) {
                        handleSelect(item);
                    },
                },
            ];
        },

        onStateChange({ state }) {
            isPanelOpen = state.isOpen;
            hasActiveItem = state.activeItemId !== null;

            const collections = state.collections;
            const items = collections.length > 0 ? (collections[0].items as NameItem[]) : [];
            const activeId = state.activeItemId ?? null;

            if (state.isOpen && items.length > 0) {
                renderItems(panelEl, items, activeId, handleSelect);
                startPositioning();
            } else {
                panelEl.style.display = "none";
                stopPositioning();
            }

            if (!state.isOpen) {
                panelEl.style.display = "none";
                stopPositioning();
            }
        },
    });

    const handlers = autocomplete.getInputProps({ inputElement: inputEl });
    const onInput = (e: Event) => {
        if (!isSelecting) {
            handlers.onChange(e as any);
        }
    };
    const onFocus = (e: Event) => {
        const attributeName = nameCallback ? nameCallback() : "";
        if (attributeName !== cachedAttributeName) {
            cachedAttributeName = "";
            cachedAttributeValues = [];
        }
        syncQueryFromInputValue(autocomplete);
        handlers.onFocus(e as any);
    };
    const onBlur = () => {
        setTimeout(() => {
            autocomplete.setIsOpen(false);
            panelEl.style.display = "none";
            stopPositioning();
            onValueChange?.(inputEl.value);
        }, 50);
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && isPanelOpen && hasActiveItem) {
            e.stopPropagation();
        }
        handlers.onKeyDown(e as any);
    };

    inputEl.addEventListener("input", onInput);
    inputEl.addEventListener("focus", onFocus);
    inputEl.addEventListener("blur", onBlur);
    inputEl.addEventListener("keydown", onKeyDown);

    const cleanup = () => {
        inputEl.removeEventListener("input", onInput);
        inputEl.removeEventListener("focus", onFocus);
        inputEl.removeEventListener("blur", onBlur);
        inputEl.removeEventListener("keydown", onKeyDown);
        stopPositioning();
        if (panelEl.parentElement) {
            panelEl.parentElement.removeChild(panelEl);
        }
    };

    instanceMap.set(inputEl, { autocomplete, panelEl, cleanup });

    if (open) {
        syncQueryFromInputValue(autocomplete);
        autocomplete.setIsOpen(true);
        autocomplete.refresh();
        startPositioning();
    }
}

export function destroyAutocomplete($el: JQuery<HTMLElement> | HTMLElement) {
    const inputEl = $el instanceof HTMLElement ? $el : $el[0] as HTMLInputElement;
    const instance = instanceMap.get(inputEl);
    if (instance) {
        instance.cleanup();
        instanceMap.delete(inputEl);
    }
}

export default {
    initAttributeNameAutocomplete,
    destroyAutocomplete,
    initLabelValueAutocomplete,
};

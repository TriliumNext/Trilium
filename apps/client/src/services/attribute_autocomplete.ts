import { createAutocomplete } from "@algolia/autocomplete-core";
import type { AutocompleteApi as CoreAutocompleteApi, BaseItem } from "@algolia/autocomplete-core";
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

    // Already initialized — just open if requested
    if (instanceMap.has(inputEl)) {
        if (open) {
            const inst = instanceMap.get(inputEl)!;
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
        handlers.onFocus(e as any);
    };
    const onBlur = () => {
        // Delay to allow mousedown on panel items
        setTimeout(() => {
            autocomplete.setIsOpen(false);
            panelEl.style.display = "none";
            stopPositioning();
            onValueChange?.(inputEl.value);
        }, 200);
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
    };

    instanceMap.set(inputEl, { autocomplete, panelEl, cleanup });

    if (open) {
        autocomplete.setIsOpen(true);
        autocomplete.refresh();
        startPositioning();
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

export default {
    initAttributeNameAutocomplete,
    initLabelValueAutocomplete,
};

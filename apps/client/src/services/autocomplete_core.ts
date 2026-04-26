// ---------------------------------------------------------------------------
// Lightweight autocomplete state machine — replaces @algolia/autocomplete-core
// ---------------------------------------------------------------------------

// --- Base types (formerly from @algolia/autocomplete-core) ---

/** Minimal item constraint — any plain object qualifies. */
export type BaseItem = Record<string, unknown>;

export interface AutocompleteSource<TItem extends BaseItem> {
    sourceId: string;
    getItems(params: { query: string }): TItem[] | Promise<TItem[]>;
    getItemInputValue?(params: { item: TItem }): string;
    onSelect?(params: { item: TItem }): void;
    getItemUrl?(): string | undefined;
    onActive?(): void;
    onResolve?(): void;
}

export interface AutocompleteCollection<TItem extends BaseItem> {
    source: AutocompleteSource<TItem>;
    items: TItem[];
}

export interface AutocompleteState<TItem extends BaseItem> {
    query: string;
    isOpen: boolean;
    activeItemId: number | null;
    collections: AutocompleteCollection<TItem>[];
}

export interface AutocompleteApi<TItem extends BaseItem> {
    setQuery(query: string): void;
    setIsOpen(isOpen: boolean): void;
    setActiveItemId(id: number | null): void;
    setCollections(collections: AutocompleteCollection<TItem>[]): void;
    refresh(): void;
    getInputProps(opts: { inputElement: HTMLElement }): InputProps;
}

interface InputProps {
    onChange(event: Event): void;
    onFocus(event: Event): void;
    onKeyDown(event: KeyboardEvent): void;
}

interface CreateAutocompleteOptions<TItem extends BaseItem> {
    openOnFocus?: boolean;
    defaultActiveItemId?: number | null;
    shouldPanelOpen?(): boolean;
    getSources(params: { query: string }): AutocompleteSource<TItem>[];
    onStateChange?(params: { state: AutocompleteState<TItem> }): void;
}

// --- createAutocomplete implementation ---

export function createAutocomplete<TItem extends BaseItem>(
    options: CreateAutocompleteOptions<TItem>
): AutocompleteApi<TItem> {
    const {
        openOnFocus = false,
        defaultActiveItemId = null,
        getSources,
        onStateChange,
    } = options;

    const state: AutocompleteState<TItem> = {
        query: "",
        isOpen: false,
        activeItemId: defaultActiveItemId,
        collections: [],
    };

    // Batch flag: when true, suppress notifications until the batch ends.
    let batchDepth = 0;

    function notify() {
        if (batchDepth > 0) {
            return;
        }
        onStateChange?.({ state: { ...state, collections: [...state.collections] } });
    }

    function batch(fn: () => void) {
        batchDepth++;
        try {
            fn();
        } finally {
            batchDepth--;
            if (batchDepth === 0) {
                notify();
            }
        }
    }

    // Request generation counter: incremented by both fetchAndUpdate and
    // setCollections so that late-resolving async fetches don't overwrite
    // newer state (e.g. openRecentNotes resolving after a search query).
    let requestGeneration = 0;

    function getItems(): TItem[] {
        return state.collections.length > 0 ? state.collections[0].items : [];
    }

    function getSource(): AutocompleteSource<TItem> | null {
        return state.collections.length > 0 ? state.collections[0].source : null;
    }

    async function fetchAndUpdate() {
        const generation = ++requestGeneration;
        const sources = getSources({ query: state.query });
        if (sources.length === 0) {
            return;
        }

        const source = sources[0];
        const items = await source.getItems({ query: state.query });

        // Discard stale results if a newer request or setCollections call
        // has been made while we were awaiting.
        if (generation !== requestGeneration) {
            return;
        }

        state.collections = [{ source, items }];
        if (state.activeItemId !== null && state.activeItemId >= items.length) {
            state.activeItemId = items.length > 0 ? items.length - 1 : null;
        }
        notify();
    }

    const api: AutocompleteApi<TItem> = {
        setQuery(query: string) {
            state.query = query;
            // Don't notify — callers control when refresh/notify happens.
        },

        setIsOpen(isOpen: boolean) {
            state.isOpen = isOpen;
            notify();
        },

        setActiveItemId(id: number | null) {
            state.activeItemId = id;
            notify();
        },

        setCollections(collections: AutocompleteCollection<TItem>[]) {
            // Bump generation so any in-flight fetchAndUpdate is discarded.
            requestGeneration++;
            state.collections = collections;
            // Clamp activeItemId
            const items = getItems();
            if (state.activeItemId !== null && state.activeItemId >= items.length) {
                state.activeItemId = items.length > 0 ? items.length - 1 : null;
            }
            notify();
        },

        refresh() {
            void fetchAndUpdate();
        },

        getInputProps(_opts: { inputElement: HTMLElement }): InputProps {
            return {
                onChange(event: Event) {
                    const value = (event.target as HTMLInputElement)?.value ?? "";
                    state.query = value;
                    state.activeItemId = defaultActiveItemId;
                    state.isOpen = true;
                    void fetchAndUpdate();
                },
                onFocus(_event: Event) {
                    if (openOnFocus) {
                        state.isOpen = true;
                        void fetchAndUpdate();
                    }
                },
                onKeyDown(event: KeyboardEvent) {
                    const items = getItems();
                    const source = getSource();

                    switch (event.key) {
                        case "ArrowDown": {
                            event.preventDefault();
                            if (!state.isOpen) {
                                state.isOpen = true;
                                notify();
                                return;
                            }
                            if (items.length === 0) return;

                            batch(() => {
                                if (state.activeItemId === null) {
                                    state.activeItemId = 0;
                                } else if (state.activeItemId < items.length - 1) {
                                    state.activeItemId++;
                                } else {
                                    // Wrap to top
                                    state.activeItemId = 0;
                                }
                            });
                            break;
                        }
                        case "ArrowUp": {
                            event.preventDefault();
                            if (items.length === 0) return;

                            batch(() => {
                                if (state.activeItemId === null) {
                                    state.activeItemId = items.length - 1;
                                } else if (state.activeItemId > 0) {
                                    state.activeItemId--;
                                } else {
                                    // Wrap to bottom
                                    state.activeItemId = items.length - 1;
                                }
                            });
                            break;
                        }
                        case "Enter": {
                            if (state.activeItemId !== null && state.activeItemId < items.length && source) {
                                event.preventDefault();
                                const item = items[state.activeItemId];
                                source.onSelect?.({ item });
                            }
                            break;
                        }
                        case "Escape": {
                            if (state.isOpen) {
                                event.preventDefault();
                                state.isOpen = false;
                                notify();
                            }
                            break;
                        }
                    }
                },
            };
        },
    };

    return api;
}

// ---------------------------------------------------------------------------
// Shared utilities (panel controller, input binding, global close registry)
// ---------------------------------------------------------------------------

export const HEADLESS_AUTOCOMPLETE_PANEL_SELECTOR = ".aa-core-panel";

type HeadlessSourceDefaults = Required<Pick<AutocompleteSource<any>, "getItemUrl" | "onActive" | "onResolve">>;

const headlessAutocompleteClosers = new Set<() => void>();

export function withHeadlessSourceDefaults<TSource extends AutocompleteSource<any>>(
    source: TSource
): TSource & HeadlessSourceDefaults {
    return {
        getItemUrl() {
            return undefined;
        },
        onActive() {
            // Headless consumers handle highlight side effects themselves.
        },
        onResolve() {
            // Headless consumers resolve and render items manually.
        },
        ...source
    } as TSource & HeadlessSourceDefaults;
}

export function registerHeadlessAutocompleteCloser(close: () => void) {
    headlessAutocompleteClosers.add(close);

    return () => {
        headlessAutocompleteClosers.delete(close);
    };
}

export function closeAllHeadlessAutocompletes() {
    for (const close of Array.from(headlessAutocompleteClosers)) {
        close();
    }
}

interface HeadlessPanelControllerOptions {
    inputEl: HTMLElement;
    container?: HTMLElement | null;
    className?: string;
    containedClassName?: string;
}

export function createHeadlessPanelController({
    inputEl,
    container,
    className = "aa-core-panel",
    containedClassName = "aa-core-panel--contained"
}: HeadlessPanelControllerOptions) {
    const panelEl = document.createElement("div");
    panelEl.className = className;

    const isContained = Boolean(container);
    if (isContained) {
        panelEl.classList.add(containedClassName);
        container!.appendChild(panelEl);
    } else {
        document.body.appendChild(panelEl);
    }

    panelEl.style.display = "none";

    let rafId: number | null = null;

    const positionPanel = () => {
        if (isContained) {
            panelEl.style.position = "static";
            panelEl.style.top = "";
            panelEl.style.left = "";
            panelEl.style.width = "100%";
            panelEl.style.display = "block";
            return;
        }

        const rect = inputEl.getBoundingClientRect();
        panelEl.style.position = "fixed";
        panelEl.style.top = `${rect.bottom}px`;
        panelEl.style.left = `${rect.left}px`;
        panelEl.style.width = `${rect.width}px`;
        panelEl.style.display = "block";
    };

    const stopPositioning = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };

    const startPositioning = () => {
        if (isContained) {
            positionPanel();
            return;
        }

        if (rafId !== null) {
            return;
        }

        const update = () => {
            positionPanel();
            rafId = requestAnimationFrame(update);
        };

        update();
    };

    const hide = () => {
        panelEl.style.display = "none";
        stopPositioning();
    };

    const destroy = () => {
        hide();
        panelEl.remove();
    };

    return {
        panelEl,
        hide,
        destroy,
        startPositioning,
        stopPositioning
    };
}

interface InputBinding<TEvent extends Event = Event> {
    type: string;
    listener: (event: TEvent) => void;
}

interface BindAutocompleteInputOptions<TItem extends BaseItem> {
    inputEl: HTMLInputElement;
    autocomplete: AutocompleteApi<TItem>;
    onInput?: (event: Event, handlers: InputProps) => void;
    onFocus?: (event: Event, handlers: InputProps) => void;
    onBlur?: (event: Event, handlers: InputProps) => void;
    onKeyDown?: (event: KeyboardEvent, handlers: InputProps) => void;
    extraBindings?: InputBinding[];
}

export function bindAutocompleteInput<TItem extends BaseItem>({
    inputEl,
    autocomplete,
    onInput,
    onFocus,
    onBlur,
    onKeyDown,
    extraBindings = []
}: BindAutocompleteInputOptions<TItem>) {
    const handlers = autocomplete.getInputProps({ inputElement: inputEl });

    const bindings: InputBinding[] = [
        {
            type: "input",
            listener: (event: Event) => {
                onInput?.(event, handlers);
            }
        },
        {
            type: "focus",
            listener: (event: Event) => {
                onFocus?.(event, handlers);
            }
        },
        {
            type: "blur",
            listener: (event: Event) => {
                onBlur?.(event, handlers);
            }
        },
        {
            type: "keydown",
            listener: (event: Event) => {
                onKeyDown?.(event as KeyboardEvent, handlers);
            }
        },
        ...extraBindings
    ];

    bindings.forEach(({ type, listener }) => {
        inputEl.addEventListener(type, listener as EventListener);
    });

    return () => {
        bindings.forEach(({ type, listener }) => {
            inputEl.removeEventListener(type, listener as EventListener);
        });
    };
}

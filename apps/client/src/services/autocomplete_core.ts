import type { AutocompleteApi, AutocompleteSource, BaseItem } from "@algolia/autocomplete-core";

export const HEADLESS_AUTOCOMPLETE_PANEL_SELECTOR = ".aa-core-panel";

const headlessAutocompleteClosers = new Set<() => void>();

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

type InputHandlers<TItem extends BaseItem> = ReturnType<AutocompleteApi<TItem>["getInputProps"]>;

interface InputBinding<TEvent extends Event = Event> {
    type: string;
    listener: (event: TEvent) => void;
}

interface BindAutocompleteInputOptions<TItem extends BaseItem> {
    inputEl: HTMLInputElement;
    autocomplete: AutocompleteApi<TItem>;
    onInput?: (event: Event, handlers: InputHandlers<TItem>) => void;
    onFocus?: (event: Event, handlers: InputHandlers<TItem>) => void;
    onBlur?: (event: Event, handlers: InputHandlers<TItem>) => void;
    onKeyDown?: (event: KeyboardEvent, handlers: InputHandlers<TItem>) => void;
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
            listener: (event: KeyboardEvent) => {
                onKeyDown?.(event, handlers);
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

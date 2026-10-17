import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** A button that the content of an embed adds to the toolbar of the embed. */
export interface ContentEmbedTool {
    id: string;
    /** The name of what the button does, shown as its tooltip. */
    label: string;
    /** The text of a button without an icon. */
    text?: string;
    /** The SVG of the icon of the button. */
    icon?: string;
    /** Whether a button that toggles is on. A command leaves it out. */
    isOn?: boolean;
    /** `true` when left out. */
    isEnabled?: boolean;
    /** A separator goes between buttons, or items of a menu, of different groups. */
    group?: string;
    /**
     * The keystroke shown beside the label of an item of a menu: CKEditor's notation, such as
     * `Ctrl+F`, or a single character, such as `?`.
     */
    keystroke?: string;
    /** The tools of the menu that the button opens. */
    children?: ContentEmbedTool[];
    /** A class of the button, for the content to style it. */
    class?: string;
}

/** An item of the embed toolbar that the content of an embed can hide. */
export type ContentEmbedToolbarItem =
    "contentEmbedBoxSizeDropdown" | "toggleContentEmbedTitle" | "convertEmbedToLink";

/** The buttons that the content of an embed, such as a canvas drawing, adds to its toolbar. */
export interface ContentEmbedToolProvider {
    getTools(): ContentEmbedTool[];
    execute(id: string): void;
    /** Calls `callback` when `getTools()` changes, until the returned function is called. */
    subscribe(callback: () => void): () => void;
    /** The items of the embed toolbar to hide. The menu of the embed still offers them. */
    hiddenToolbarItems?: readonly ContentEmbedToolbarItem[];
    /**
     * Whether the content has an editable mode, which the toolbar and the menu of the embed then
     * turn on and off. The embed carries `data-editable="true"` while it is on.
     */
    hasEditableFlag?: boolean;
    /**
     * Whether the content shows its source, its rendering or both, which the toolbar and the menu
     * of the embed then switch. The embed carries the mode as `data-display-mode`.
     */
    hasDisplayModes?: boolean;
}

/**
 * What an embed tells its content, with an event that bubbles from its content box:
 * `fullscreenChangeStart` as it enters or leaves fullscreen, then `enterFullscreen` or
 * `leaveFullscreen` once it has the new size.
 */
export type ContentEmbedEvent = "fullscreenChangeStart" | "enterFullscreen" | "leaveFullscreen";

const providers = new Map<HTMLElement, ContentEmbedToolProvider>();
const watchers = new Set<{ container: HTMLElement; callback: () => void }>();

/**
 * Adds the buttons of `provider` to the toolbar of the embed that contains `element`, until the
 * returned function is called.
 */
export function registerContentEmbedTools(
    element: HTMLElement,
    provider: ContentEmbedToolProvider
) {
    providers.set(element, provider);
    // Content rendered apart, such as inline source, reaches its watchers once in the page.
    const stopWaiting = whenInPage(element, () => notifyWatchers(element));
    return () => {
        stopWaiting();
        providers.delete(element);
        notifyWatchers(element);
    };
}

/**
 * Calls `callback` when content inside `container` adds or removes its buttons, as a canvas
 * drawing adds them once it renders after its embed was selected. Stops when the returned function
 * is called.
 */
export function watchContentEmbedTools(container: HTMLElement, callback: () => void) {
    const watcher = { container, callback };
    watchers.add(watcher);
    return () => {
        watchers.delete(watcher);
    };
}

/** The buttons that the content of `embed` adds to its toolbar, or `null`. */
export function getContentEmbedTools(embed: HTMLElement) {
    for (const [ element, provider ] of providers) {
        if (embed.contains(element)) {
            return provider;
        }
    }
    return null;
}

function notifyWatchers(element: HTMLElement) {
    for (const { container, callback } of watchers) {
        if (container.contains(element)) {
            callback();
        }
    }
}

/** Shows the content box of the embed that contains `element` in fullscreen. */
export function showContentEmbedFullscreen(element: Element | null) {
    element?.closest(".include-note-content")?.requestFullscreen().catch((error: unknown) => {
        console.warn("Could not show the embed in fullscreen:", error);
    });
}

/**
 * Whether `embed` can go fullscreen while it has no title row, which holds a button for it: a
 * Medium or Full box with its title hidden. Its content then offers the button.
 */
export function needsFullscreenButton(embed: HTMLElement | null | undefined) {
    const { hideTitle, boxSize } = embed?.dataset ?? {};
    return hideTitle === "true" && (boxSize === "medium" || boxSize === "full");
}

/**
 * {@link needsFullscreenButton} for the embed that contains `ref`. `false` until the content is
 * in the page.
 */
export function useNeedsFullscreenButton(ref: RefObject<HTMLElement | null>) {
    return useEmbedState(ref, {
        initial: false,
        outsideEmbed: false,
        attributes: [ "data-hide-title", "data-box-size" ],
        read: needsFullscreenButton
    });
}

/**
 * Whether the Editable toggle of the embed that contains `ref` is on, for content whose provider
 * sets `hasEditableFlag`. Content outside an embed has no toggle, and is editable. `false` until
 * the content is in the page.
 */
export function useIsContentEmbedEditable(ref: RefObject<HTMLElement | null>) {
    return useEmbedState(ref, {
        initial: false,
        outsideEmbed: true,
        attributes: [ "data-editable" ],
        read: (embed) => embed.dataset.editable === "true"
    });
}

/**
 * The display mode picked for the embed that contains `ref`, for content whose provider sets
 * `hasDisplayModes`. `null` while none is picked, outside an embed, and until the content is in the
 * page: `resolveDisplayMode()` then tells what to show.
 */
export function useContentEmbedDisplayMode(ref: RefObject<HTMLElement | null>) {
    return useEmbedState<string | null>(ref, {
        initial: null,
        outsideEmbed: null,
        attributes: [ "data-display-mode" ],
        read: (embed) => embed.dataset.displayMode ?? null
    });
}

interface EmbedStateOptions<T> {
    /** The value until the content is in the page. */
    initial: T;
    /** The value for content in the page but outside an embed. */
    outsideEmbed: T;
    /** The attributes of the embed that `read` depends on. */
    attributes: string[];
    read: (embed: HTMLElement) => T;
}

/**
 * What `read` tells of the embed that contains `ref`, again whenever one of `attributes` changes.
 * Content rendered apart, such as inline source, finds its embed once it joins the page.
 */
function useEmbedState<T>(
    ref: RefObject<HTMLElement | null>,
    { initial, outsideEmbed, attributes, read }: EmbedStateOptions<T>
) {
    const [ value, setValue ] = useState(initial);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            setValue(outsideEmbed);
            return;
        }

        let attributeObserver: MutationObserver | undefined;
        const watch = () => {
            const embed = element.closest<HTMLElement>(".include-note");
            if (!embed) {
                setValue(outsideEmbed);
                return;
            }

            const update = () => setValue(read(embed));
            attributeObserver = new MutationObserver(update);
            attributeObserver.observe(embed, { attributes: true, attributeFilter: attributes });
            update();
        };

        const stopWaiting = whenInPage(element, watch);
        return () => {
            stopWaiting();
            attributeObserver?.disconnect();
        };
    }, [ ref ]);

    return value;
}


/**
 * Calls `callback` when the embed that contains `ref` dispatches `name`. Listens on the document,
 * as content can mount before its embed box takes it in.
 */
export function useContentEmbedEvent(
    ref: RefObject<HTMLElement | null>,
    name: ContentEmbedEvent,
    callback: () => void
) {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        const listener = (event: Event) => {
            const element = ref.current;
            if (element && event.target instanceof Node && event.target.contains(element)) {
                callbackRef.current();
            }
        };
        document.addEventListener(name, listener);
        return () => document.removeEventListener(name, listener);
    }, [ ref, name ]);
}

/**
 * Calls `callback` once `element` is in the page: at once, or when it joins it. Stops waiting
 * when the returned function is called.
 */
function whenInPage(element: HTMLElement, callback: () => void) {
    if (element.isConnected) {
        callback();
        return () => {};
    }

    const observer = new MutationObserver(() => {
        if (!element.isConnected) return;
        observer.disconnect();
        callback();
    });
    observer.observe(document, { childList: true, subtree: true });
    return () => observer.disconnect();
}

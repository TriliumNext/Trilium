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
    /** A separator goes between buttons of different groups. */
    group?: string;
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
    for (const { container, callback } of watchers) {
        if (container.contains(element)) {
            callback();
        }
    }
    return () => {
        providers.delete(element);
    };
}

/**
 * Calls `callback` when content inside `container` adds its buttons, as a canvas drawing does
 * once it renders after its embed was selected. Stops when the returned function is called.
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

/** Shows the content box of the embed that contains `element` in fullscreen. */
export function showContentEmbedFullscreen(element: Element | null) {
    element?.closest(".include-note-content")?.requestFullscreen().catch((error: unknown) => {
        console.warn("Could not show the embed in fullscreen:", error);
    });
}

/**
 * Whether the Editable toggle of the embed that contains `ref` is on, for content whose provider
 * sets `hasEditableFlag`. Content outside an embed has no toggle, and is editable. `false` until
 * the content is in the page.
 */
export function useIsContentEmbedEditable(ref: RefObject<HTMLElement>) {
    const [ isEditable, setIsEditable ] = useState(false);

    useEffect(() => {
        const embed = ref.current?.closest<HTMLElement>(".include-note");
        if (!embed) {
            setIsEditable(true);
            return;
        }

        const update = () => setIsEditable(embed.dataset.editable === "true");
        const observer = new MutationObserver(update);
        observer.observe(embed, { attributes: true, attributeFilter: [ "data-editable" ] });
        update();
        return () => observer.disconnect();
    }, [ ref ]);

    return isEditable;
}

/**
 * Calls `callback` when the embed that contains `ref` dispatches `name`. Listens on the document,
 * as content can mount before its embed box takes it in.
 */
export function useContentEmbedEvent(
    ref: RefObject<HTMLElement>,
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

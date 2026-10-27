import type { EmbedEdge } from "@triliumnext/ckeditor5";
import type { RefObject } from "preact";
import { flushSync } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import type { CommandNames } from "../../../components/app_context";
import type { MenuItem } from "../../../menus/context_menu";
import type { FindTarget } from "../../merged_find";

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
    /**
     * Whether the button opens a menu that the content draws, with
     * `ContentEmbedToolProvider.openMenu()`, instead of running the tool.
     */
    opensMenu?: boolean;
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
    /** Opens the menu of the tool `id`, which sets `opensMenu`, below `anchor`. */
    openMenu?(id: string, anchor: HTMLElement): void;
    /** Calls `callback` when `getTools()` changes, until the returned function is called. */
    subscribe(callback: () => void): () => void;
    /** The items that the content adds to the menu of the embed, after Editable. */
    getMenuItems?(): MenuItem<CommandNames>[];
    /** The items of the embed toolbar to hide. The menu of the embed still offers them. */
    hiddenToolbarItems?: readonly ContentEmbedToolbarItem[];
    /**
     * An SVG icon that the box size dropdown of the embed toolbar shows in place of the name of the
     * box size, which its tooltip then names.
     */
    boxSizeIcon?: string;
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

/** The editor in an embed, as the caret of the text editor around the embed enters it. */
export interface EmbedCaretTarget {
    /** Focuses the editor with the caret at `edge` of its content, and returns whether it did. */
    enter(edge: EmbedEdge): boolean;
}

const providers = new Map<HTMLElement, ContentEmbedToolProvider>();
const watchers = new Set<{ container: HTMLElement; callback: () => void }>();
const caretTargets = new Map<HTMLElement, EmbedCaretTarget>();
const findTargets = new Map<HTMLElement, FindTarget>();
const findWatchers = new Set<{ container: HTMLElement; callback: () => void }>();

/** The event that `revealContentEmbed()` dispatches on the content box of an embed. */
const FIND_REVEAL_EVENT = "contentEmbedFindReveal";

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
export function getContentEmbedTools(embed: Element) {
    for (const [ element, provider ] of providers) {
        if (embed.contains(element)) {
            return provider;
        }
    }
    return null;
}

/**
 * Lets the caret of the text editor around the embed that contains `element` enter `target`, until
 * the returned function is called.
 */
export function registerEmbedCaretTarget(element: HTMLElement, target: EmbedCaretTarget) {
    caretTargets.set(element, target);
    return () => {
        caretTargets.delete(element);
    };
}

/**
 * Focuses the editor that `embed` shows, with the caret at `edge` of its content. Returns `false`
 * when `embed` shows no editor that takes the caret.
 */
export function enterContentEmbed(embed: HTMLElement, edge: EmbedEdge) {
    for (const [ element, target ] of caretTargets) {
        if (embed.contains(element)) {
            return target.enter(edge);
        }
    }
    return false;
}

/**
 * Lets "Search in note" search the content of the embed that contains `element` with `target`,
 * until the returned function is called. Of the targets in one embed, the innermost one searches
 * it, as the editor of an included note does rather than the preview around it.
 */
export function registerEmbedFindTarget(element: HTMLElement, target: FindTarget) {
    findTargets.set(element, target);
    notifyFindWatchers(element);
    const stopWatching = target.watchContent?.(() => notifyFindWatchers(element));
    return () => {
        stopWatching?.();
        findTargets.delete(element);
        notifyFindWatchers(element);
    };
}

/** The target that searches the content of `embed`, or `null` for content that is not searched. */
export function getEmbedFindTarget(embed: HTMLElement) {
    let found: [ HTMLElement, FindTarget ] | null = null;
    for (const entry of findTargets) {
        const [ element ] = entry;
        if (element.closest(".include-note") === embed && (!found || found[0].contains(element))) {
            found = entry;
        }
    }
    return found?.[1] ?? null;
}

/**
 * Calls `callback` when the targets that search the embeds inside `container` change, as when the
 * editor of an included note replaces its preview, or when the content they search changes.
 * Stops when the returned function is called.
 */
export function watchEmbedFindTargets(container: HTMLElement, callback: () => void) {
    const watcher = { container, callback };
    findWatchers.add(watcher);
    return () => {
        findWatchers.delete(watcher);
    };
}

/**
 * Shows the content of `embed` while a match of "Search in note" in it is the current one, as a
 * collapsed Expandable embed hides its content. `false` hides it again.
 */
export function revealContentEmbed(embed: HTMLElement, isRevealed: boolean) {
    const box = [ ...embed.querySelectorAll(".include-note-content") ]
        .find((element) => element.closest(".include-note") === embed);
    box?.dispatchEvent(new CustomEvent(FIND_REVEAL_EVENT, { detail: isRevealed }));
}

/**
 * Whether "Search in note" shows the content box in `contentRef`, for a match in it, and the
 * setter that stops showing it, as the user collapsing the embed does.
 */
export function useContentEmbedFindReveal(contentRef: RefObject<HTMLElement | null>) {
    const [ isRevealed, setIsRevealed ] = useState(false);

    useEffect(() => {
        const box = contentRef.current;
        if (!box) return;

        const onReveal = (event: Event) => {
            // The find scrolls to the match right after, which must show by then.
            flushSync(() => setIsRevealed(event instanceof CustomEvent && event.detail === true));
        };
        box.addEventListener(FIND_REVEAL_EVENT, onReveal);
        return () => box.removeEventListener(FIND_REVEAL_EVENT, onReveal);
    }, [ contentRef ]);

    return [ isRevealed, setIsRevealed ] as const;
}

function notifyFindWatchers(element: HTMLElement) {
    for (const { container, callback } of findWatchers) {
        // An element that left the page can have been in any container.
        if (!element.isConnected || container.contains(element)) {
            callback();
        }
    }
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
 * The attribute `name` of the embed that contains `ref`, which follows its changes. `initial` until
 * the content is in the embed, as content mounts before its embed box takes it in.
 */
export function useContentEmbedAttribute(
    ref: RefObject<HTMLElement | null>,
    name: string,
    initial: string | null = null
) {
    return useEmbedState(ref, {
        initial,
        outsideEmbed: initial,
        attributes: [ name ],
        read: (embed) => embed.getAttribute(name)
    });
}

/** The `"true"` or `"false"` attribute `name` of `embed`, or `undefined` while it is unset. */
export function getContentEmbedFlag(embed: Element | null | undefined, name: string) {
    const value = embed?.getAttribute(name);
    return value == null ? undefined : value !== "false";
}

/**
 * {@link getContentEmbedFlag} for the embed that contains `ref`, which follows its changes.
 * `initial` until the content is in the embed.
 */
export function useContentEmbedFlag(
    ref: RefObject<HTMLElement | null>,
    name: string,
    initial?: boolean
) {
    return useEmbedState(ref, {
        initial,
        outsideEmbed: initial,
        attributes: [ name ],
        read: (embed) => getContentEmbedFlag(embed, name)
    });
}

/**
 * The display mode picked for the embed that contains `ref`, for content whose provider sets
 * `hasDisplayModes`. `null` while none is picked, outside an embed, and until the content is in the
 * embed: `resolveDisplayMode()` then tells what to show.
 */
export function useContentEmbedDisplayMode(ref: RefObject<HTMLElement | null>) {
    return useContentEmbedAttribute(ref, "data-display-mode");
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

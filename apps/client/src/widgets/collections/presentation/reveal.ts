import { useEffect, useState } from "preact/hooks";
import type { RevealApi } from "reveal.js";

/** Returns the note ID of the slide that Reveal.js shows. */
export function useActiveSlideNoteId(api: RevealApi | undefined) {
    const [ activeNoteId, setActiveNoteId ] = useState<string>();
    useEffect(() => {
        if (!api) return;
        const update = () => setActiveNoteId(getNoteIdFromSlide(api.getCurrentSlide()));
        update();
        api.on("slidechanged", update);
        return () => api.off("slidechanged", update);
    }, [ api ]);
    return activeNoteId;
}

/**
 * Whether a key press goes to a field being typed in: the slide editor, or an input of a collection slide.
 * Reveal.js checks `document.activeElement` for that, which is the shadow host rather than the field.
 */
export function isTypingIn(event: Event) {
    const target = event.composedPath()[0];
    return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

/**
 * Whether a key press activates a focused button, such as a thumbnail in the sidebar. Reveal.js listens
 * to the whole document, so it would otherwise also move to the next slide on the same Space.
 */
export function isPressingButton(event: KeyboardEvent) {
    const target = event.composedPath()[0];
    return (event.key === " " || event.key === "Enter")
        && target instanceof Element && target.closest("button") !== null;
}

/**
 * Whether a key press is meant for the presentation in `view`: pressed inside it or on an element that holds
 * it, such as a dialog, or with nothing focused while its note context is the active one. Reveal.js listens
 * to the whole document, so every open presentation, in another split or tab, would otherwise take the key.
 */
export function isKeyForPresentation(event: KeyboardEvent, view: Element, isContextActive: boolean) {
    const path = event.composedPath();
    if (path.includes(view)) return true;
    const target = path[0];
    if (target === document.body) return isContextActive;
    return target instanceof Element && target.contains(view);
}

export function getNoteIdFromSlide(slide: HTMLElement | undefined) {
    if (!slide) return;
    return slide.dataset.noteId;
}

const FRAME_SELECTOR = "iframe, webview";

/**
 * Takes the keyboard back whenever an iframe or `<webview>` in the slides gets focus, from a click or from
 * the page focusing itself, so that Space and the arrow keys keep moving between slides. Clicks, links and
 * wheel scrolling still reach the page. Chromium reports focus entering a frame as `focusin` on its
 * element; Firefox only blurs the window, so the frame is then found as the active element.
 */
export function keepKeyboardInPresentation(container: HTMLElement) {
    const returnFocus = (frame: HTMLElement) => {
        frame.blur();
        window.focus();
    };
    const onFocusIn = (e: Event) => {
        if (e.target instanceof HTMLElement && e.target.matches(FRAME_SELECTOR)) returnFocus(e.target);
    };
    const onWindowBlur = () => {
        // The frame becomes the active element only after the window's `blur` is dispatched.
        setTimeout(() => {
            const active = (container.getRootNode() as Document | ShadowRoot).activeElement;
            if (active instanceof HTMLElement && active.matches(FRAME_SELECTOR) && container.contains(active)) {
                returnFocus(active);
            }
        });
    };

    container.addEventListener("focusin", onFocusIn);
    window.addEventListener("blur", onWindowBlur);
    return () => {
        container.removeEventListener("focusin", onFocusIn);
        window.removeEventListener("blur", onWindowBlur);
    };
}

/**
 * Moves to the slide that a clicked link in `container` points at, including the links of content
 * rendered after this starts. Returns the function that stops it.
 *
 * Reveal.js navigates by slide ID on its own, but looks the slide up with
 * `document.getElementById()`, which does not find it inside the shadow root.
 */
export function followSlideLinks(container: HTMLElement, api: RevealApi) {
    const onClick = (e: MouseEvent) => {
        const link = e.target instanceof Element
            ? e.target.closest<HTMLAnchorElement>("a.reference-link")
            : null;
        if (!link) return;
        const url = new URL(link.href);
        if (!url.hash.startsWith("#/slide-")) return;
        goToSlide(api, url.hash.substring(8));
    };

    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
}

/**
 * Shows the slide of the note `noteId` again after the slides were reordered, as Reveal.js keeps the
 * position of the slide it showed rather than the slide, and points Reveal.js at the slide's section
 * when a change of level built it anew.
 */
export function keepSlideShown(api: RevealApi, noteId: string) {
    const slide = api.getRevealElement()?.querySelector<HTMLElement>(`#slide-${noteId}`);
    if (!slide) return;
    const { h, v } = api.getIndices(slide);
    const current = api.getIndices();
    // `sync()` does not update the current slide that `getCurrentSlide()` returns, but `slide()` does.
    if (h !== current.h || v !== current.v || api.getCurrentSlide() !== slide) api.slide(h, v);
}

/**
 * Moves to the slide of the note `noteId`, if it is a slide. The slide is looked up in the
 * `.reveal` element, as `document.getElementById()` does not reach into the shadow root.
 */
export function goToSlide(api: RevealApi, noteId: string) {
    const slide = api.getRevealElement()?.querySelector<HTMLElement>(`#slide-${noteId}`);
    if (!slide) return;

    const { h, v, f } = api.getIndices(slide);
    api.slide(h, v, f);
}

import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { RevealApi } from "reveal.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    followSlideLinks, goToSlide, isKeyForPresentation, isPressingButton, keepKeyboardInPresentation, keepSlideShown,
    type PresentationConfig, useRememberedSlide
} from "./reveal";

describe("keepKeyboardInPresentation", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it("takes focus back from a frame that is clicked, as Chromium and Firefox report it", () => {
        vi.useFakeTimers();
        for (const tag of [ "iframe", "webview" ]) {
            // Chromium: focus entering the frame is a `focusin` on its element.
            const clicked = buildFrame(tag);
            clicked.frame.focus();
            expect(document.activeElement, tag).not.toBe(clicked.frame);

            // Firefox: only the window blurs, and the frame is the active element just after.
            const firefox = buildFrame(tag);
            firefox.container.addEventListener("focusin", stopFocusIn, true);
            firefox.frame.focus();
            expect(document.activeElement, tag).toBe(firefox.frame);
            window.dispatchEvent(new Event("blur"));
            vi.runAllTimers();
            expect(document.activeElement, tag).not.toBe(firefox.frame);
            firefox.container.removeEventListener("focusin", stopFocusIn, true);
        }

        // A frame outside the presentation keeps its focus.
        const outside = document.createElement("iframe");
        document.body.append(outside);
        outside.focus();
        window.dispatchEvent(new Event("blur"));
        vi.runAllTimers();
        expect(document.activeElement).toBe(outside);
    });
});

/** Keeps a `focusin` from reaching the guard, as Firefox does not dispatch one for a click into a frame. */
function stopFocusIn(e: Event) {
    e.stopPropagation();
}

/** Mounts a frame in the light DOM: happy-dom does not match `:focus` inside a shadow root. */
function buildFrame(tag: string) {
    const container = document.createElement("div");
    document.body.append(container);
    keepKeyboardInPresentation(container);
    const frame = document.createElement(tag);
    frame.tabIndex = 0;
    container.append(frame);
    return { container, frame };
}

describe("followSlideLinks", () => {
    it("moves to the slide a link points at, for links added after it starts", () => {
        const container = document.createElement("div");
        const target = document.createElement("section");
        target.id = "slide-target";
        container.append(target);
        const api = {
            getRevealElement: () => container,
            getIndices: vi.fn(() => ({ h: 2, v: 1, f: undefined })),
            slide: vi.fn()
        };
        const stop = followSlideLinks(container, api as unknown as RevealApi);

        const link = document.createElement("a");
        link.className = "reference-link";
        link.href = "#/slide-target";
        const label = document.createElement("span");
        link.append(label);
        container.append(link);
        label.click();
        expect(api.getIndices).toHaveBeenCalledWith(target);
        expect(api.slide).toHaveBeenCalledWith(2, 1, undefined);

        // A link to a note that is not a slide, or a link after stopping, does not move.
        api.slide.mockClear();
        link.href = "#/slide-missing";
        link.click();
        link.href = "#/slide-target";
        stop();
        link.click();
        expect(api.slide).not.toHaveBeenCalled();
    });
});

describe("goToSlide", () => {
    it("moves to the slide of a note, and does nothing for a note that is not a slide", () => {
        const container = document.createElement("div");
        const target = document.createElement("section");
        target.id = "slide-target";
        container.append(target);
        const api = {
            getRevealElement: () => container,
            getIndices: vi.fn(() => ({ h: 3, v: 2, f: undefined })),
            slide: vi.fn()
        };

        goToSlide(api as unknown as RevealApi, "target");
        expect(api.getIndices).toHaveBeenCalledWith(target);
        expect(api.slide).toHaveBeenCalledWith(3, 2, undefined);

        api.slide.mockClear();
        goToSlide(api as unknown as RevealApi, "missing");
        expect(api.slide).not.toHaveBeenCalled();
    });
});

describe("isPressingButton", () => {
    it("leaves Space and Enter on a focused button to the button, and every other key to Reveal.js", () => {
        const button = document.createElement("button");
        const icon = document.createElement("span");
        button.append(icon);
        const field = document.createElement("div");
        document.body.append(button, field);
        const press = (target: HTMLElement, key: string) => {
            let pressing: boolean | undefined;
            const listener = (e: Event) => { pressing = isPressingButton(e as KeyboardEvent); };
            document.addEventListener("keydown", listener);
            target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
            document.removeEventListener("keydown", listener);
            return pressing;
        };

        expect(press(button, " ")).toBe(true);
        expect(press(icon, "Enter")).toBe(true);
        expect(press(button, "ArrowRight")).toBe(false);
        expect(press(field, " ")).toBe(false);
        document.body.replaceChildren();
    });
});

describe("isKeyForPresentation", () => {
    it("takes keys pressed in the view, or with nothing focused while its note context is active", () => {
        const view = document.createElement("div");
        const thumbnail = document.createElement("button");
        view.append(thumbnail);
        const modal = document.createElement("div");
        modal.tabIndex = -1;
        modal.append(view);
        const tree = document.createElement("div");
        tree.tabIndex = -1;
        document.body.append(modal, tree);
        const press = (target: HTMLElement, isContextActive: boolean) => {
            let isForPresentation: boolean | undefined;
            const listener = (e: Event) => {
                isForPresentation = isKeyForPresentation(e as KeyboardEvent, view, isContextActive);
            };
            document.addEventListener("keydown", listener);
            target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));
            document.removeEventListener("keydown", listener);
            return isForPresentation;
        };

        expect(press(thumbnail, false)).toBe(true);
        expect(press(modal, false)).toBe(true);
        expect(press(document.body, true)).toBe(true);
        expect(press(document.body, false)).toBe(false);
        expect(press(tree, true)).toBe(false);
        document.body.replaceChildren();
    });
});

describe("keepSlideShown", () => {
    it("goes back to the slide of a note that moved, and stays put otherwise", () => {
        const container = document.createElement("div");
        const moved = document.createElement("section");
        moved.id = "slide-moved";
        container.append(moved);
        let current = { h: 0, v: 0 };
        let currentSlide: HTMLElement = document.createElement("section");
        const api = {
            getRevealElement: () => container,
            getCurrentSlide: () => currentSlide,
            getIndices: vi.fn((slide?: HTMLElement) => slide ? { h: 2, v: 1 } : current),
            slide: vi.fn()
        };

        keepSlideShown(api as unknown as RevealApi, "moved");
        expect(api.slide).toHaveBeenCalledExactlyOnceWith(2, 1);

        // Already shown where it is, or no longer a slide.
        api.slide.mockClear();
        current = { h: 2, v: 1 };
        currentSlide = moved;
        keepSlideShown(api as unknown as RevealApi, "moved");
        keepSlideShown(api as unknown as RevealApi, "gone");
        expect(api.slide).not.toHaveBeenCalled();

        // At the same position, but in a section built anew for a change of level.
        currentSlide = document.createElement("section");
        keepSlideShown(api as unknown as RevealApi, "moved");
        expect(api.slide).toHaveBeenCalledExactlyOnceWith(2, 1);
    });
});

describe("useRememberedSlide", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it("goes back to the remembered slide, and remembers the slide shown a few seconds after it changes", async () => {
        vi.useFakeTimers();
        const slides = document.createElement("div");
        for (const noteId of [ "first", "remembered", "next" ]) {
            const section = document.createElement("section");
            section.id = `slide-${noteId}`;
            slides.append(section);
        }
        const api = {
            getRevealElement: () => slides,
            getIndices: (slide: HTMLElement) => ({ h: [ ...slides.children ].indexOf(slide), v: 0, f: undefined }),
            slide: vi.fn()
        } as unknown as RevealApi;
        let viewConfig: PresentationConfig | undefined = { currentSlideNoteId: "remembered" };
        const saveConfig = vi.fn((config: PresentationConfig) => { viewConfig = config; });
        const Probe = ({ activeNoteId }: { activeNoteId: string }) => {
            useRememberedSlide(api, activeNoteId, viewConfig, saveConfig);
            return null;
        };
        const container = document.createElement("div");
        document.body.append(container);
        const show = (activeNoteId: string) => act(() => render(h(Probe, { activeNoteId }), container));

        // Reveal.js reports the first slide before it goes to the remembered one.
        show("first");
        expect(api.slide).toHaveBeenCalledExactlyOnceWith(1, 0, undefined);
        show("remembered");
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(saveConfig).not.toHaveBeenCalled();

        show("next");
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(saveConfig).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(saveConfig).toHaveBeenCalledExactlyOnceWith({ currentSlideNoteId: "next" });

        // A change still waiting is saved when the presentation closes.
        saveConfig.mockClear();
        show("first");
        await act(async () => render(null, container));
        expect(saveConfig).toHaveBeenCalledExactlyOnceWith({ currentSlideNoteId: "first" });
    });

    it("remembers nothing without `saveConfig`", async () => {
        vi.useFakeTimers();
        const api = { getRevealElement: () => document.createElement("div") } as unknown as RevealApi;
        const Probe = ({ activeNoteId }: { activeNoteId: string }) => {
            useRememberedSlide(api, activeNoteId, undefined, undefined);
            return null;
        };
        const container = document.createElement("div");
        expect(() => {
            act(() => render(h(Probe, { activeNoteId: "a" }), container));
            act(() => render(h(Probe, { activeNoteId: "b" }), container));
            act(() => render(null, container));
        }).not.toThrow();
    });
});

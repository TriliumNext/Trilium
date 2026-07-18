import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import shortcuts, { canonicalizeShortcut, type Handler, isIMEComposing, keyMatches, matchesShortcut, removeIndividualBinding } from "./shortcuts.js";
import utils from "./utils.js";

// Mock utils module
vi.mock("./utils.js", () => ({
    default: {
        isDesktop: () => true
    }
}));

// Mock jQuery globally since it's used in the shortcuts module
const mockElement = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
};

const mockJQuery = vi.fn(() => [mockElement]);
(mockJQuery as any).length = 1;
mockJQuery[0] = mockElement;

(global as any).$ = mockJQuery as any;
global.document = mockElement as any;

describe("shortcuts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Clean up any active bindings after each test
        shortcuts.removeGlobalShortcut("test-namespace");
    });

    describe("canonicalizeShortcut", () => {
        it("treats modifiers as an unordered set", () => {
            expect(canonicalizeShortcut("Ctrl+Shift+J")).toBe(canonicalizeShortcut("Shift+Ctrl+J"));
            expect(canonicalizeShortcut("Ctrl+Alt+Shift+Meta+K")).toBe(canonicalizeShortcut("Meta+Shift+Alt+Ctrl+K"));
        });

        it("collapses modifier aliases", () => {
            expect(canonicalizeShortcut("Control+A")).toBe(canonicalizeShortcut("Ctrl+A"));
            expect(canonicalizeShortcut("Cmd+A")).toBe(canonicalizeShortcut("Meta+A"));
            expect(canonicalizeShortcut("Command+A")).toBe(canonicalizeShortcut("Meta+A"));
        });

        it("collapses key aliases via keyMap", () => {
            expect(canonicalizeShortcut("Ctrl+Del")).toBe(canonicalizeShortcut("Ctrl+Delete"));
            expect(canonicalizeShortcut("Ctrl+Enter")).toBe(canonicalizeShortcut("Ctrl+Return"));
            expect(canonicalizeShortcut("Ctrl+Esc")).toBe(canonicalizeShortcut("Ctrl+Escape"));
        });

        it("is case insensitive and ignores surrounding whitespace", () => {
            expect(canonicalizeShortcut("CTRL + j")).toBe(canonicalizeShortcut("ctrl+J"));
        });

        it("distinguishes genuinely different combinations", () => {
            expect(canonicalizeShortcut("Ctrl+J")).not.toBe(canonicalizeShortcut("Ctrl+Shift+J"));
            expect(canonicalizeShortcut("Ctrl+J")).not.toBe(canonicalizeShortcut("Alt+J"));
        });

        it("returns an empty string for an empty shortcut", () => {
            expect(canonicalizeShortcut("")).toBe("");
        });
    });

    describe("normalizeShortcut", () => {
        it("should normalize shortcut to lowercase and remove whitespace", () => {
            expect(shortcuts.normalizeShortcut("Ctrl + A")).toBe("ctrl+a");
            expect(shortcuts.normalizeShortcut("  SHIFT + F1  ")).toBe("shift+f1");
            expect(shortcuts.normalizeShortcut("Alt+Space")).toBe("alt+space");
        });

        it("should handle empty or null shortcuts", () => {
            expect(shortcuts.normalizeShortcut("")).toBe("");
            expect(shortcuts.normalizeShortcut(null as any)).toBe(null);
            expect(shortcuts.normalizeShortcut(undefined as any)).toBe(undefined);
        });

        it("should handle shortcuts with multiple spaces", () => {
            expect(shortcuts.normalizeShortcut("Ctrl   +   Shift   +   A")).toBe("ctrl+shift+a");
        });

        it("should warn about malformed shortcuts", () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            shortcuts.normalizeShortcut("ctrl+");
            shortcuts.normalizeShortcut("+a");
            shortcuts.normalizeShortcut("ctrl++a");

            expect(consoleSpy).toHaveBeenCalledTimes(3);
            consoleSpy.mockRestore();
        });
    });

    describe("keyMatches", () => {
        const createKeyboardEvent = (key: string, code?: string, extraProps: Partial<KeyboardEvent> = {}) => ({
            key,
            code: code || `Key${key.toUpperCase()}`,
            ...extraProps
        } as KeyboardEvent);

        it("should match regular letter keys using key code", () => {
            const event = createKeyboardEvent("a", "KeyA");
            expect(keyMatches(event, "a")).toBe(true);
            expect(keyMatches(event, "A")).toBe(true);
        });

        it("should match number keys using digit codes", () => {
            const event = createKeyboardEvent("1", "Digit1");
            expect(keyMatches(event, "1")).toBe(true);
        });

        it("should match special keys using key mapping", () => {
            expect(keyMatches({ key: "Enter" } as KeyboardEvent, "return")).toBe(true);
            expect(keyMatches({ key: "Enter" } as KeyboardEvent, "enter")).toBe(true);
            expect(keyMatches({ key: "Delete" } as KeyboardEvent, "del")).toBe(true);
            expect(keyMatches({ key: "Escape" } as KeyboardEvent, "esc")).toBe(true);
            expect(keyMatches({ key: " " } as KeyboardEvent, "space")).toBe(true);
            expect(keyMatches({ key: "ArrowUp" } as KeyboardEvent, "up")).toBe(true);
        });

        it("should match function keys", () => {
            expect(keyMatches({ key: "F1" } as KeyboardEvent, "f1")).toBe(true);
            expect(keyMatches({ key: "F12" } as KeyboardEvent, "f12")).toBe(true);
        });

        it("should handle undefined or null keys", () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(keyMatches({} as KeyboardEvent, null as any)).toBe(false);
            expect(keyMatches({} as KeyboardEvent, undefined as any)).toBe(false);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it("should match azerty keys", () => {
            const event = createKeyboardEvent("A", "KeyQ");
            expect(keyMatches(event, "a")).toBe(true);
            expect(keyMatches(event, "q")).toBe(false);
        });

        it("should match letter keys using code when key is a special character (macOS Alt behavior)", () => {
            // On macOS, pressing Option/Alt + A produces 'å' as the key, but code is still 'KeyA'
            const macOSAltAEvent = createKeyboardEvent("å", "KeyA", { altKey: true });
            expect(keyMatches(macOSAltAEvent, "a")).toBe(true);

            // Option + H produces '˙'
            const macOSAltHEvent = createKeyboardEvent("˙", "KeyH", { altKey: true });
            expect(keyMatches(macOSAltHEvent, "h")).toBe(true);

            // Option + S produces 'ß'
            const macOSAltSEvent = createKeyboardEvent("ß", "KeyS", { altKey: true });
            expect(keyMatches(macOSAltSEvent, "s")).toBe(true);
        });
    });

    describe("matchesShortcut", () => {
        const createKeyboardEvent = (options: {
            key: string;
            code?: string;
            ctrlKey?: boolean;
            altKey?: boolean;
            shiftKey?: boolean;
            metaKey?: boolean;
        }) => ({
            key: options.key,
            code: options.code || `Key${options.key.toUpperCase()}`,
            ctrlKey: options.ctrlKey || false,
            altKey: options.altKey || false,
            shiftKey: options.shiftKey || false,
            metaKey: options.metaKey || false
        } as KeyboardEvent);

        it("should match shortcuts with modifiers", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA", ctrlKey: true });
            expect(matchesShortcut(event, "ctrl+a")).toBe(true);

            const shiftEvent = createKeyboardEvent({ key: "a", code: "KeyA", shiftKey: true });
            expect(matchesShortcut(shiftEvent, "shift+a")).toBe(true);
        });

        it("should match complex modifier combinations", () => {
            const event = createKeyboardEvent({
                key: "a",
                code: "KeyA",
                ctrlKey: true,
                shiftKey: true
            });
            expect(matchesShortcut(event, "ctrl+shift+a")).toBe(true);
        });

        it("should not match when modifiers don't match", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA", ctrlKey: true });
            expect(matchesShortcut(event, "alt+a")).toBe(false);
            expect(matchesShortcut(event, "a")).toBe(false);
        });

        it("should not match when the main key differs", () => {
            // Valid shortcut format but the pressed key ("b") does not match the
            // shortcut's key ("a"), so keyMatches returns false (line 175 true branch -> 176).
            const event = createKeyboardEvent({ key: "b", code: "KeyB", ctrlKey: true });
            expect(matchesShortcut(event, "ctrl+a")).toBe(false);
        });

        it("should not match when no modifiers are used", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            expect(matchesShortcut(event, "a")).toBe(false);
        });

        it("should match some keys even with no modifiers", () => {
            // Bare function keys
            let event = createKeyboardEvent({ key: "F1", code: "F1" });
            expect(matchesShortcut(event, "F1")).toBeTruthy();
            expect(matchesShortcut(event, "f1")).toBeTruthy();

            // Function keys with shift
            event = createKeyboardEvent({ key: "F1", code: "F1", shiftKey: true });
            expect(matchesShortcut(event, "Shift+F1")).toBeTruthy();

            // Special keys
            for (const keyCode of [ "Delete", "Enter", "NumpadEnter" ]) {
                event = createKeyboardEvent({ key: keyCode, code: keyCode });
                expect(matchesShortcut(event, keyCode), `Key ${keyCode}`).toBeTruthy();
            }
        });

        it("should handle alternative modifier names", () => {
            const ctrlEvent = createKeyboardEvent({ key: "a", code: "KeyA", ctrlKey: true });
            expect(matchesShortcut(ctrlEvent, "control+a")).toBe(true);

            const metaEvent = createKeyboardEvent({ key: "a", code: "KeyA", metaKey: true });
            expect(matchesShortcut(metaEvent, "cmd+a")).toBe(true);
            expect(matchesShortcut(metaEvent, "command+a")).toBe(true);
        });

        it("should handle empty or invalid shortcuts", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            expect(matchesShortcut(event, "")).toBe(false);
            expect(matchesShortcut(event, null as any)).toBe(false);
        });

        it("should handle invalid events", () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(matchesShortcut(null as any, "a")).toBe(false);
            expect(matchesShortcut({} as KeyboardEvent, "a")).toBe(false);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it("should warn about invalid shortcut formats", () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });

            matchesShortcut(event, "ctrl+");
            matchesShortcut(event, "+");

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it("matches azerty", () => {
            const event = createKeyboardEvent({
                key: "a",
                code: "KeyQ",
                ctrlKey: true
            });
            expect(matchesShortcut(event, "Ctrl+A")).toBe(true);
        });

        it("should match Alt+letter shortcuts on macOS where key is a special character", () => {
            // On macOS, pressing Option/Alt + A produces 'å' but code remains 'KeyA'
            const macOSAltAEvent = createKeyboardEvent({
                key: "å",
                code: "KeyA",
                altKey: true
            });
            expect(matchesShortcut(macOSAltAEvent, "alt+a")).toBe(true);

            // Option/Alt + H produces '˙'
            const macOSAltHEvent = createKeyboardEvent({
                key: "˙",
                code: "KeyH",
                altKey: true
            });
            expect(matchesShortcut(macOSAltHEvent, "alt+h")).toBe(true);

            // Combined with Ctrl: Ctrl+Alt+S where Alt produces 'ß'
            const macOSCtrlAltSEvent = createKeyboardEvent({
                key: "ß",
                code: "KeyS",
                ctrlKey: true,
                altKey: true
            });
            expect(matchesShortcut(macOSCtrlAltSEvent, "ctrl+alt+s")).toBe(true);
        });
    });

    describe("bindGlobalShortcut", () => {
        it("should bind a global shortcut", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            expect(mockElement.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
        });

        it("should not bind shortcuts when handler is null", () => {
            shortcuts.bindGlobalShortcut("ctrl+a", null, "test-namespace");

            expect(mockElement.addEventListener).not.toHaveBeenCalled();
        });

        it("should remove previous bindings when namespace is reused", () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            shortcuts.bindGlobalShortcut("ctrl+a", handler1, "test-namespace");
            expect(mockElement.addEventListener).toHaveBeenCalledTimes(1);

            shortcuts.bindGlobalShortcut("ctrl+b", handler2, "test-namespace");
            expect(mockElement.removeEventListener).toHaveBeenCalledTimes(1);
            expect(mockElement.addEventListener).toHaveBeenCalledTimes(2);
        });
    });

    describe("bindElShortcut", () => {
        it("should bind shortcut to specific element", () => {
            const mockEl = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
            const mockJQueryEl = [mockEl] as any;
            mockJQueryEl.length = 1;

            const handler = vi.fn();
            shortcuts.bindElShortcut(mockJQueryEl, "ctrl+a", handler, "test-namespace");

            expect(mockEl.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
        });

        it("should fall back to document when element is empty", () => {
            const emptyJQuery = [] as any;
            emptyJQuery.length = 0;

            const handler = vi.fn();
            shortcuts.bindElShortcut(emptyJQuery, "ctrl+a", handler, "test-namespace");

            expect(mockElement.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
        });
    });

    describe("removeGlobalShortcut", () => {
        it("should remove shortcuts for a specific namespace", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            // Capture the exact listener that was tracked for this namespace's binding.
            const [, boundListener] = mockElement.addEventListener.mock.calls[0];

            shortcuts.removeGlobalShortcut("test-namespace");

            // Tearing down the namespace detaches that same tracked listener, proving the
            // binding was actually registered in activeBindings (not merely attached to the DOM).
            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", boundListener);
        });
    });

    describe("event handling", () => {
        it("should call handler when shortcut matches", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // Real KeyboardEvent so `evt instanceof KeyboardEvent` is true and the
            // handler/preventDefault/stopPropagation path (lines 106-109) executes.
            const testEvent = new KeyboardEvent("keydown", {
                key: "a",
                code: "KeyA",
                ctrlKey: true
            });
            const preventDefault = vi.spyOn(testEvent, "preventDefault");
            const stopPropagation = vi.spyOn(testEvent, "stopPropagation");

            listener(testEvent);

            expect(handler).toHaveBeenCalledWith(testEvent);
            expect(preventDefault).toHaveBeenCalled();
            expect(stopPropagation).toHaveBeenCalled();
        });

        it("should not call handler while IME is composing", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // isComposing true short-circuits before matchesShortcut (lines 102-103).
            const event = new KeyboardEvent("keydown", {
                key: "a",
                code: "KeyA",
                ctrlKey: true
            });
            Object.defineProperty(event, "isComposing", { value: true });

            listener(event);

            expect(handler).not.toHaveBeenCalled();
        });

        it("should not call handler for a real KeyboardEvent that does not match", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // A real KeyboardEvent that passes the type/instance/IME guards but fails
            // matchesShortcut, exercising the false branch of line 106.
            const event = new KeyboardEvent("keydown", {
                key: "b",
                code: "KeyB",
                ctrlKey: true
            });
            const preventDefault = vi.spyOn(event, "preventDefault");

            listener(event);

            expect(handler).not.toHaveBeenCalled();
            expect(preventDefault).not.toHaveBeenCalled();
        });

        it("should not call handler for keydown events that are not KeyboardEvents", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // type is "keydown" but the object is a plain Event, exercising the
            // second operand of `evt.type !== 'keydown' || !(evt instanceof KeyboardEvent)`.
            const event = new Event("keydown");

            listener(event);

            expect(handler).not.toHaveBeenCalled();
        });

        it("should not call handler for non-keyboard events", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // Simulate a non-keyboard event
            const event = {
                type: "click"
            } as any;

            listener(event);

            expect(handler).not.toHaveBeenCalled();
        });

        it("should not call handler when shortcut doesn't match", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // Simulate a non-matching keydown event
            const event = {
                type: "keydown",
                key: "b",
                code: "KeyB",
                ctrlKey: true,
                altKey: false,
                shiftKey: false,
                metaKey: false,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn()
            } as any;

            listener(event);

            expect(handler).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        });
    });

    describe('isIMEComposing', () => {
        it('should return true when event.isComposing is true', () => {
            const event = { isComposing: true, keyCode: 65 } as KeyboardEvent;
            expect(isIMEComposing(event)).toBe(true);
        });

        it('should return true when keyCode is 229', () => {
            const event = { isComposing: false, keyCode: 229 } as KeyboardEvent;
            expect(isIMEComposing(event)).toBe(true);
        });

        it('should return true when both isComposing is true and keyCode is 229', () => {
            const event = { isComposing: true, keyCode: 229 } as KeyboardEvent;
            expect(isIMEComposing(event)).toBe(true);
        });

        it('should return false for normal keys', () => {
            const event = { isComposing: false, keyCode: 65 } as KeyboardEvent;
            expect(isIMEComposing(event)).toBe(false);
        });

        it('should return false when isComposing is undefined and keyCode is not 229', () => {
            const event = { keyCode: 13 } as KeyboardEvent;
            expect(isIMEComposing(event)).toBe(false);
        });

        it('should handle null/undefined events gracefully', () => {
            expect(isIMEComposing(null as any)).toBe(false);
            expect(isIMEComposing(undefined as any)).toBe(false);
        });
    });

    describe("removeIndividualBinding", () => {
        // bindElShortcut returns the created ShortcutBinding; bindGlobalShortcut returns void.
        const bind = (shortcut: string, handler: Handler, namespace?: string) =>
            shortcuts.bindElShortcut([mockElement] as any, shortcut, handler, namespace)!;

        it("should remove the event listener and drop the binding from its namespace", () => {
            const handler = vi.fn();
            const binding = bind("ctrl+a", handler, "test-namespace");

            expect(binding).toBeTruthy();

            removeIndividualBinding(binding);

            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", binding.listener);
        });

        it("removes only the targeted binding and leaves the rest of the namespace tracked", () => {
            // Two bindings with DISTINCT handlers in the same namespace. Removing one must
            // drop only that binding from activeBindings and keep the other tracked. The map
            // is private, so we observe it indirectly: tearing the namespace down afterwards
            // must still detach the surviving binding's listener (and must not touch the
            // already-removed one). This fails if the filter drops the wrong bindings.
            const a = bind("ctrl+a", vi.fn(), "ns-multi");
            const b = bind("ctrl+b", vi.fn(), "ns-multi");

            removeIndividualBinding(a);
            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", a.listener);

            mockElement.removeEventListener.mockClear();
            shortcuts.removeGlobalShortcut("ns-multi");

            // b survived in the namespace and is cleaned up; a was already dropped, so it is
            // not detached a second time.
            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", b.listener);
            expect(mockElement.removeEventListener).not.toHaveBeenCalledWith("keydown", a.listener);
        });

        it("should default to the 'global' namespace when binding has no namespace", () => {
            // Bind without a namespace so binding.namespace is null and the `?? "global"`
            // fallback (line 136) is exercised, plus the activeBindings.has(key) true branch.
            const handler = vi.fn();
            const first = bind("ctrl+a", handler);
            const second = bind("ctrl+b", handler);

            expect(first.namespace).toBeNull();
            expect(second.namespace).toBeNull();

            removeIndividualBinding(first);

            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", first.listener);
        });

        it("should be a no-op when no bindings exist for the namespace", () => {
            // Fabricate a binding for a namespace that has never been registered so
            // `activeBindings.get(key)` is undefined (false branch of line 138).
            const binding = {
                element: mockElement as any,
                shortcut: "ctrl+z",
                handler: vi.fn(),
                namespace: "never-registered",
                listener: vi.fn()
            };

            expect(() => removeIndividualBinding(binding)).not.toThrow();
            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", binding.listener);
        });
    });

    describe("non-desktop behavior", () => {
        it("should not bind shortcuts when not on desktop", () => {
            const isDesktopSpy = vi.spyOn(utils, "isDesktop").mockReturnValue(false);
            try {
                const handler = vi.fn();
                const result = shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

                expect(result).toBeUndefined();
                expect(mockElement.addEventListener).not.toHaveBeenCalled();
            } finally {
                isDesktopSpy.mockRestore();
            }
        });
    });

    describe("the plus key (German / European layouts)", () => {
        // On QWERTZ and most European layouts "+" is its own key (e.code "BracketRight"), not
        // Shift+"=". Because "+" doubles as the shortcut separator, it used to be impossible to bind.
        const ctrlPlus = (extra: Partial<KeyboardEvent> = {}) => ({
            key: "+",
            code: "BracketRight",
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            ...extra
        } as KeyboardEvent);

        it("matches the raw '++' encoding (e.g. a stored or hand-typed Ctrl++)", () => {
            expect(matchesShortcut(ctrlPlus(), "Ctrl++")).toBe(true);
            expect(matchesShortcut(ctrlPlus({ shiftKey: true }), "Ctrl++")).toBe(false);
        });

        it("matches the named 'Plus' token", () => {
            expect(matchesShortcut(ctrlPlus(), "Ctrl+Plus")).toBe(true);
            expect(matchesShortcut(ctrlPlus({ ctrlKey: false }), "Ctrl+Plus")).toBe(false);
        });

        it("matches the numpad plus key", () => {
            const numpadPlus = ctrlPlus({ code: "NumpadAdd" });
            expect(matchesShortcut(numpadPlus, "Ctrl+Plus")).toBe(true);
            expect(matchesShortcut(numpadPlus, "Ctrl++")).toBe(true);
        });

        it("does not confuse the plus key with the equals key", () => {
            // US layout zoom-in default is Ctrl+= (Shift+= produces "+"); these must stay distinct.
            const ctrlEquals = ctrlPlus({ key: "=", code: "Equal" });
            expect(matchesShortcut(ctrlEquals, "Ctrl++")).toBe(false);
            expect(matchesShortcut(ctrlPlus(), "Ctrl+=")).toBe(false);
        });

        it("matchesShortcut with multiple modifiers and the plus key", () => {
            expect(matchesShortcut(ctrlPlus({ shiftKey: true }), "Ctrl+Shift++")).toBe(true);
            expect(matchesShortcut(ctrlPlus({ shiftKey: true }), "Ctrl+Shift+Plus")).toBe(true);
        });

        it("keyMatches resolves the 'plus' token to the '+' character", () => {
            expect(keyMatches({ key: "+", code: "BracketRight" } as KeyboardEvent, "plus")).toBe(true);
            expect(keyMatches({ key: "=", code: "Equal" } as KeyboardEvent, "plus")).toBe(false);
        });

        it("canonicalizes the raw and named plus forms to the same combination", () => {
            expect(canonicalizeShortcut("Ctrl++")).toBe(canonicalizeShortcut("Ctrl+Plus"));
            expect(canonicalizeShortcut("Ctrl++")).not.toBe(canonicalizeShortcut("Ctrl+="));
        });

        it("normalizeShortcut keeps a valid Ctrl++ without warning", () => {
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            expect(shortcuts.normalizeShortcut("Ctrl++")).toBe("ctrl++");

            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe("matchesShortcut empty-key guard", () => {
        it("should warn and return false when the key part is only whitespace", () => {
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const event = { key: "a", code: "KeyA" } as KeyboardEvent;

            // "ctrl+ " splits to ["ctrl", " "]; key is " " so !key is false but
            // key.trim() === '' is true, covering the second operand of line 169.
            expect(matchesShortcut(event, "ctrl+ ")).toBe(false);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe("keyMatches code fallbacks", () => {
        it("should match a mapped special key by its code when key differs", () => {
            // "space" maps to [" ", "Space"]; matching via e.code === "Space" exercises
            // the `mappedKeys.includes(e.code)` fallback on line 206.
            expect(keyMatches({ key: "Unidentified", code: "Space" } as KeyboardEvent, "space")).toBe(true);
        });

        it("should match an Alt+letter by key when the code does not match", () => {
            // altKey true, code mismatched, but e.key matches — covers the second
            // operand of line 221.
            expect(keyMatches({ key: "a", code: "Unidentified", altKey: true } as KeyboardEvent, "a")).toBe(true);
        });

        it("should match a regular key by its code as a fallback", () => {
            // Not a mapped key, not a digit, not a single a-z letter, so it falls
            // through to line 227 and matches via e.code.
            expect(keyMatches({ key: "Unidentified", code: "Comma" } as KeyboardEvent, "comma")).toBe(true);
        });
    });
});

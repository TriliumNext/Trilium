import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import shortcuts, { isIMEComposing, keyMatches, matchesShortcut } from "./shortcuts.js";

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

            shortcuts.removeGlobalShortcut("test-namespace");

            expect(mockElement.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
        });
    });

    describe("event handling", () => {
        it.skip("should call handler when shortcut matches", () => {
            const handler = vi.fn();
            shortcuts.bindGlobalShortcut("ctrl+a", handler, "test-namespace");

            // Get the listener that was registered
            expect(mockElement.addEventListener.mock.calls).toHaveLength(1);
            const [, listener] = mockElement.addEventListener.mock.calls[0];

            // First verify that matchesShortcut works directly
            const testEvent = {
                type: "keydown",
                key: "a",
                code: "KeyA",
                ctrlKey: true,
                altKey: false,
                shiftKey: false,
                metaKey: false,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn()
            } as any;

            // Test matchesShortcut directly first
            expect(matchesShortcut(testEvent, "ctrl+a")).toBe(true);

            // Now test the actual listener
            listener(testEvent);

            expect(handler).toHaveBeenCalled();
            expect(testEvent.preventDefault).toHaveBeenCalled();
            expect(testEvent.stopPropagation).toHaveBeenCalled();
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
});

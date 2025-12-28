import utils from "./utils.js";

type ElementType = HTMLElement | Document;
export type Handler = (e: KeyboardEvent) => void;

export interface ShortcutBinding {
    element: HTMLElement | Document;
    shortcut: string;
    handler: Handler;
    namespace: string | null;
    listener: (evt: Event) => void;
}

// Store all active shortcut bindings for management
const activeBindings: Map<string, ShortcutBinding[]> = new Map();

// Handle special key mappings and aliases
const keyMap: { [key: string]: string[] } = {
    'return': ['Enter'],
    'enter': ['Enter'],  // alias for return
    'del': ['Delete'],
    'delete': ['Delete'], // alias for del
    'esc': ['Escape'],
    'escape': ['Escape'], // alias for esc
    'space': [' ', 'Space'],
    'tab': ['Tab'],
    'backspace': ['Backspace'],
    'home': ['Home'],
    'end': ['End'],
    'pageup': ['PageUp'],
    'pagedown': ['PageDown'],
    'up': ['ArrowUp'],
    'down': ['ArrowDown'],
    'left': ['ArrowLeft'],
    'right': ['ArrowRight']
};

// Function keys
const functionKeyCodes: string[] = [];
for (let i = 1; i <= 19; i++) {
    const keyCode = `F${i}`;
    functionKeyCodes.push(keyCode);
    keyMap[`f${i}`] = [ keyCode ];
}

const KEYCODES_WITH_NO_MODIFIER = new Set([
    "Delete",
    "Enter",
    "NumpadEnter",
    ...functionKeyCodes
]);

/**
 * Check if IME (Input Method Editor) is composing
 * This is used to prevent keyboard shortcuts from firing during IME composition
 * @param e - The keyboard event to check
 * @returns true if IME is currently composing, false otherwise
 */
export function isIMEComposing(e: KeyboardEvent): boolean {
    // Handle null/undefined events gracefully
    if (!e) {
        return false;
    }

    // Standard check for composition state
    // e.isComposing is true when IME is actively composing
    // e.keyCode === 229 is a fallback for older browsers where 229 indicates IME processing
    return e.isComposing || e.keyCode === 229;
}

function removeGlobalShortcut(namespace: string) {
    bindGlobalShortcut("", null, namespace);
}

function bindGlobalShortcut(keyboardShortcut: string, handler: Handler | null, namespace: string | null = null) {
    bindElShortcut($(document), keyboardShortcut, handler, namespace);
}

function bindElShortcut($el: JQuery<ElementType | Element>, keyboardShortcut: string, handler: Handler | null, namespace: string | null = null) {
    if (utils.isDesktop()) {
        keyboardShortcut = normalizeShortcut(keyboardShortcut);

        // If namespace is provided, remove all previous bindings for this namespace
        if (namespace) {
            removeNamespaceBindings(namespace);
        }

        // Method can be called to remove the shortcut (e.g. when keyboardShortcut label is deleted)
        if (keyboardShortcut && handler) {
            const element = $el.length > 0 ? $el[0] as (HTMLElement | Document) : document;

            const listener = (evt: Event) => {
                // Only handle keyboard events
                if (evt.type !== 'keydown' || !(evt instanceof KeyboardEvent)) {
                    return;
                }

                const e = evt as KeyboardEvent;

                // Skip processing if IME is composing to prevent shortcuts from
                // interfering with text input in CJK languages
                if (isIMEComposing(e)) {
                    return;
                }

                if (matchesShortcut(e, keyboardShortcut)) {
                    e.preventDefault();
                    e.stopPropagation();
                    handler(e);
                }
            };

            // Add the event listener
            element.addEventListener('keydown', listener);

            // Store the binding for later cleanup
            const binding: ShortcutBinding = {
                element,
                shortcut: keyboardShortcut,
                handler,
                namespace,
                listener
            };

            const key = namespace || 'global';
            if (!activeBindings.has(key)) {
                activeBindings.set(key, []);
            }
            activeBindings.get(key)!.push(binding);
            return binding;
        }
    }
}

export function removeIndividualBinding(binding: ShortcutBinding) {
    const key = binding.namespace ?? "global";
    const activeBindingsInNamespace = activeBindings.get(key);
    if (activeBindingsInNamespace) {
        activeBindings.set(key, activeBindingsInNamespace.filter(aBinding => aBinding.handler === binding.handler));
    }
    binding.element.removeEventListener("keydown", binding.listener);
}

function removeNamespaceBindings(namespace: string) {
    const bindings = activeBindings.get(namespace);
    if (bindings) {
        // Remove all event listeners for this namespace
        bindings.forEach(binding => {
            binding.element.removeEventListener('keydown', binding.listener);
        });
        activeBindings.delete(namespace);
    }
}

export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
    if (!shortcut) return false;

    // Ensure we have a proper KeyboardEvent with key property
    if (!e || typeof e.key !== 'string') {
        console.warn('matchesShortcut called with invalid event:', e);
        return false;
    }

    const parts = shortcut.toLowerCase().split('+');
    const key = parts[parts.length - 1]; // Last part is the actual key
    const modifiers = parts.slice(0, -1); // Everything before is modifiers

    // Defensive check - ensure we have a valid key
    if (!key || key.trim() === '') {
        console.warn('Invalid shortcut format:', shortcut);
        return false;
    }

    // Check if the main key matches
    if (!keyMatches(e, key)) {
        return false;
    }

    // Check modifiers
    const expectedCtrl = modifiers.includes('ctrl') || modifiers.includes('control');
    const expectedAlt = modifiers.includes('alt');
    const expectedShift = modifiers.includes('shift');
    const expectedMeta = modifiers.includes('meta') || modifiers.includes('cmd') || modifiers.includes('command');

    // Refuse key combinations that don't include modifiers because they interfere with the normal usage of the application.
    // Some keys such as function keys are an exception.
    if (!(expectedCtrl || expectedAlt || expectedShift || expectedMeta) && !KEYCODES_WITH_NO_MODIFIER.has(e.code)) {
        return false;
    }

    return e.ctrlKey === expectedCtrl &&
           e.altKey === expectedAlt &&
           e.shiftKey === expectedShift &&
           e.metaKey === expectedMeta;
}

export function keyMatches(e: KeyboardEvent, key: string): boolean {
    // Defensive check for undefined/null key
    if (!key) {
        console.warn('keyMatches called with undefined/null key');
        return false;
    }

    const mappedKeys = keyMap[key.toLowerCase()];
    if (mappedKeys) {
        return mappedKeys.includes(e.key) || mappedKeys.includes(e.code);
    }

    // For number keys, use the physical key code regardless of modifiers
    // This works across all keyboard layouts
    if (key >= '0' && key <= '9') {
        return e.code === `Digit${key}`;
    }

    // For letter keys, use the physical key code for consistency
    if (key.length === 1 && key >= 'a' && key <= 'z') {
        return e.key.toLowerCase() === key.toLowerCase();
    }

    // For regular keys, check both key and code as fallback
    return e.key.toLowerCase() === key.toLowerCase() ||
           e.code.toLowerCase() === key.toLowerCase();
}

/**
 * Simple normalization - just lowercase and trim whitespace
 */
function normalizeShortcut(shortcut: string): string {
    if (!shortcut) {
        return shortcut;
    }

    const normalized = shortcut.toLowerCase().trim().replace(/\s+/g, '');

    // Warn about potentially problematic shortcuts
    if (normalized.endsWith('+') || normalized.startsWith('+') || normalized.includes('++')) {
        console.warn('Potentially malformed shortcut:', shortcut, '-> normalized to:', normalized);
    }

    return normalized;
}

export default {
    bindGlobalShortcut,
    bindElShortcut,
    removeGlobalShortcut,
    normalizeShortcut
};

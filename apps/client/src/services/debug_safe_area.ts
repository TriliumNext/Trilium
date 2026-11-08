import "./debug_safe_area.css";

const SIDES = [ "top", "right", "bottom", "left" ] as const;

type Side = typeof SIDES[number];

/**
 * Simulates the system bars of a mobile device: sets the `--safe-area-inset-*` properties the way
 * the Android shell's `MainActivity` does, and outlines the covered area in red so that anything
 * drawn under a system bar shows through it.
 *
 * @param spec the insets in CSS pixels, in the order and with the shorthand of the CSS `padding`
 * property (`"0 0 48 0"`, `"24 0 48"`, `"48"`).
 */
export default function simulateSafeAreaInsets(spec: string) {
    const insets = parseSafeAreaInsets(spec);
    if (!insets) {
        console.warn(`Ignoring VITE_DEBUG_SAFE_AREA_INSETS="${spec}": expected 1 to 4 numbers.`);
        return;
    }

    const root = document.documentElement;
    for (const side of SIDES) {
        root.style.setProperty(`--safe-area-inset-${side}`, `${insets[side]}px`);
    }

    const overlay = document.createElement("div");
    overlay.className = "debug-safe-area-overlay";
    document.body.append(overlay);
}

export function parseSafeAreaInsets(spec: string): Record<Side, number> | null {
    const values = spec.trim().split(/\s+/).map(Number);
    const isValid = (value: number) => Number.isFinite(value) && value >= 0;
    if (values.length > 4 || !values.every(isValid)) {
        return null;
    }

    const [ top, right = top, bottom = top, left = right ] = values;
    return { top, right, bottom, left };
}

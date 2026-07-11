/**
 * Resolve a CSS custom property to a concrete `rgb(...)` colour for canvas rendering.
 *
 * `getComputedStyle().getPropertyValue("--x")` returns the value unresolved when a theme defines it through
 * nested `var()` references. Instead we attach a throwaway probe element that inherits `host`'s cascade and set
 * its `color` to `var(--name, fallback)`; the browser's style engine substitutes the variables, and we read back
 * the computed `color`. Falls back to `fallback` if the property is unset or the runtime returns nothing.
 */
export function resolveCssColor(host: HTMLElement, name: string, fallback: string): string {
    const probe = document.createElement("span");
    probe.style.color = `var(${name}, ${fallback})`;
    probe.style.display = "none";
    host.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    host.removeChild(probe);
    return resolved || fallback;
}

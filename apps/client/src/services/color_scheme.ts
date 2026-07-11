export type ColorScheme = "system" | "light" | "dark";

/** Order the color-scheme switcher cycles through on each click. */
export const COLOR_SCHEME_CYCLE: readonly ColorScheme[] = [ "system", "light", "dark" ];

/** Maps each theme family and color scheme to the concrete `theme` option value. */
export const THEME_FAMILY_SCHEMES: Record<string, Record<ColorScheme, string>> = {
    modern: { system: "next", light: "next-light", dark: "next-dark" },
    legacy: { system: "auto", light: "light", dark: "dark" }
};

export interface ResolvedColorScheme {
    /** The theme family key, or `null` for a custom theme that has no color-scheme variants. */
    family: string | null;
    scheme: ColorScheme;
    isCustom: boolean;
}

export function resolveColorScheme(theme: string | null | undefined): ResolvedColorScheme {
    for (const [ family, schemes ] of Object.entries(THEME_FAMILY_SCHEMES)) {
        for (const [ scheme, value ] of Object.entries(schemes)) {
            if (value === theme) {
                return { family, scheme: scheme as ColorScheme, isCustom: false };
            }
        }
    }
    return { family: null, scheme: "system", isCustom: true };
}

/**
 * Returns the `theme` value for the next color scheme in the cycle, keeping the current family.
 * Returns `null` when the theme is custom and therefore has no color-scheme variants to cycle through.
 */
export function getNextColorSchemeTheme(theme: string | null | undefined): string | null {
    const { family, scheme } = resolveColorScheme(theme);
    if (!family) {
        return null;
    }
    const nextScheme = COLOR_SCHEME_CYCLE[(COLOR_SCHEME_CYCLE.indexOf(scheme) + 1) % COLOR_SCHEME_CYCLE.length];
    return THEME_FAMILY_SCHEMES[family][nextScheme];
}

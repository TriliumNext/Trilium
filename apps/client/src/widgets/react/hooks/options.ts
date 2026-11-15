import type { OptionNames, UserTheme } from "@triliumnext/commons";
import { useCallback, useDebugValue, useEffect, useMemo, useState } from "preact/hooks";

import options, { type OptionValue } from "../../../services/options";
import server from "../../../services/server";
import { getEffectiveThemeStyle } from "../../../services/theme";
import { getErrorMessage, reloadFrontendApp } from "../../../services/utils";
import { useTriliumEvent } from "./events";

/**
 * Allows a React component to read and write a Trilium option, while also watching for external changes.
 *
 * Conceptually, `useTriliumOption` works just like `useState`, but the value is also automatically updated if
 * the option is changed somewhere else in the client.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOption(name: OptionNames, needsRefresh?: boolean): [string, (newValue: OptionValue) => Promise<void>] {
    const initialValue = options.get(name);
    const [ value, setValue ] = useState(initialValue);

    const wrappedSetValue = useMemo(() => {
        return async (newValue: OptionValue) => {
            const originalValue = value;
            setValue(String(newValue));
            try {
                await options.save(name, newValue);
            } catch (e: unknown) {
                const message = getErrorMessage(e);
                void import("../../../services/ws").then(({ default: ws }) => ws.logError(message));
                setValue(originalValue);
            }

            if (needsRefresh) {
                reloadFrontendApp(`option change: ${name}`);
            }
        };
    }, [ name, needsRefresh, value ]);

    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }) => {
        if (loadResults.getOptionNames().includes(name)) {
            const newValue = options.get(name);
            setValue(newValue);
        }
    }, [ name, setValue ]));

    useDebugValue(name);

    return [
        value,
        wrappedSetValue
    ];
}

/**
 * Similar to {@link useTriliumOption}, but the value is converted to and from a boolean instead of a string.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionBool(name: OptionNames, needsRefresh?: boolean): [boolean, (newValue: boolean) => Promise<void>] {
    const [ value, setValue ] = useTriliumOption(name, needsRefresh);
    useDebugValue(name);
    return [
        (value === "true"),
        (newValue) => setValue(newValue ? "true" : "false")
    ];
}

/**
 * Similar to {@link useTriliumOption}, but the value is converted to and from a int instead of a string.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionInt(name: OptionNames): [number, (newValue: number) => Promise<void>] {
    const [ value, setValue ] = useTriliumOption(name);
    useDebugValue(name);
    return [
        (parseInt(value, 10)),
        (newValue) => setValue(newValue)
    ];
}

/**
 * Similar to {@link useTriliumOption}, but the object value is parsed to and from a JSON instead of a string.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionJson<T>(name: OptionNames, needsRefresh?: boolean): [ T, (newValue: T) => Promise<void> ] {
    const [ value, setValue ] = useTriliumOption(name, needsRefresh);
    useDebugValue(name);
    return [
        (JSON.parse(value) as T),
        (newValue => setValue(JSON.stringify(newValue)))
    ];
}

/**
 * Similar to {@link useTriliumOption}, but operates with multiple options at once.
 *
 * @param names the name of the option to listen for.
 * @returns an array where the first value is a map where the keys are the option names and the values, and the second value is the setter which takes in the same type of map and saves them all at once.
 */
export function useTriliumOptions<T extends OptionNames>(...names: T[]) {
    const values: Record<string, string> = {};
    for (const name of names) {
        values[name] = options.get(name);
    }

    useDebugValue(() => names.join(", "));

    return [
        values as Record<T, string>,
        options.saveMany
    ] as const;
}

/** The custom themes (notes with `#appTheme`), fetched once when the component mounts. */
export function useUserThemes() {
    const [ userThemes, setUserThemes ] = useState<UserTheme[]>([]);

    useEffect(() => {
        let cancelled = false;
        void server.get<UserTheme[] | undefined>("options/user-themes").then((themes) => {
            if (!cancelled) setUserThemes(themes ?? []);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return userThemes;
}

/** The effective light/dark style, updated on any theme change — a theme-option swap or, for auto themes, the
 *  OS light/dark flip (both delivered via the global `themeChanged` event). */
export function useColorScheme() {
    const [ themeStyle, setThemeStyle ] = useState(getEffectiveThemeStyle);
    useTriliumEvent("themeChanged", ({ themeStyle }) => setThemeStyle(themeStyle));
    return themeStyle;
}

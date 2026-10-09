import "./theme_switch.css";

type ThemePreference = "light" | "dark" | "system";

/** The order of the buttons, and the order in which the header button cycles. */
const PREFERENCES: ThemePreference[] = [ "light", "dark", "system" ];
const STORAGE_KEY = "theme";

const themeRootEl = document.documentElement;

/**
 * Wires the theme buttons of the left pane and the header button, which cycles through the same
 * choices. `boot_script.ejs` applies the theme and its `theme-preference-*` class before the first
 * paint, and the controls are styled from that class, so this only syncs `aria-pressed`, switches
 * the theme on click and follows the system theme while the preference is "system".
 */
export default function setupThemeSelector() {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const optionButtons = document.querySelectorAll<HTMLButtonElement>(".theme-option");
    // The checkbox of custom templates copied from an earlier `page.ejs`.
    const legacySwitch = document.querySelector<HTMLInputElement>(
        ".theme-selection input[type=checkbox]");
    let preference = readPreference();

    const apply = () => {
        const isDark = preference === "system" ? systemDark.matches : preference === "dark";
        themeRootEl.classList.toggle("theme-dark", isDark);
        themeRootEl.classList.toggle("theme-light", !isDark);
        for (const option of PREFERENCES) {
            themeRootEl.classList.toggle(`theme-preference-${option}`, option === preference);
        }
        for (const button of optionButtons) {
            button.setAttribute("aria-pressed", String(button.dataset.theme === preference));
        }
        if (legacySwitch) {
            legacySwitch.checked = isDark;
        }
    };

    const choose = (newPreference: ThemePreference) => {
        preference = newPreference;
        writePreference(preference);
        apply();
    };

    for (const button of optionButtons) {
        button.addEventListener("click", () => choose(parsePreference(button.dataset.theme)));
    }
    document.getElementById("theme-cycle-button")?.addEventListener("click", () => {
        choose(PREFERENCES[(PREFERENCES.indexOf(preference) + 1) % PREFERENCES.length]);
    });
    legacySwitch?.addEventListener("change", () => choose(legacySwitch.checked ? "dark" : "light"));
    systemDark.addEventListener("change", () => {
        if (preference === "system") {
            apply();
        }
    });

    apply();
}

function parsePreference(value: string | null | undefined): ThemePreference {
    return value === "light" || value === "dark" ? value : "system";
}

function readPreference() {
    try {
        return parsePreference(localStorage.getItem(STORAGE_KEY));
    } catch {
        return "system";
    }
}

/**
 * Stores an explicit theme; the system preference is stored as no value, as `boot_script.ejs`
 * reads it.
 */
function writePreference(preference: ThemePreference) {
    try {
        if (preference === "system") {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, preference);
        }
    } catch {
        // The choice still applies to this page.
    }
}

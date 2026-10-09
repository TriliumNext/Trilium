import "./theme_switch.css";

const themeRootEl = document.documentElement;

/**
 * Wires the dark mode switch. `boot_script.ejs` applies the theme class before the first paint, and
 * the switch is styled from that class, so this only syncs the checkbox for assistive technologies
 * and switches the theme on change.
 */
export default function setupThemeSelector() {
    const themeSwitch = document.querySelector<HTMLInputElement>(".theme-selection input");
    if (!themeSwitch) {
        return;
    }

    themeSwitch.checked = themeRootEl.classList.contains("theme-dark");
    themeSwitch.addEventListener("change", () => {
        const theme = themeSwitch.checked ? "dark" : "light";
        setTheme(theme);
        localStorage.setItem("theme", theme);
    });
}

function setTheme(theme: string) {
    if (theme === "dark") {
        themeRootEl.classList.add("theme-dark");
        themeRootEl.classList.remove("theme-light");
    } else {
        themeRootEl.classList.remove("theme-dark");
        themeRootEl.classList.add("theme-light");
    }
}

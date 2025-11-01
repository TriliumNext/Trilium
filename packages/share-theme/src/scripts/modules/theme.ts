const themeRootEl = document.documentElement;

/**
 * Note:
 *
 * - Setting of the .theme-dark or .theme-light is done in the share template's <head> to avoid a flash.
 * - Setting of the value of the checkbox is also done in the template, near the definition of the input box.
 */

export default function setupThemeSelector() {
    const themeSwitch: HTMLInputElement = document.querySelector(".theme-selection input")!;
    themeSwitch?.addEventListener("change", () => {
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

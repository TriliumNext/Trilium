import setupToC from "./modules/toc";
import setupExpanders from "./modules/expanders";
import setupMobileMenu from "./modules/mobile";
import setupSearch from "./modules/search";
import setupThemeSelector from "./modules/theme";
import setupMermaid from "./modules/mermaid";
import setupMath from "./modules/math";
import api from "./modules/api";
import "boxicons/css/boxicons.min.css";
import "highlight.js/styles/default.css";

function $try<T extends (...a: unknown[]) => unknown>(func: T, ...args: Parameters<T>) {
    try {
        func.apply(func, args);
    }
    catch (e) {
        console.error(e); // eslint-disable-line no-console
    }
}

Object.assign(window, api);
$try(setupThemeSelector);
$try(setupToC);
$try(setupExpanders);
$try(setupMobileMenu);
$try(setupSearch);

function setupTextNote() {
    $try(setupMermaid);
    $try(setupMath);
}

document.addEventListener(
    "DOMContentLoaded",
    () => {
        const noteType = determineNoteType();

        if (noteType === "text") {
            setupTextNote();
        }

        const toggleMenuButton = document.getElementById("toggleMenuButton");
        const layout = document.getElementById("layout");

        if (toggleMenuButton && layout) {
            toggleMenuButton.addEventListener("click", () => layout.classList.toggle("showMenu"));
        }
    },
    false
);

function determineNoteType() {
    const bodyClass = document.body.className;
    const match = bodyClass.match(/type-([^\s]+)/);
    return match ? match[1] : null;
}

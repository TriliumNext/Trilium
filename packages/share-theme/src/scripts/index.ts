import setupToC from "./modules/toc.js";
import setupExpanders from "./modules/expanders.js";
import setupMobileMenu from "./modules/mobile.js";
import setupSearch from "./modules/search.js";
import setupThemeSelector from "./modules/theme.js";
import setupMermaid from "./modules/mermaid.js";
import setupMath from "./modules/math.js";
import setupSidebars from "./modules/sidebar.js";
import api from "./modules/api.js";
import "highlight.js/styles/default.css";
import "@triliumnext/ckeditor5/src/theme/ck-content.css";

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
$try(setupSidebars);

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

// The order of these imports is the order of the bundled stylesheet: a module's CSS is emitted
// where the module is first imported.
import "./base.css";
import setupLayout from "./page/layout.js";
import "./page/header.css";
import setupExpanders from "./page/navigation.js";
import setupThemeSelector from "./page/theme_switch.js";
import setupSearch from "./page/search.js";
import setupToC from "./page/toc.js";
import "./page/child_links.css";
import "./page/footer.css";
import "./content/content.css";
import "./content/footnotes.css";
import "./content/external_links.css";
import "./content/task_states.css";
import "./content/adaptive_colors.css";
import setupLinkEmbeds from "./content/link_embed.js";
import setupMath from "./content/math.js";
import setupMermaid from "./content/mermaid.js";
import api from "./api.js";
import "highlight.js/styles/default.css";
import "@triliumnext/ckeditor5/src/theme/ck-content.css";
import "@triliumnext/ckeditor5/src/theme/tabs.css";
import "@triliumnext/ckeditor5/src/theme/multicolumn.css";

import { applyTabs, revealFragment } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";

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
$try(setupLayout);
$try(setupSearch);

function setupTextNote() {
    $try(setupMermaid);
    $try(setupMath);
    $try(setupLinkEmbeds);
    $try(setupTabs);
}

document.addEventListener(
    "DOMContentLoaded",
    () => {
        const noteType = determineNoteType();

        if (noteType === "text" || document.querySelector("#content.ck-content")) {
            setupTextNote();
        }

        // Format <time> elements using the browser's locale.
        for (const el of document.querySelectorAll<HTMLTimeElement>("time[datetime]")) {
            const date = new Date(el.dateTime);
            if (!isNaN(date.getTime())) {
                el.textContent = date.toLocaleDateString();
            }
        }
    },
    false
);

function setupTabs() {
    const content = document.getElementById("content");
    if (content) {
        applyTabs(content, { placeholder: content.dataset.tabTitlePlaceholder ?? "" });
    }

    // The browser does not scroll to a fragment inside a hidden panel.
    const showFragment = () => revealFragment(location.hash)?.scrollIntoView();
    showFragment();
    window.addEventListener("hashchange", showFragment);
}

function determineNoteType() {
    const bodyClass = document.body.className;
    const match = bodyClass.match(/type-([^\s]+)/);
    return match ? match[1] : null;
}

// The order of these imports is the order of the bundled stylesheet: a module's CSS is emitted
// where the module is first imported.
import "./base.css";
import setupLayout from "./page/layout.js";
import "./page/header.css";
import setupExpanders, { setupTreeState } from "./page/navigation.js";
import setupThemeSelector from "./page/theme_switch.js";
import setupSearch from "./page/search.js";
import setupToC from "./page/toc.js";
import "./page/child_links.css";
import setupFooter from "./page/footer.js";
import setupSpeculation, { whenActivated } from "./page/speculation.js";
import "./content/content.css";
import "./content/footnotes.css";
import "./content/external_links.css";
import "./content/task_states.css";
import "./content/adaptive_colors.css";
import "./content/link_embed.css";
import setupMath from "./content/math.js";
import setupMermaid from "./content/mermaid.js";
import "virtual:code-themes.css";
import "@triliumnext/ckeditor5/src/theme/ck-content.css";
import "@triliumnext/ckeditor5/src/theme/tabs.css";
import "@triliumnext/ckeditor5/src/theme/multicolumn.css";

import { applyTabs, revealFragment } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { enhanceLinkPreviews } from "@triliumnext/commons/src/lib/link_embed_dom.js";

/** Runs a setup function, logging what it throws or rejects with instead of stopping the others. */
function $try(func: () => unknown) {
    try {
        Promise.resolve(func()).catch(console.error);
    } catch (e) {
        console.error(e);
    }
}

/**
 * Fetches a shared note as JSON, the page's own note by default. Scripts added with `~shareJs` call
 * it as `fetchNote()`.
 */
async function fetchNote(noteId: string | null = null) {
    const resp = await fetch(`api/notes/${noteId ?? document.body.dataset.noteId}`);
    return await resp.json();
}

Object.assign(window, { fetchNote });
// A prerendered page reads the theme and the tree's state once it is shown, not while prerendering.
whenActivated(() => $try(setupThemeSelector));
$try(setupToC);
$try(setupExpanders);
whenActivated(() => $try(setupTreeState));
$try(setupLayout);
$try(setupSearch);
$try(setupFooter);
$try(setupSpeculation);

function setupTextNote() {
    $try(setupMermaid);
    $try(setupMath);
    $try(() => enhanceLinkPreviews(document.body));
    $try(setupTabs);
}

document.addEventListener("DOMContentLoaded", () => {
    const { classList } = document.body;
    if (classList.contains("type-text") || document.querySelector("#content.ck-content")) {
        setupTextNote();
    } else if (classList.contains("type-mermaid")) {
        $try(setupMermaid);
    }
});

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

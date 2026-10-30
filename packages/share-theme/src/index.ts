// The order of these imports is the order of the bundled stylesheet: a module's CSS is emitted
// where the module is first imported.
import "./base.css";
import setupLayout from "./page/layout.js";
import "./page/header.css";
import setupNoteTabs from "./page/note_tabs.js";
import setupTitleRow from "./page/title_row.js";
import setupExpanders from "./page/navigation.js";
import setupThemeSelector from "./page/theme_switch.js";
import setupSearch from "./page/search.js";
import setupToC from "./page/toc.js";
import "./page/child_links.css";
import setupFooter from "./page/footer.js";
import setupSpeculation, { whenActivated } from "./page/speculation.js";
import setupShareEdit from "./page/share_edit.js";
import "./content/content.css";
import "./content/footnotes.css";
import "./content/external_links.css";
import "./content/task_states.css";
import "./content/adaptive_colors.css";
import "./content/link_embed.css";
import "./content/full_height.css";
import "./content/app_view.css";
import setupCodeCopy from "./content/code_copy.js";
import setupMath from "./content/math.js";
import setupAppView from "./content/app_view.js";
import setupMermaid from "./content/mermaid.js";
import "virtual:code-themes.css";
import "@triliumnext/codemirror/src/code_preview.css";
import "@triliumnext/ckeditor5/src/theme/ck-content.css";
import "@triliumnext/ckeditor5/src/theme/scrollable_bar.css";
import "@triliumnext/ckeditor5/src/theme/tabs.css";
import "@triliumnext/ckeditor5/src/theme/multicolumn.css";
import "@triliumnext/ckeditor5/src/theme/collapsible_blocks.css";
import "@triliumnext/ckeditor5/src/theme/table_scroll.css";
import "@triliumnext/ckeditor5/src/theme/table_sticky_header.css";
import "@triliumnext/ckeditor5/src/theme/todo_lists.css";
import "@triliumnext/commons/src/lib/scroll_fade.css";

import {
    applyListItemAlignment
} from "@triliumnext/ckeditor5/src/plugins/list_item_alignment_read_only.js";
import { applyTableScroll } from "@triliumnext/ckeditor5/src/plugins/table_scroll_read_only.js";
import {
    applyStickyTableHeaders
} from "@triliumnext/ckeditor5/src/plugins/table_sticky_header_read_only.js";
import { applyTabs, revealFragment } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { enhanceLinkPreviews } from "@triliumnext/commons/src/lib/link_embed_dom.js";

/**
 * Runs a setup function, logging what it throws or rejects with instead of stopping the others.
 * Returns a promise that settles once the function is done, and never rejects.
 */
function $try(func: () => unknown): Promise<unknown> {
    try {
        return Promise.resolve(func()).catch(console.error);
    } catch (e) {
        console.error(e);
        return Promise.resolve();
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
// A prerendered page reads the theme once it is shown, not while prerendering. `tree.ts` restores
// the tree, before the page is first drawn.
whenActivated(() => $try(setupThemeSelector));
$try(setupToC);
$try(setupExpanders);
$try(setupLayout);
$try(setupTitleRow);
$try(setupNoteTabs);
$try(setupSearch);
$try(setupFooter);
$try(setupSpeculation);

/** Enhances the content of a text note. Returns a promise that settles once diagrams are drawn. */
function setupTextNote() {
    const diagrams = $try(setupMermaid);
    $try(setupMath);
    $try(setupCodeCopy);
    $try(() => enhanceLinkPreviews(document.body));
    $try(setupTableScroll);
    $try(setupStickyTableHeaders);
    $try(setupListItemAlignment);
    $try(setupTabs);
    $try(setupShareEdit);
    return diagrams;
}

document.addEventListener("DOMContentLoaded", () => {
    const { classList } = document.body;
    let diagrams: Promise<unknown> | undefined;
    if (classList.contains("type-text") || document.querySelector("#content.ck-content")) {
        diagrams = setupTextNote();
    } else if (document.querySelector("#content .share-note-view")) {
        $try(() => setupAppView(".share-note-view", () => import("./content/note_view.js")));
    } else if (classList.contains("type-mermaid")) {
        $try(setupMermaid);
    } else if (classList.contains("type-book")) {
        $try(() => setupAppView(".share-collection", () => import("./content/collection_view.js")));
    }
    whenActivated(() => $try(() => showLinkedBlocks(diagrams)));
});

/** Sizes the tables of the content, and those of each note it includes, as the app does. */
function setupTableScroll() {
    const content = document.getElementById("content");
    if (!content) {
        return;
    }

    applyTableScroll(content);
    for (const embed of content.querySelectorAll(".include-note")) {
        applyTableScroll(embed);
    }
}

function setupStickyTableHeaders() {
    const content = document.getElementById("content");
    if (content) {
        applyStickyTableHeaders(content);
    }
}

function setupListItemAlignment() {
    const content = document.getElementById("content");
    if (content) {
        applyListItemAlignment(content);
    }
}

function setupTabs() {
    const content = document.getElementById("content");
    if (content) {
        const { tabTitlePlaceholder, tabPreviousLabel, tabNextLabel } = content.dataset;
        applyTabs(content, {
            placeholder: tabTitlePlaceholder ?? "",
            scrollLabels: { start: tabPreviousLabel ?? "", end: tabNextLabel ?? "" }
        });
    }

    // The browser does not scroll to a fragment inside a hidden panel.
    const showFragment = () => revealFragment(location.hash)?.scrollIntoView();
    showFragment();
    window.addEventListener("hashchange", showFragment);
}

/**
 * Scrolls to the blocks that the `block` URL parameter points at and flashes them, once `diagrams`
 * are drawn: a drawing replaces its code block and changes the height of the page.
 */
async function showLinkedBlocks(diagrams?: Promise<unknown>) {
    const block = new URLSearchParams(location.search).get("block");
    if (block) {
        const [ { showBlockReference } ] = await Promise.all([ import(
            "@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js"
        ), diagrams ]);
        showBlockReference(document.body, block);
    }
}

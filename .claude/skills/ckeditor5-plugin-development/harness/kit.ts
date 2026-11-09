/**
 * Shared by the staged CKEditor CSS comparison harnesses (see `ck_css.mjs stage`). Both sides load
 * today's Trilium stylesheets; only CKEditor's own stylesheet differs, so every difference is one
 * the upgrade causes.
 */
import newFull from "ckeditor5/ckeditor5.css?inline";
import newContent from "ckeditor5/ckeditor5-content.css?inline";

import bootstrap from "../../../node_modules/bootstrap/dist/css/bootstrap.min.css?inline";
import ckTheme from "../../../apps/client/src/stylesheets/ckeditor-theme.css?inline";
import style from "../../../apps/client/src/stylesheets/style.css?inline";
import themeLight from "../../../apps/client/src/stylesheets/theme-light.css?inline";
import themeNextDark from "../../../apps/client/src/stylesheets/theme-next-dark.css?inline";
import themeNextLight from "../../../apps/client/src/stylesheets/theme-next-light.css?inline";
import shareBase from "../../share-theme/src/base.css?inline";
import shareAdaptive from "../../share-theme/src/content/adaptive_colors.css?inline";
import shareContent from "../../share-theme/src/content/content.css?inline";
import shareFootnotes from "../../share-theme/src/content/footnotes.css?inline";
import shareTasks from "../../share-theme/src/content/task_states.css?inline";
import admonitions from "./theme/admonitions.css?inline";
import blockquote from "./theme/blockquote.css?inline";
import ckContentRaw from "./theme/ck-content.css?raw";
import codeBlockToolbar from "./theme/code_block_toolbar.css?inline";
import contentColors from "./theme/content_colors.css?inline";
import todoLists from "./theme/todo_lists.css?inline";
import oldFull from "./zz_ckcss_old.css?inline";
import oldContent from "./zz_ckcss_old_content.css?inline";

export type Side = "old" | "new";

/** What `src/index.ts` imports after `ckeditor5/ckeditor5.css`. Keep in step with it. */
const PACKAGE_LAYER = [ blockquote, contentColors, codeBlockToolbar ];
/** `ck-content.css` without its `@import`s, which the share and export contexts load explicitly. */
const CK_CONTENT_REST = ckContentRaw.replace(/@import[^;]*;/g, "");

/** The stylesheets of each place CKEditor's CSS reaches, in the order the real page loads them. */
export const CONTEXTS: Record<string, (side: Side) => string[]> = {
    /** The client, in the order `apps/client/src/index.ts` appends them, light Next theme. */
    app: (side) => [ full(side), ...PACKAGE_LAYER, bootstrap, ckTheme, themeLight, themeNextLight, style ],
    "app-dark": (side) => [ full(side), ...PACKAGE_LAYER, bootstrap, ckTheme, themeLight, themeNextDark, style ],
    /** A shared page: `ck-content.css` and the share theme's content stylesheets. */
    share: (side) => [ content(side), contentColors, CK_CONTENT_REST, admonitions, todoLists,
        shareBase, shareContent, shareFootnotes, shareTasks, shareAdaptive ],
    /** An HTML export: what `apps/server/src/services/export/zip/factory.ts` concatenates. */
    export: (side) => [ content(side), contentColors ]
};

function full(side: Side) { return side === "old" ? oldFull : newFull; }
function content(side: Side) { return side === "old" ? oldContent : newContent; }

/** Mounts stylesheets (transitions off, so computed values are final) and returns their remover. */
export function mountStyles(css: string[]) {
    const elements = [ ...css, "* { transition: none !important; }" ].map((text) => {
        const element = document.createElement("style");
        element.textContent = text;
        document.head.appendChild(element);
        return element;
    });
    return () => { for (const element of elements) element.remove(); };
}

export function computed(element: Element, props: string[]) {
    const cs = getComputedStyle(element);
    return Object.fromEntries(props.map((p) => [ p, cs.getPropertyValue(p) ]));
}

/** Prints `DIFF <context> | <key> | <prop>: <old> → <new>` for every value that changed. */
export function report(context: string, before: Record<string, Record<string, string>>, after: Record<string, Record<string, string>>) {
    let changes = 0;
    for (const key of Object.keys(before)) {
        for (const prop of Object.keys(before[key])) {
            if (before[key][prop] === after[key]?.[prop]) continue;
            console.log(`DIFF ${context} | ${key} | ${prop}: ${before[key][prop]}  →  ${after[key]?.[prop]}`);
            changes++;
        }
    }
    if (!changes) console.log(`SAME ${context} | ${Object.keys(before).length} element(s) unchanged`);
}

/**
 * Prints `RULE` for every rule that matches `element` and sets one of `props`, with nested
 * selectors resolved against their parents. Answers "which rule produced this value".
 */
export function probe(label: string, element: Element, props: string[]) {
    for (const [ index, sheet ] of [ ...document.styleSheets ].entries()) {
        const walk = (rules: CSSRuleList, parentSelector: string | null) => {
            for (const rule of [ ...rules ]) {
                if (rule instanceof CSSStyleRule) {
                    const selector = resolveNested(rule.selectorText, parentSelector);
                    let matches = false;
                    try { matches = element.matches(selector); } catch { /* an unsupported selector */ }
                    const set = props.filter((p) => rule.style.getPropertyValue(p))
                        .map((p) => `${p}: ${rule.style.getPropertyValue(p)}`);
                    if (matches && set.length) console.log(`RULE ${label} | sheet ${index} | ${selector} | ${set.join("; ")}`);
                    if (rule.cssRules.length) walk(rule.cssRules, selector);
                } else if ("cssRules" in rule) {
                    walk((rule as CSSGroupingRule).cssRules, parentSelector);
                }
            }
        };
        walk(sheet.cssRules, null);
    }
}

function resolveNested(selector: string, parent: string | null) {
    if (!parent) return selector;
    return selector.split(",").map((part) => {
        const trimmed = part.trim();
        return trimmed.includes("&") ? trimmed.replaceAll("&", `:is(${parent})`) : `:is(${parent}) ${trimmed}`;
    }).join(", ");
}

import { ensureMimeTypes, highlight, highlightAuto, loadTheme, Themes, type AutoHighlightResult, type HighlightResult, type Theme } from "@triliumnext/highlightjs";
import mime_types from "./mime_types.js";
import options from "./options.js";
import { t } from "./i18n.js";
import { copyText, copyTextWithToast } from "./clipboard_ext.js";
import { isShare } from "./utils.js";
import { MimeType } from "@triliumnext/commons";

let highlightingLoaded = false;

/**
 * Identifies all the code blocks (as `pre code`) under the specified hierarchy and uses the highlight.js library to obtain the highlighted text which is then applied on to the code blocks.
 * Additionally, adds a "Copy to clipboard" button.
 *
 * @param $container the container under which to look for code blocks and to apply syntax highlighting to them.
 */
export async function formatCodeBlocks($container: JQuery<HTMLElement>) {
    const syntaxHighlightingEnabled = isSyntaxHighlightEnabled();

    const codeBlocks = $container.find("pre code");
    for (const codeBlock of codeBlocks) {
        const normalizedMimeType = extractLanguageFromClassList(codeBlock);
        if (!normalizedMimeType) {
            continue;
        }

        if (glob.device !== "print") {
            applyCopyToClipboardButton($(codeBlock));
        }

        if (syntaxHighlightingEnabled) {
            applySingleBlockSyntaxHighlight($(codeBlock), normalizedMimeType);
        }
    }
}

export function applyCopyToClipboardButton($codeBlock: JQuery<HTMLElement>) {
    const $copyButton = $("<button>")
        .addClass("bx component icon-action tn-tool-button bx-copy copy-button")
        .attr("title", t("code_block.copy_title"))
        .on("click", (e) => {
            e.stopPropagation();

            if (!isShare) {
                copyTextWithToast($codeBlock.text());
            } else {
                copyText($codeBlock.text());
            }
        });
    $codeBlock.parent().append($copyButton);
}

/**
 * Applies syntax highlight to the given code block (assumed to be <pre><code>), using highlight.js.
 */
export async function applySingleBlockSyntaxHighlight($codeBlock: JQuery<HTMLElement>, normalizedMimeType: string) {
    $codeBlock.parent().toggleClass("hljs");
    const text = $codeBlock.text();

    let highlightedText: HighlightResult | AutoHighlightResult | null = null;
    if (normalizedMimeType === mime_types.MIME_TYPE_AUTO && !isShare) {
        await ensureMimeTypesForHighlighting();
        highlightedText = highlightAuto(text);
    } else if (normalizedMimeType) {
        await ensureMimeTypesForHighlighting(normalizedMimeType);
        try {
            highlightedText = highlight(text, { language: normalizedMimeType });
        } catch (e) {
            console.warn("Unable to apply syntax highlight.", e);
        }
    }

    if (highlightedText) {
        $codeBlock.html(highlightedText.value);
    }
}

export async function ensureMimeTypesForHighlighting(mimeTypeHint?: string) {
    if (highlightingLoaded) {
        return;
    }

    // Load theme.
    const currentThemeName = String(options.get("codeBlockTheme"));
    await loadHighlightingTheme(currentThemeName);

    // Load mime types.
    let mimeTypes: MimeType[];

    if (mimeTypeHint) {
        mimeTypes = [
            {
                title: mimeTypeHint,
                enabled: true,
                mime: mimeTypeHint.replace("-", "/")
            }
        ]
    } else {
        mimeTypes = mime_types.getMimeTypes();
    }

    await ensureMimeTypes(mimeTypes);

    highlightingLoaded = true;
}

export async function loadHighlightingTheme(themeName: string) {
    const themePrefix = "default:";
    let theme: Theme | null = null;
    if (glob.device === "print") {
        theme = Themes.vs;
    } else if (themeName.includes(themePrefix)) {
        theme = Themes[themeName.substring(themePrefix.length)];
    }

    await loadTheme(theme ?? Themes.default);
}

/**
 * Indicates whether syntax highlighting should be enabled for code blocks, by querying the value of the `codeblockTheme` option.
 * @returns whether syntax highlighting should be enabled for code blocks.
 */
export function isSyntaxHighlightEnabled() {
    if (!isShare) {
        const theme = options.get("codeBlockTheme");
        return !!theme && theme !== "none";
    } else {
        return true;
    }
}

/**
 * Given a HTML element, tries to extract the `language-` class name out of it.
 *
 * @param el the HTML element from which to extract the language tag.
 * @returns the normalized MIME type (e.g. `text-css` instead of `language-text-css`).
 */
function extractLanguageFromClassList(el: HTMLElement) {
    const prefix = "language-";
    for (const className of el.classList) {
        if (className.startsWith(prefix)) {
            return className.substring(prefix.length);
        }
    }

    return null;
}

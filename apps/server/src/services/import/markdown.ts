

import { getMimeTypeFromMarkdownName, MIME_TYPE_AUTO } from "@triliumnext/commons";
import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { parse, Renderer, type Tokens,use } from "marked";

import { ADMONITION_TYPE_MAPPINGS } from "../export/markdown.js";
import htmlSanitizer from "../html_sanitizer.js";
import utils from "../utils.js";
import wikiLinkInternalLink from "./markdown/wikilink_internal_link.js";
import wikiLinkTransclusion from "./markdown/wikilink_transclusion.js";
import importUtils from "./utils.js";

const escape = utils.escapeHtml;

/**
 * Keep renderer code up to date with https://github.com/markedjs/marked/blob/master/src/Renderer.ts.
 */
class CustomMarkdownRenderer extends Renderer {

    override heading(data: Tokens.Heading): string {
        // Treat h1 as raw text.
        if (data.depth === 1) {
            return `<h1>${data.text}</h1>`;
        }

        return super.heading(data).trimEnd();
    }

    override paragraph(data: Tokens.Paragraph): string {
        return super.paragraph(data).trimEnd();
    }

    override code({ text, lang }: Tokens.Code): string {
        if (!text) {
            return "";
        }

        // Escape the HTML.
        text = escape(text);

        // Unescape &quot
        text = text.replace(/&quot;/g, '"');

        const ckEditorLanguage = getNormalizedMimeFromMarkdownLanguage(lang);
        return `<pre><code class="language-${ckEditorLanguage}">${text}</code></pre>`;
    }

    override list(token: Tokens.List): string {
        let result = super.list(token)
            .replace("\n", "")  // we replace the first one only.
            .trimEnd();

        // Handle todo-list in the CKEditor format.
        if (token.items.some(item => item.task)) {
            result = result.replace(/^<ul>/, "<ul class=\"todo-list\">");
        }

        return result;
    }

    override checkbox({ checked }: Tokens.Checkbox): string {
        return `<input type="checkbox"${
            checked ? 'checked="checked" ' : ''
        }disabled="disabled">`;
    }

    override listitem(item: Tokens.ListItem): string {
        // Handle todo-list in the CKEditor format.
        if (item.task) {
            let itemBody = '';
            const checkbox = this.checkbox({ checked: !!item.checked, raw: "- [ ]", type: "checkbox" });
            if (item.loose) {
                if (item.tokens[0]?.type === 'paragraph') {
                    item.tokens[0].text = checkbox + item.tokens[0].text;
                    if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === 'text') {
                        item.tokens[0].tokens[0].text = checkbox + escape(item.tokens[0].tokens[0].text);
                        item.tokens[0].tokens[0].escaped = true;
                    }
                } else {
                    item.tokens.unshift({
                        type: 'text',
                        raw: checkbox,
                        text: checkbox,
                        escaped: true,
                    });
                }
            } else {
                itemBody += checkbox;
            }

            itemBody += `<span class="todo-list__label__description">${this.parser.parse(item.tokens.filter(t => t.type !== "checkbox"))}</span>`;
            return `<li><label class="todo-list__label">${itemBody}</label></li>`;
        }

        return super.listitem(item).trimEnd();
    }

    override image(token: Tokens.Image): string {
        return super.image(token)
            .replace(` alt=""`, "");
    }

    override blockquote({ tokens }: Tokens.Blockquote): string {
        const body = renderer.parser.parse(tokens);

        const admonitionMatch = /^<p>\[\!([A-Z]+)\]/.exec(body);
        if (Array.isArray(admonitionMatch) && admonitionMatch.length === 2) {
            const type = admonitionMatch[1].toLowerCase();

            if (ADMONITION_TYPE_MAPPINGS[type]) {
                const bodyWithoutHeader = body
                    .replace(/^<p>\[\!([A-Z]+)\]\s*/, "<p>")
                    .replace(/^<p><\/p>/, ""); // Having a heading will generate an empty paragraph that we need to remove.

                return `<aside class="admonition ${type}">${bodyWithoutHeader.trim()}</aside>`;
            }
        }

        return `<blockquote>${body}</blockquote>`;
    }

    codespan({ text }: Tokens.Codespan): string {
        return `<code spellcheck="false">${escape(text)}</code>`;
    }

}

function renderToHtml(content: string, title: string) {
    // Double-escape slashes in math expression because they are otherwise consumed by the parser somewhere.
    content = content.replaceAll("\\$", "\\\\$");

    // Extract formulas and replace them with placeholders to prevent interference from Markdown rendering
    const { processedText, placeholderMap: formulaMap } = extractFormulas(content);

    use({
        // Order is important, especially for wikilinks.
        extensions: [
            wikiLinkTransclusion,
            wikiLinkInternalLink
        ]
    });

    let html = parse(processedText, {
        async: false,
        renderer
    }) as string;

    // After rendering, replace placeholders back with the formula HTML
    html = restoreFromMap(html, formulaMap);

    // h1 handling needs to come before sanitization
    html = importUtils.handleH1(html, title);
    html = htmlSanitizer.sanitize(html);

    // Add a trailing semicolon to CSS styles.
    html = html.replaceAll(/(<(img|figure|col).*?style=".*?)"/g, "$1;\"");

    // Remove slash for self-closing tags to match CKEditor's approach.
    html = html.replace(/<(\w+)([^>]*)\s+\/>/g, "<$1$2>");

    // Normalize non-breaking spaces to entity.
    html = html.replaceAll("\u00a0", "&nbsp;");

    return html;
}

function getNormalizedMimeFromMarkdownLanguage(language: string | undefined) {
    if (language) {
        const mimeDefinition = getMimeTypeFromMarkdownName(language);
        if (mimeDefinition) {
            return normalizeMimeTypeForCKEditor(mimeDefinition.mime);
        }
    }

    return MIME_TYPE_AUTO;
}

function extractCodeBlocks(text: string): { processedText: string, placeholderMap: Map<string, string> } {
    const codeMap = new Map<string, string>();
    let id = 0;
    const timestamp = Date.now();

    // Multi-line code block and Inline code
    text = text.replace(/```[\s\S]*?```/g, (m) => {
        const key = `<!--CODE_BLOCK_${timestamp}_${id++}-->`;
        codeMap.set(key, m);
        return key;
    }).replace(/`[^`\n]+`/g, (m) => {
        const key = `<!--INLINE_CODE_${timestamp}_${id++}-->`;
        codeMap.set(key, m);
        return key;
    });

    return { processedText: text, placeholderMap: codeMap };
}

function extractFormulas(text: string): { processedText: string, placeholderMap: Map<string, string> } {
    // Protect the $ signs inside code blocks from being recognized as formulas.
    const { processedText: noCodeText, placeholderMap: codeMap } = extractCodeBlocks(text);

    const formulaMap = new Map<string, string>();
    let id = 0;
    const timestamp = Date.now();

    // Display math and Inline math
    let processedText = noCodeText.replace(/(?<!\\)\$\$((?:(?!\n{2,})[\s\S])+?)\$\$/g, (_, formula) => {
        const key = `<!--FORMULA_BLOCK_${timestamp}_${id++}-->`;
        const rendered = `<span class="math-tex">\\[${formula}\\]</span>`;
        formulaMap.set(key, rendered);
        return key;
    }).replace(/(?<!\\)\$(.+?)\$/g, (_, formula) => {
        const key = `<!--FORMULA_INLINE_${timestamp}_${id++}-->`;
        const rendered = `<span class="math-tex">\\(${formula}\\)</span>`;
        formulaMap.set(key, rendered);
        return key;
    });

    processedText = restoreFromMap(processedText, codeMap);

    return { processedText, placeholderMap: formulaMap };
}

function restoreFromMap(text: string, map: Map<string, string>): string {
    if (map.size === 0) return text;
    const pattern = [...map.keys()]
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    return text.replace(new RegExp(pattern, 'g'), match => map.get(match) ?? match);
}

const renderer = new CustomMarkdownRenderer({ async: false });

export default {
    renderToHtml
};

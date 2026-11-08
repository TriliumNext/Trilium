/**
 * Colors of a VS Code highlight.js theme, by the role a token plays. The values are those of the
 * `@fsegurai/codemirror-theme-vscode-*` themes code notes use, so a code block in a text note and a
 * code note color the same token alike.
 */
export interface VsCodePalette {
    foreground: string;
    background: string;
    keyword: string;
    controlKeyword: string;
    type: string;
    function: string;
    variable: string;
    number: string;
    string: string;
    regexp: string;
    comment: string;
    meta: string;
    selector: string;
    emphasis: string;
    link: string;
    deleted: string;
}

export const VS_CODE_LIGHT: VsCodePalette = {
    foreground: "#383a42",
    background: "#ffffff",
    keyword: "#0064ff",
    controlKeyword: "#af00db",
    type: "#267f99",
    function: "#795e26",
    variable: "#0070c1",
    number: "#098658",
    string: "#a31515",
    regexp: "#af00db",
    comment: "#008000",
    meta: "#6b6b6b",
    selector: "#795e26",
    emphasis: "#0070c1",
    link: "#006ab1",
    deleted: "#e51400"
};

export const VS_CODE_DARK: VsCodePalette = {
    foreground: "#d4d4d4",
    background: "#1e1e1e",
    keyword: "#569cd6",
    controlKeyword: "#c586c0",
    type: "#4ec9b0",
    function: "#dcdcaa",
    variable: "#9cdcfe",
    number: "#b5cea8",
    string: "#ce9178",
    regexp: "#d16969",
    comment: "#6a9955",
    meta: "#838383",
    selector: "#d7ba7d",
    emphasis: "#4ec9b0",
    link: "#3794ff",
    deleted: "#f44747"
};

/**
 * Writes the highlight.js stylesheet for a VS Code palette.
 *
 * @param scope a selector every rule is nested under, such as `:where(html.theme-dark)`.
 */
export function buildVsCodeThemeCss(palette: VsCodePalette, scope?: string) {
    const rules: [ string[], string ][] = [
        [ [ ".hljs" ], `color: ${palette.foreground}; background: ${palette.background};` ],
        [ [
            ".hljs-keyword", ".hljs-literal", ".hljs-variable.language_", ".hljs-template-tag",
            ".hljs-selector-tag", ".hljs-name"
        ], `color: ${palette.keyword};` ],
        [ [ ".hljs-meta .hljs-keyword" ], `color: ${palette.controlKeyword};` ],
        [ [
            ".hljs-built_in", ".hljs-type", ".hljs-title.class_", ".hljs-title.class_.inherited__"
        ], `color: ${palette.type};` ],
        [ [ ".hljs-title", ".hljs-title.function_" ], `color: ${palette.function};` ],
        [ [
            ".hljs-variable", ".hljs-params", ".hljs-property", ".hljs-attr", ".hljs-attribute",
            ".hljs-template-variable", ".hljs-variable.constant_"
        ], `color: ${palette.variable};` ],
        [ [ ".hljs-number", ".hljs-symbol" ], `color: ${palette.number};` ],
        [ [
            ".hljs-string", ".hljs-addition", ".hljs-char.escape_", ".hljs-meta .hljs-string",
            ".hljs-code"
        ], `color: ${palette.string};` ],
        [ [ ".hljs-regexp" ], `color: ${palette.regexp};` ],
        [ [ ".hljs-comment", ".hljs-quote" ], `color: ${palette.comment}; font-style: italic;` ],
        [ [ ".hljs-doctag" ], `color: ${palette.comment}; font-weight: bold;` ],
        [ [ ".hljs-meta" ], `color: ${palette.meta};` ],
        [ [
            ".hljs-selector-id", ".hljs-selector-class", ".hljs-selector-attr",
            ".hljs-selector-pseudo"
        ], `color: ${palette.selector};` ],
        [ [ ".hljs-section", ".hljs-bullet" ], `color: ${palette.keyword}; font-weight: bold;` ],
        [ [ ".hljs-strong" ], `color: ${palette.keyword}; font-weight: bold;` ],
        [ [ ".hljs-emphasis" ], `color: ${palette.emphasis}; font-style: italic;` ],
        [ [ ".hljs-link" ], `color: ${palette.link}; text-decoration: underline;` ],
        [ [ ".hljs-deletion" ], `color: ${palette.deleted};` ],
        // The block layout every highlight.js theme carries.
        [ [ "pre code.hljs" ], "display: block; overflow-x: auto; padding: 1em;" ],
        [ [ "code.hljs" ], "padding: 3px 5px;" ]
    ];

    return rules
        .map(([ selectors, declarations ]) => {
            const scoped = scope ? selectors.map((selector) => `${scope} ${selector}`) : selectors;
            return `${scoped.join(", ")} { ${declarations} }`;
        })
        .join("\n");
}

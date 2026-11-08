import { defaultHighlightStyle, HighlightStyle, type TagStyle } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** A CodeMirror theme reduced to what a static code preview needs. */
export interface PreviewTheme {
    /** The ID of the theme in `ColorThemes`, or `"default"` for `defaultHighlightStyle`. */
    id: string;
    /** The token styles of the theme, in the order of its `HighlightStyle`. */
    styles: readonly TagStyle[];
    colors: PreviewThemeColors;
}

/** The colors of the editor that a theme sets, as CSS values. */
export interface PreviewThemeColors {
    background?: string;
    foreground?: string;
    gutterBackground?: string;
    gutterForeground?: string;
    gutterBorderWidth?: string;
    gutterBorderColor?: string;
    lineHeight?: string;
}

/** A theme of a code preview, and the prefix of the class names it gives the tokens. */
export interface PreviewThemeSlot {
    theme: PreviewTheme;
    key: string;
}

const COLOR_VARIABLES: Record<keyof PreviewThemeColors, string> = {
    background: "--code-preview-background",
    foreground: "--code-preview-foreground",
    gutterBackground: "--code-preview-gutter-background",
    gutterForeground: "--code-preview-gutter-foreground",
    gutterBorderWidth: "--code-preview-gutter-border-width",
    gutterBorderColor: "--code-preview-gutter-border-color",
    lineHeight: "--code-preview-line-height"
};

const EDITOR_RULE = /^\.[^\s.,]+ \{(.*)\}$/;
const GUTTERS_RULE = /^\.[^\s.,]+ \.cm-gutters \{(.*)\}$/;
const CONTENT_RULE = /^\.[^\s.,]+ \.cm-content \{(.*)\}$/;

/** Reads the token styles and the editor colors of the CodeMirror theme `extension`. */
export function readPreviewTheme(id: string, extension: Extension): PreviewTheme {
    const highlightStyle = findHighlightStyle(extension) ?? defaultHighlightStyle;
    const rules = EditorState.create({ extensions: extension })
        .facet(EditorView.styleModule)
        .filter((module) => module !== highlightStyle.module)
        .flatMap((module) => module.getRules().split("\n"));
    const editor = readDeclarations(rules, EDITOR_RULE);
    const gutters = readDeclarations(rules, GUTTERS_RULE);
    const content = readDeclarations(rules, CONTENT_RULE);
    const border = /^(\S+) solid (.+)$/.exec(gutters.get("border-right") ?? "");

    return {
        id,
        styles: highlightStyle.specs,
        colors: {
            background: editor.get("background-color"),
            foreground: editor.get("color"),
            gutterBackground: gutters.get("background-color"),
            gutterForeground: gutters.get("color"),
            gutterBorderWidth: border?.[1],
            gutterBorderColor: border?.[2],
            lineHeight: content.get("line-height")
        }
    };
}

/**
 * Returns the CSS that colors the previews rendered with `slot`.
 *
 * @param scope a selector the rules are nested under, such as `:where(html.theme-dark)`.
 */
export function buildCodePreviewCss({ theme, key }: PreviewThemeSlot, scope?: string) {
    const root = `${scope ? `${scope} ` : ""}.code-preview[data-code-theme-${key}="${theme.id}"]`;
    const variables = Object.entries(theme.colors)
        .filter(([ , value ]) => value !== undefined)
        .map(([ name, value ]) => {
            const variable = COLOR_VARIABLES[name as keyof PreviewThemeColors];
            return `${variable}: ${value};`;
        });
    const rules = [ `${root} { ${variables.join(" ")} }` ];
    for (const [ index, style ] of theme.styles.entries()) {
        rules.push(`${root} .${key}${index} { ${toDeclarations(style)} }`);
    }
    return rules.join("\n");
}

/** Finds the `HighlightStyle` that `syntaxHighlighting()` adds to `extension` as a facet value. */
function findHighlightStyle(extension: Extension): HighlightStyle | undefined {
    if (Array.isArray(extension)) {
        for (const child of extension) {
            const style = findHighlightStyle(child);
            if (style) return style;
        }
        return undefined;
    }

    const { value } = extension as { value?: unknown };
    return value instanceof HighlightStyle ? value : undefined;
}

/** Reads the declarations of the first rule in `rules` that `pattern` matches, by property. */
function readDeclarations(rules: string[], pattern: RegExp) {
    const declarations = new Map<string, string>();
    const body = rules.map((rule) => pattern.exec(rule)?.[1]).find((match) => match !== undefined);
    for (const declaration of (body ?? "").split(";")) {
        const separator = declaration.indexOf(":");
        if (separator > 0) {
            declarations.set(
                declaration.slice(0, separator).trim(),
                declaration.slice(separator + 1).trim()
            );
        }
    }
    return declarations;
}

function toDeclarations(style: TagStyle) {
    return Object.entries(style)
        .filter(([ name ]) => name !== "tag" && name !== "class")
        .map(([ name, value ]) => `${toKebabCase(name)}: ${value};`)
        .join(" ");
}

function toKebabCase(name: string) {
    return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

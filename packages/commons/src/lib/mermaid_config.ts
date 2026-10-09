/** The Mermaid themes a page can ask for through its `--mermaid-theme` CSS variable. */
export type MermaidTheme = "default" | "base" | "dark" | "forest" | "neutral";

const MERMAID_THEMES: ReadonlySet<string> = new Set<MermaidTheme>([ "default", "base", "dark", "forest", "neutral" ]);

/**
 * The Mermaid configuration every render path shares: the editor, read-only notes, Mermaid notes
 * and the share theme. Typed without Mermaid's own types so that commons need not depend on it;
 * the client returns it as `MermaidConfig`, which checks the shape.
 */
export function getMermaidConfig(theme: MermaidTheme) {
    return {
        theme,
        // Mermaid 12 made ELK the default layout and `neo` the default look. Both are pinned to the
        // pre-12 values so diagrams already stored in notes keep rendering as they were written;
        // front matter still overrides either one per diagram.
        layout: "dagre",
        look: "classic",
        securityLevel: "antiscript",
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
        gantt: { useMaxWidth: false },
        class: { useMaxWidth: false },
        state: { useMaxWidth: false },
        pie: { useMaxWidth: true },
        journey: { useMaxWidth: false },
        gitGraph: { useMaxWidth: false }
    } as const;
}

/** Reads a `--mermaid-theme` value, falling back to `default` when it is empty or unknown. */
export function parseMermaidTheme(value: string): MermaidTheme {
    const theme = value.trim();
    return MERMAID_THEMES.has(theme) ? theme as MermaidTheme : "default";
}

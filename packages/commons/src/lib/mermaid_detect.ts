/**
 * Heuristic for recognizing Mermaid diagram source that was imported without an
 * explicit `mermaid` fence language (common in docs that use unlabeled ``` fences).
 *
 * Looks at the first meaningful line after optional YAML front-matter and
 * `%%{…}%%` init directives — matching Mermaid's own diagram-type keywords.
 */
const MERMAID_DIAGRAM_START =
    /^(?:flowchart|graph(?:\s|$)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey(?:-beta)?|xychart(?:-beta)?|block(?:-beta)?|packet(?:-beta)?|architecture(?:-beta)?|radar(?:-beta)?|treemap(?:-beta)?|zenuml)\b/i;

export function looksLikeMermaidDiagram(source: string | null | undefined): boolean {
    if (!source) {
        return false;
    }

    let text = source.trim();
    if (!text) {
        return false;
    }

    // Strip optional YAML front-matter Mermaid accepts before the diagram type.
    text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
    // Strip one or more %%{init}%% / %% comment %% directive blocks at the top.
    text = text.replace(/^(?:%%[\s\S]*?%%\s*)+/, "");

    const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("%%"));

    return !!firstLine && MERMAID_DIAGRAM_START.test(firstLine);
}

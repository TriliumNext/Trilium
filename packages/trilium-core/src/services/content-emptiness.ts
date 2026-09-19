/**
 * Whether a note's string content carries no user-visible text.
 *
 * A text note "emptied" in the editor does not store an empty string: the
 * editor serializes its empty paragraph, so the blob holds something like
 * `<p>&nbsp;</p>` or `<p><br></p>`. Checks that compare raw content against
 * "" therefore treat an emptied note as having content (#10908).
 */

const BLOCK_SCAFFOLDING_TAG_RE = /<\/?(?:p|div|span|br|h[1-6]|ul|ol|li)(?:\s[^>]*)?\/?>/gi

/** Empty-string forms the editor and HTML sources produce for a blank line. */
const HTML_BLANK_ENTITIES_RE = /(?:&nbsp;|&#160;|&#xa0;)/gi

/** Also treats a bare `data-`-only attribute payload as whitespace-grade noise. */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

export function isVisuallyEmptyTextContent(content: string): boolean {
    const stripped = content
        .replace(HTML_COMMENT_RE, "")
        .replace(BLOCK_SCAFFOLDING_TAG_RE, "")
        .replace(HTML_BLANK_ENTITIES_RE, " ")
    return stripped.trim().length === 0
}

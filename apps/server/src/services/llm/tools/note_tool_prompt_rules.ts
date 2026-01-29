export const NOTE_WRITE_RULES = `MUST follow Trilium note rules:
- Text note (type "text", mime "text/html"): content MUST be HTML (no Markdown). Allowed tags: p, br, h1-h5, ul, ol, li, table, thead, tbody, tr, th, td, blockquote, strong, em, code, pre, kbd, sup, sub, hr, img, a.
- Internal links (create backlinks): use <a class="reference-link" href="#root/<notePath>">Title</a>. Use noteId/notePath; do not use external URLs for internal notes.
- Code note (type "code"): content is plain text. Set mime to match language (text/plain, application/json, text/javascript, text/css, etc.).
- Mermaid note (type "mermaid", mime "text/mermaid"): content is Mermaid syntax only.
- Canvas/Mind Map/Relation Map (types "canvas"/"mindMap"/"relationMap"): content is JSON; only create/update if the user provides or explicitly requests the JSON format.
- Render note (type "render"): content is empty; use a relation attribute named renderNote pointing to an HTML/JSX code note to render.
- Saved Search (type "search"): content is a search query, not HTML.
- Web View (type "webView"): set label #webViewSrc with the URL; do not embed HTML.
- Reserved types (file/image/doc/aiChat/contentWidget/launcher) must not be created via tools; use import/attachment workflows instead.
- There is no dedicated "folder" type; any note can have children.`;

export const NOTE_READ_RULES = `When reading notes:
- Text note content is HTML (not Markdown). Preserve HTML when quoting or summarizing.
- Internal links use <a class="reference-link" href="#root/<notePath>">; backlinks are automatic.
- Non-text types may return JSON or binary content (canvas/mindMap/relationMap/mermaid/file/image); do not interpret them as HTML.
- If you need render/web view/search behavior, request attributes (renderNote, webViewSrc, searchHome) via includeAttributes.`;

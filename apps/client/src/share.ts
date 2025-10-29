import "normalize.css";
import "boxicons/css/boxicons.min.css";
import "@triliumnext/ckeditor5/src/theme/ck-content.css";
import "@triliumnext/share-theme/styles/index.css";
import "@triliumnext/share-theme/scripts/index.js";

async function ensureJQuery() {
    const $ = (await import("jquery")).default;
    (window as any).$ = $;
}

async function formatCodeBlocks() {
    const anyCodeBlock = document.querySelector("#content pre");
    if (!anyCodeBlock) {
        return;
    }
    await ensureJQuery();
    const { formatCodeBlocks } = await import("./services/syntax_highlight.js");
    await formatCodeBlocks($("#content"));
}

async function setupTextNote() {
    formatCodeBlocks();
}

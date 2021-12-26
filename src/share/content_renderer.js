const {JSDOM} = require("jsdom");
const NO_CONTENT = '<p>This note has no content.</p>';
const shaca = require("./shaca/shaca");

function getChildrenList(note) {
    if (note.hasChildren()) {
        const document = new JSDOM().window.document;

        const ulEl = document.createElement("ul");

        for (const childNote of note.getChildNotes()) {
            const li = document.createElement("li");
            const link = document.createElement("a");
            link.appendChild(document.createTextNode(childNote.title));
            link.setAttribute("href", childNote.noteId);

            li.appendChild(link);
            ulEl.appendChild(li);
        }

        return '<p>Child notes:</p>' + ulEl.outerHTML;
    }
    else {
        return '';
    }
}

function getContent(note) {
    let content = note.getContent();

    if (note.type === 'text') {
        const document = new JSDOM(content || "").window.document;

        const isEmpty = document.body.textContent.trim().length === 0
            && document.querySelectorAll("img").length === 0;

        if (isEmpty) {
            content = NO_CONTENT;
        }
        else {
            for (const linkEl of document.querySelectorAll("a")) {
                const href = linkEl.getAttribute("href");

                if (href?.startsWith("#")) {
                    const notePathSegments = href.split("/");

                    const noteId = notePathSegments[notePathSegments.length - 1];
                    const linkedNote = shaca.getNote(noteId);

                    if (linkedNote) {
                        linkEl.setAttribute("href", linkedNote.shareId);
                    }
                    else {
                        linkEl.removeAttribute("href");
                    }
                }
            }

            content = document.body.innerHTML;
 
            if (content.includes(`<span class="math-tex">`)) {
                content += `<script src="../../libraries/katex/katex.min.js"></script>`;
                content += `<link rel="stylesheet" href="../../libraries/katex/katex.min.css">`;
                content += `<script src="../../libraries/katex/auto-render.min.js" onload="renderMathInElement(document.getElementById('content'));"></script>`;
                content += `<script src="../../libraries/katex/mhchem.min.js"></script>`;
            }
        }
    }
    else if (note.type === 'code') {
        if (!content?.trim()) {
            content = NO_CONTENT;
        }
        else {
            content = `<textarea style="width:100px;" id="code">${content}</textarea>`
            content += `<link rel="stylesheet" href="../../libraries/codemirror/codemirror.css">`
            content += `<script src="../../libraries/codemirror/codemirror.js" onload="var editor = CodeMirror.fromTextArea(document.getElementById('code'), {lineNumbers: true, lineWrapping: true});"></script>`
        }
    }
    else if (note.type === 'mermaid') {
        content = `<div class=\"mermaid\">${content}</div><script src=\"../../libraries/mermaid.min.js\"></script><hr><details><summary>Chart source</summary><pre>${content}</pre></details>`
        }
    else if (note.type === 'image') {
        content = `<img src="api/images/${note.noteId}/${note.title}?${note.utcDateModified}">`;
    }
    else if (note.type === 'file') {
        if (note.mime === 'application/pdf') {
            content = `<iframe class="pdf-view" src="api/notes/${note.noteId}/view"></iframe>`
        }
        else {
            content = `<button type="button" onclick="location.href='api/notes/${note.noteId}/download'">Download file</button>`;
        }
    }
    else {
        content = '<p>This note type cannot be displayed.</p>';
    }
    var child = getChildrenList(note);
    content += child === '' ? '' : `<hr>${child}`;

    return content;
}

module.exports = {
    getContent
};



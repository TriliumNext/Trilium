import type { ModelElement, ModelPosition, ModelWriter } from "ckeditor5";
import type { ModelNode, Editor } from "ckeditor5";
import { Plugin } from "ckeditor5";

interface SpanStackEntry {
    className: string;
    posStart: ModelPosition;
}

/*
 * This code is an adaptation of https://github.com/antoniotejada/Trilium-SyntaxHighlightWidget with additional improvements, such as:
 *
 *  - support for selecting the language manually;
 *  - support for determining the language automatically, if a special language is selected ("Auto-detected");
 *  - limit for highlighting.
 */

export default class SyntaxHighlighting extends Plugin {

    private config!: EditorConfig;
    private hljs!: HighlightJs;

    async init() {
        const config = this.editor.config.get("syntaxHighlighting") as EditorConfig | null;
        if (!config || !config.enabled) {
            return;
        }

        this.config = config;
        this.hljs = await config.loadHighlightJs();

        this.initTextEditor(this.editor);
    }

    initTextEditor(textEditor: Editor) {
        log("initTextEditor");

        const document = textEditor.model.document;

        // Create a conversion from model to view that converts
        // hljs:hljsClassName:uniqueId into a span with hljsClassName
        // See the list of hljs class names at
        // https://github.com/highlightjs/highlight.js/blob/6b8c831f00c4e87ecd2189ebbd0bb3bbdde66c02/docs/css-classes-reference.rst

        textEditor.conversion.for("editingDowncast").markerToHighlight({
            model: "hljs",
            view: ({ markerName }) => {
                dbg("markerName " + markerName);
                // markerName has the pattern addMarker:cssClassName:uniqueId
                const [, cssClassName, id] = markerName.split(":");

                // The original code at
                // https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-find-and-replace/src/findandreplaceediting.js
                // has this comment
                //      Marker removal from the view has a bug:
                //      https://github.com/ckeditor/ckeditor5/issues/7499
                //      A minimal option is to return a new object for each converted marker...
                return {
                    name: "span",
                    classes: [cssClassName],
                    attributes: {
                        // ...however, adding a unique attribute should be future-proof..
                        "data-syntax-result": id
                    }
                };
            }
        });

        // XXX This is done at BalloonEditor.create time, so it assumes this
        //     document is always attached to this textEditor, empirically that
        //     seems to be the case even with two splits showing the same note,
        //     it's not clear if CKEditor5 has apis to attach and detach
        //     documents around
        document.registerPostFixer((writer) => {
            log("postFixer");
            // Postfixers are a simpler way of tracking changes than onchange
            // See
            // https://github.com/ckeditor/ckeditor5/blob/b53d2a4b49679b072f4ae781ac094e7e831cfb14/packages/ckeditor5-block-quote/src/blockquoteediting.js#L54
            const changes = document.differ.getChanges();
            let dirtyCodeBlocks = new Set<ModelElement>();

            function lookForCodeBlocks(node: ModelElement | ModelNode) {
                /* v8 ignore next 3 -- defensive: every caller (line 108 and the recursion below) is guarded by childCount > 0, so only elements (which always have getChildren) reach here */
                if (!("getChildren" in node)) {
                    return;
                }

                for (const child of node.getChildren()) {
                    if (child.is("element", "paragraph")) {
                        continue;
                    }

                    if (child.is("element", "codeBlock")) {
                        dirtyCodeBlocks.add(child);
                    } else if ((child as ModelElement).childCount > 0) {
                        lookForCodeBlocks(child);
                    }
                }
            }

            for (const change of changes) {
                dbg("change " + JSON.stringify(change));

                if ("name" in change && change.name !== "paragraph" && change.name !== "codeBlock" && change?.position?.nodeAfter && (change.position.nodeAfter as ModelElement).childCount > 0) {
                    /*
                     * We need to look for code blocks recursively, as they can be placed within a <div> due to
                     * general HTML support or normally underneath other elements such as tables, blockquotes, etc.
                     */
                    lookForCodeBlocks(change.position.nodeAfter);
                } else if (change.type == "insert" && change.name == "codeBlock") {
                    // A new code block was inserted
                    const codeBlock = change.position?.nodeAfter;
                    // Even if it's a new codeblock, it needs dirtying in case
                    // it already has children, like when pasting one or more
                    // full codeblocks, undoing a delete, changing the language,
                    // etc (the postfixer won't get later changes for those).
                    /* v8 ignore next -- defensive: an "insert" differ change always has a nodeAfter, so codeBlock is never falsy here */
                    if (codeBlock) {
                        log("dirtying inserted codeBlock " + JSON.stringify(codeBlock.toJSON()));
                        dirtyCodeBlocks.add(codeBlock as ModelElement);
                    }
                } else if (change.type == "remove" && change.name == "codeBlock" && change.position) {
                    // An existing codeblock was removed, do nothing. Note the
                    // node is no longer in the editor so the codeblock cannot
                    // be inspected here. No need to dirty the codeblock since
                    // it has been removed
                    log("removing codeBlock at path " + JSON.stringify(change.position.toJSON()));
                } else if ((change.type == "remove" || change.type == "insert") && change?.position?.parent.is("element", "codeBlock")) {
                    // Text was added or removed from the codeblock, force a
                    // highlight
                    const codeBlock = change.position.parent;
                    log("dirtying codeBlock " + JSON.stringify(codeBlock.toJSON()));
                    dirtyCodeBlocks.add(codeBlock);
                }
            }
            for (let codeBlock of dirtyCodeBlocks) {
                this.highlightCodeBlock(codeBlock, writer);
            }
            // Adding markers doesn't modify the document data so no need for
            // postfixers to run again
            return false;
        });
    }

    /**
     * This implements highlighting via ephemeral markers (not stored in the
     * document).
     *
     * XXX Another option would be to use formatting markers, which would have
     *     the benefit of making it work for readonly notes. On the flip side,
     *     the formatting would be stored with the note and it would need a
     *     way to remove that formatting when editing back the note.
     */
    highlightCodeBlock(codeBlock: ModelElement, writer: ModelWriter) {
        log("highlighting codeblock " + JSON.stringify(codeBlock.toJSON()));
        /* v8 ignore start -- defensive: dirtied code blocks are always attached to the document, so root.document and its model are always present */
        const model = codeBlock.root.document?.model;
        if (!model) {
            return;
        }
        /* v8 ignore stop */

        // Can't invoke addMarker with an already existing marker name,
        // clear all highlight markers first. Marker names follow the
        // pattern hljs:cssClassName:uniqueId, eg hljs:hljs-comment:1
        const codeBlockRange = model.createRangeIn(codeBlock);
        for (const marker of model.markers.getMarkersIntersectingRange(codeBlockRange)) {
            dbg("removing marker " + marker.name);
            writer.removeMarker(marker.name);
        }

        // Don't highlight if plaintext (note this needs to remove the markers
        // above first, in case this was a switch from non plaintext to
        // plaintext)
        const mimeType = codeBlock.getAttribute("language") as string;
        if (mimeType == "text-plain") {
            // XXX There's actually a plaintext language that could be used
            //     if you wanted the non-highlight formatting of
            //     highlight.js css applied, see
            //     https://github.com/highlightjs/highlight.js/issues/700
            log("not highlighting plaintext codeblock");
            return;
        }

        // Don't highlight if the code is too big, as the typing performance will be highly degraded.
        if (codeBlock.childCount >= HIGHLIGHT_MAX_BLOCK_COUNT) {
            return;
        }

        // highlight.js needs the full text without HTML tags, eg for the
        // text
        // #include <stdio.h>
        // the highlighted html is
        // <span class="hljs-meta">#<span class="hljs-keyword">include</span> <span class="hljs-string">&lt;stdio.h&gt;</span></span>
        // But CKEditor codeblocks have <br> instead of \n

        // Do a two pass algorithm:
        // - First pass collect the codeblock children text, change <br> to
        //   \n
        // - invoke highlight.js on the collected text generating html
        // - Second pass parse the highlighted html spans and match each
        //   char to the CodeBlock text. Issue addMarker CKEditor calls for
        //   each span

        // XXX This is brittle and assumes how highlight.js generates html
        //     (blanks, which characters escapes, etc), a better approach
        //     would be to use highlight.js beta api TreeTokenizer?

        // Collect all the text nodes to pass to the highlighter Text is
        // direct children of the codeBlock
        let text = "";
        for (let i = 0; i < codeBlock.childCount; ++i) {
            let child = codeBlock.getChild(i);
            /* v8 ignore next 3 -- defensive: the loop is bounded by childCount, so getChild never returns null */
            if (!child) {
                continue;
            }

            // We only expect text and br elements here
            if (child.is("$text")) {
                dbg("child text " + child.data);
                text += child.data;
            } else if (child.is("element") && child.name == "softBreak") {
                dbg("softBreak");
                text += "\n";
            /* v8 ignore start -- defensive: a codeBlock child is only ever $text or softBreak, so this unknown-child arc never fires */
            } else {
                warn("Unkown child " + JSON.stringify(child.toJSON()));
            }
            /* v8 ignore stop */
        }

        let highlightRes;
        if (mimeType === this.config.defaultMimeType) {
            highlightRes = this.hljs.highlightAuto(text);
        } else {
            highlightRes = this.hljs.highlight(text, { language: mimeType });
        }

        if (!highlightRes) {
            return;
        }

        dbg("text\n" + text);
        dbg("html\n" + highlightRes.value);

        let iHtml = 0;
        let html = highlightRes.value;
        let spanStack: SpanStackEntry[] = [];
        let iChild = -1;
        let childText = "";
        let child: ModelNode | null = null;
        let iChildText = 0;

        while (iHtml < html.length) {
            // Advance the text index and fetch a new child if necessary
            if (iChildText >= childText.length) {
                iChild++;
                if (iChild < codeBlock.childCount) {
                    dbg("Fetching child " + iChild);
                    child = codeBlock.getChild(iChild);
                    /* v8 ignore next 3 -- defensive: guarded by iChild < childCount, so getChild never returns null */
                    if (!child) {
                        continue;
                    }

                    if (child.is("$text")) {
                        dbg("child text " + child.data);
                        childText = child.data;
                        iChildText = 0;
                    } else if (child.is("element", "softBreak")) {
                        dbg("softBreak");
                        iChildText = 0;
                        childText = "\n";
                    /* v8 ignore start -- defensive: a codeBlock child is only ever $text or softBreak, so this unknown-child arc never fires */
                    } else {
                        warn("child unknown!!!");
                    }
                    /* v8 ignore stop */
                } else {
                    // Don't bail if beyond the last children, since there's
                    // still html text, it must be a closing span tag that
                    // needs to be dealt with below
                    childText = "";
                }
            }

            // This parsing is made slightly simpler and faster by only
            // expecting <span> and </span> tags in the highlighted html
            if (html[iHtml] == "<" && html[iHtml + 1] != "/") {
                // new span, note they can be nested eg C preprocessor lines
                // are inside a hljs-meta span, hljs-title function names
                // inside a hljs-function span, etc
                let iStartQuot = html.indexOf('"', iHtml + 1);
                let iEndQuot = html.indexOf('"', iStartQuot + 1);
                let className = html.slice(iStartQuot + 1, iEndQuot);
                // XXX highlight js uses scope for Python "title function_",
                //     etc for now just use the first style only
                // See https://highlightjs.readthedocs.io/en/latest/css-classes-reference.html#a-note-on-scopes-with-sub-scopes
                let iBlank = className.indexOf(" ");
                if (iBlank > 0) {
                    className = className.slice(0, iBlank);
                }
                dbg("Found span start " + className);

                iHtml = html.indexOf(">", iHtml) + 1;

                // push the span
                let posStart = writer.createPositionAt(codeBlock, (child?.startOffset ?? 0) + iChildText);
                spanStack.push({ className: className, posStart: posStart });
            } else if (html[iHtml] == "<" && html[iHtml + 1] == "/") {
                // Done with this span, pop the span and mark the range
                iHtml = html.indexOf(">", iHtml + 1) + 1;

                let stackTop = spanStack.pop();
                let posStart = stackTop?.posStart;
                let className = stackTop?.className;
                let posEnd = writer.createPositionAt(codeBlock, (child?.startOffset ?? 0) + iChildText);
                if (posStart) {
                    let range = writer.createRange(posStart, posEnd);
                    let markerName = "hljs:" + className + ":" + markerCounter;
                    // Use an incrementing number for the uniqueId, random of
                    // 10000000 is known to cause collisions with a few
                    // codeblocks of 10s of lines on real notes (each line is
                    // one or more marker).
                    // Wrap-around for good measure so all numbers are positive
                    // XXX Another option is to catch the exception and retry or
                    //     go through the markers and get the largest + 1
                    markerCounter = (markerCounter + 1) & 0xffffff;
                    dbg("Found span end " + className);
                    dbg("Adding marker " + markerName + ": " + JSON.stringify(range.toJSON()));
                    writer.addMarker(markerName, { range: range, usingOperation: false });
                }
            } else {
                // Text, we should also have text in the children
                assert(iChild < codeBlock.childCount && iChildText < childText.length, "Found text in html with no corresponding child text!!!!");
                if (html[iHtml] == "&") {
                    // highlight.js only encodes
                    // .replace(/&/g, '&amp;')
                    // .replace(/</g, '&lt;')
                    // .replace(/>/g, '&gt;')
                    // .replace(/"/g, '&quot;')
                    // .replace(/'/g, '&#x27;');
                    // see https://github.com/highlightjs/highlight.js/blob/7addd66c19036eccd7c602af61f1ed84d215c77d/src/lib/utils.js#L5
                    let iAmpEnd = html.indexOf(";", iHtml);
                    dbg(html.slice(iHtml, iAmpEnd));
                    iHtml = iAmpEnd + 1;
                } else {
                    // regular text
                    dbg(html[iHtml]);
                    iHtml++;
                }
                iChildText++;
            }
        }
    }

}


const HIGHLIGHT_MAX_BLOCK_COUNT = 500;

const tag = "SyntaxHighlightWidget";
const debugLevels = ["error", "warn", "info", "log", "debug"];
const debugLevel = debugLevels.indexOf("warn");

/* v8 ignore start -- dead debug scaffolding: debugLevel is a hardcoded "warn", so these level gates and the disabled-logger noops never vary at runtime */
let warn = function (...args: unknown[]) {};
if (debugLevel >= debugLevels.indexOf("warn")) {
    warn = console.warn.bind(console, tag + ": ");
}

let log = function (...args: unknown[]) {};
if (debugLevel >= debugLevels.indexOf("log")) {
    log = console.log.bind(console, tag + ": ");
}

let dbg = function (...args: unknown[]) {};
if (debugLevel >= debugLevels.indexOf("debug")) {
    dbg = console.debug.bind(console, tag + ": ");
}
/* v8 ignore stop */

function assert(e: boolean, msg?: string) {
    console.assert(e, tag + ": " + msg);
}

// TODO: Should this be scoped to note?
let markerCounter = 0;

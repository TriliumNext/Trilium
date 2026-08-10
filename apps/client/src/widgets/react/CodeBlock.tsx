import "./CodeBlock.css";

import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import { copyTextWithToast } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import { applySingleBlockSyntaxHighlight, isSyntaxHighlightEnabled } from "../../services/syntax_highlight";
import ActionButton from "./ActionButton";

interface CodeBlockProps {
    /** The code to display. Rendered verbatim — never interpreted as HTML. */
    code: string;
    /**
     * MIME type to highlight as, e.g. `application/json` or `text/x-sh`. Omit to render the
     * code unhighlighted. Highlighting is skipped when the user has turned it off for notes.
     */
    mimeType?: string;
    /**
     * A literal in `code` that the user is meant to substitute, e.g. `your-etapi-token`.
     * Every occurrence is marked so it reads as a blank to fill in rather than as part of
     * the snippet. Matched verbatim, not as a pattern.
     */
    placeholder?: string;
    /** Shows a copy-to-clipboard button in the corner. */
    copyable?: boolean;
    /** Wraps long lines instead of scrolling horizontally. */
    wrap?: boolean;
    className?: string;
}

/**
 * A read-only code block styled to match the ones rendered inside text notes.
 *
 * Text notes get their code blocks from CKEditor, which the jQuery helpers in
 * `services/syntax_highlight` decorate after the fact. That path can't be driven from
 * Preact, so this component reproduces the same treatment — shared `--code-block-*`
 * variables, the same copy affordance, and the same highlighter — for code rendered
 * directly by the UI (options screens, dialogs).
 */
export default function CodeBlock({ code, mimeType, placeholder, copyable = true, wrap, className }: CodeBlockProps) {
    const codeRef = useRef<HTMLElement>(null);

    // The <code> subtree is deliberately left out of Preact's control: highlighting swaps
    // its innerHTML, and Preact reconciling children it no longer recognises would either
    // clobber the highlight or duplicate the text. Writing the plain code in a layout
    // effect keeps it painted before the first frame, so there is no flash of empty block.
    useLayoutEffect(() => {
        if (codeRef.current) {
            codeRef.current.textContent = code;
            markPlaceholder(codeRef.current, placeholder);
        }
    }, [code, placeholder]);

    useEffect(() => {
        const element = codeRef.current;
        if (!element || !mimeType || !isSyntaxHighlightEnabled()) {
            return;
        }

        let cancelled = false;
        void (async () => {
            await applySingleBlockSyntaxHighlight($(element), normalizeMimeTypeForCKEditor(mimeType));
            if (cancelled) {
                // A newer render is authoritative; the layout effect above has already
                // restored the correct plain text, so drop this stale highlight.
                return;
            }
            // The helper *toggles* `hljs` on the parent, so a second pass over the same
            // element would switch the theme's colours back off. Force it on instead.
            element.parentElement?.classList.add("hljs");
            // Highlighting rebuilt the subtree from the raw text, discarding the marks the
            // layout effect added — so they have to be reapplied over the new tokens.
            markPlaceholder(element, placeholder);
        })();

        return () => { cancelled = true; };
    }, [code, mimeType, placeholder]);

    return (
        <pre className={`code-block ${wrap ? "wrap" : ""} ${className ?? ""}`}>
            <code ref={codeRef} />
            {copyable && (
                <ActionButton
                    className="code-block-copy"
                    icon="bx bx-copy"
                    text={t("code_block.copy_title")}
                    onClick={(e) => {
                        e.stopPropagation();
                        copyTextWithToast(code);
                    }}
                />
            )}
        </pre>
    );
}

/**
 * Wraps every verbatim occurrence of `placeholder` in a marker span.
 *
 * Runs over the rendered DOM rather than the source string because it has to work on the
 * highlighted output too, where the text is already split across the highlighter's token
 * spans. An occurrence straddling two of those spans is left unmarked — that only costs
 * the visual hint, so it degrades quietly instead of mangling the snippet.
 */
function markPlaceholder(root: HTMLElement, placeholder: string | undefined) {
    if (!placeholder) {
        return;
    }

    // Collected up front: splitting text nodes while the walker is still traversing them
    // would have it revisit the pieces it just created.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const candidates: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.includes(placeholder)) {
            candidates.push(node as Text);
        }
    }

    for (const candidate of candidates) {
        let remainder: Text | null = candidate;
        while (remainder) {
            const index = remainder.data.indexOf(placeholder);
            if (index < 0) {
                break;
            }
            const match: Text = remainder.splitText(index);
            remainder = match.splitText(placeholder.length);

            const marker = document.createElement("span");
            marker.className = "code-block-placeholder";
            match.replaceWith(marker);
            marker.appendChild(match);
        }
    }
}

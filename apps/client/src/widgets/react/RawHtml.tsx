import type { HighlightedTokenInfo } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import type { CSSProperties, HTMLProps, RefObject } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";

import { useImperativeSearchHighlighlighting } from "./hooks";

type HTMLElementLike = string | HTMLElement | JQuery<HTMLElement>;

interface RawHtmlProps extends Pick<HTMLProps<HTMLElement>, "tabindex" | "dir"> {
    className?: string;
    html?: HTMLElementLike;
    style?: CSSProperties;
    onClick?: (e: MouseEvent) => void;
}

export default function RawHtml({containerRef, ...props}: RawHtmlProps & { containerRef?: RefObject<HTMLSpanElement>}) {
    return <span ref={containerRef} {...getProps(props)} />;
}

export function RawHtmlBlock({containerRef, ...props}: RawHtmlProps & { containerRef?: RefObject<HTMLDivElement>}) {
    return <div ref={containerRef} {...getProps(props)} />;
}

function getProps({ className, html, style, onClick, dir, tabindex }: RawHtmlProps) {
    return {
        className,
        dangerouslySetInnerHTML: getHtml(html ?? ""),
        style,
        onClick,
        dir,
        tabindex
    };
}

export function getHtml(html: string | HTMLElement | JQuery<HTMLElement>) {
    if (typeof html === "object" && "length" in html) {
        html = html[0];
    }

    if (typeof html === "object" && "outerHTML" in html) {
        html = html.outerHTML;
    }

    return {
        __html: html as string
    };
}

/**
 * Renders plain text with search-match highlighting. The text is set imperatively so mark.js,
 * which injects `.ck-find-result` spans around matches, does not fight Preact's reconciliation
 * of a controlled text child.
 */
export function HighlightedText({ className, text, highlightedTokens }: {
    className?: string;
    text: string;
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined;
}) {
    const ref = useRef<HTMLSpanElement>(null);
    const highlight = useImperativeSearchHighlighlighting(highlightedTokens);

    // Before the paint, so the span is not drawn empty for a frame first. `highlight` is a fresh
    // closure each render, so the effect keys on the token list instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        if (!ref.current) return;
        ref.current.textContent = text;
        highlight(ref.current);
    }, [ text, highlightedTokens ]);

    return <span className={className} ref={ref} />;
}

/**
 * Renders HTML content sanitized via DOMPurify to prevent XSS.
 * Use this instead of {@link RawHtml} when the HTML originates from
 * untrusted sources (e.g. LLM responses, user-generated markdown).
 */
export function SanitizedHtml({ className, html, style }: { className?: string; html: string; style?: CSSProperties }) {
    return (
        <div
            className={className}
            style={style}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
    );
}

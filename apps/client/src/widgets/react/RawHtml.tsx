import DOMPurify from "dompurify";
import type { CSSProperties, HTMLProps, RefObject } from "preact/compat";

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

function getProps({ className, html, style, onClick }: RawHtmlProps) {
    return {
        className,
        dangerouslySetInnerHTML: getHtml(html ?? ""),
        style,
        onClick
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

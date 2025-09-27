import { useEffect, useRef, useState } from "preact/hooks";
import link, { ViewScope } from "../../services/link";
import { useImperativeSearchHighlighlighting } from "./hooks";

interface NoteLinkOpts {
    className?: string;
    notePath: string | string[];
    showNotePath?: boolean;
    showNoteIcon?: boolean;
    style?: Record<string, string | number>;
    noPreview?: boolean;
    noTnLink?: boolean;
    highlightedTokens?: string[] | null | undefined;
    // Override the text of the link, otherwise the note title is used.
    title?: string;
    viewScope?: ViewScope;
}

export default function NoteLink({ className, notePath, showNotePath, showNoteIcon, style, noPreview, noTnLink, highlightedTokens, title, viewScope }: NoteLinkOpts) {
    const stringifiedNotePath = Array.isArray(notePath) ? notePath.join("/") : notePath;
    const ref = useRef<HTMLSpanElement>(null);
    const [ jqueryEl, setJqueryEl ] = useState<JQuery<HTMLElement>>();
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);

    useEffect(() => {
        link.createLink(stringifiedNotePath, {
            title,
            showNotePath,
            showNoteIcon,
            viewScope
        }).then(setJqueryEl);
    }, [ stringifiedNotePath, showNotePath, title, viewScope ]);

    useEffect(() => {
        if (!ref.current || !jqueryEl) return;
        ref.current.replaceChildren(jqueryEl[0]);
        highlightSearch(ref.current);
    }, [ jqueryEl, highlightedTokens ]);

    if (style) {
        jqueryEl?.css(style);
    }

    const $linkEl = jqueryEl?.find("a");
    if (noPreview) {
        $linkEl?.addClass("no-tooltip-preview");
    }

    if (!noTnLink) {
        $linkEl?.addClass("tn-link");
    }

    if (className) {
        $linkEl?.addClass(className);
    }

    return <span ref={ref} />

}

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { useEffect, useMemo, useRef } from "preact/hooks";

import { expandAncestorDetails } from "../../../services/collapsible";
import {
    addHighlights, findRegExpRanges, findTermRanges, removeHighlights
} from "../../../services/highlight_matches";

/** Longer regex tokens are rejected outright rather than compiled, to avoid pathological patterns. */
const MAX_REGEX_TOKEN_LENGTH = 1000;

/** Caps the number of matches a single regex token can wrap. */
const MAX_REGEX_MATCHES = 500;

export function useImperativeSearchHighlighlighting(
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined
) {
    const ranges = useRef<Range[]>([]);
    const tokenInfos = useMemo<HighlightedTokenInfo[] | null>(() => {
        if (!highlightedTokens?.length) return null;
        return highlightedTokens.map((token) => (typeof token === "string" ? { token, type: "plain" as const } : token));
    }, [ highlightedTokens ]);

    // `CSS.highlights` keeps the ranges, and the nodes they hold, after the element is removed.
    useEffect(() => () => removeHighlights("search-match", ranges.current), []);

    return (el: HTMLElement | null | undefined) => {
        if (!el) return;

        // Clearing comes first and happens even with no tokens left: callers that keep the same
        // element and merely drop the tokens (e.g. emptying a filter box) rely on this to remove the
        // previous highlights, which would otherwise stay drawn for good.
        removeHighlights("search-match", ranges.current);
        ranges.current = [];

        if (!tokenInfos) return;

        // `findTermRanges()` ignores diacritics, so an unaccented query like "ktory" (the server
        // strips diacritics before indexing) still highlights "ktorý" (#10616). It matches
        // substrings, so CJK tokens without word boundaries ("笔记" in "我的笔记本") work too.
        const plainTokens = tokenInfos.filter((info) => info.type === "plain").map((info) => info.token);
        ranges.current.push(...findTermRanges(el, plainTokens));

        for (const info of tokenInfos) {
            if (info.type !== "regex" || info.token.length > MAX_REGEX_TOKEN_LENGTH) continue;

            let regex: RegExp;
            try {
                regex = new RegExp(info.token, "gi");
            } catch {
                // Invalid regex (e.g. from a malformed %= search) - skip rather than crash the render.
                continue;
            }

            ranges.current.push(...findRegExpRanges(el, regex, { limit: MAX_REGEX_MATCHES }));
        }

        addHighlights("search-match", ranges.current);

        // Reveal matches that landed inside collapsed <details> blocks, which are highlighted but
        // hidden until the block is expanded.
        for (const range of ranges.current) {
            const parent = range.startContainer.parentElement;
            if (parent) expandAncestorDetails(parent);
        }
    };
}

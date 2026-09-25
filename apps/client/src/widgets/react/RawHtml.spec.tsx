import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import RawHtml, { HighlightedText, RawHtmlBlock } from "./RawHtml";

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
});

describe("RawHtml", () => {
    it("renders the HTML and every declared attribute onto the element", () => {
        render(
            <RawHtmlBlock
                className="ck-content"
                html="<p>שלום</p>"
                dir="rtl"
                tabindex={100}
                style={{ color: "red" }}
            />,
            container
        );

        const el = container.querySelector("div");
        expect(el?.innerHTML).toBe("<p>שלום</p>");
        expect(el?.className).toBe("ck-content");
        // `dir` and `tabindex` are declared on RawHtmlProps but were once dropped by the
        // props destructure, which silently disabled RTL layout for read-only text notes.
        expect(el?.getAttribute("dir")).toBe("rtl");
        expect(el?.getAttribute("tabindex")).toBe("100");
        expect(el?.style.color).toBe("red");
    });

    it("omits the optional attributes when they are not given", () => {
        render(<RawHtml html="<b>hi</b>" />, container);

        const el = container.querySelector("span");
        expect(el?.innerHTML).toBe("<b>hi</b>");
        expect(el?.hasAttribute("dir")).toBe(false);
        expect(el?.hasAttribute("tabindex")).toBe(false);
    });
});

describe("HighlightedText", () => {
    it("renders the text as text, never as markup", () => {
        act(() => render(
            <HighlightedText className="title" text="a <b>literal</b> title" highlightedTokens={null} />,
            container
        ));

        const el = container.querySelector("span.title");
        expect(el?.textContent).toBe("a <b>literal</b> title");
        expect(el?.querySelector("b")).toBeNull();
    });

    it("marks the matched tokens and clears them when the tokens go away", () => {
        act(() => render(
            <HighlightedText text="the matched word" highlightedTokens={[ "matched" ]} />,
            container
        ));

        const marks = () => [ ...container.querySelectorAll(".ck-find-result") ];
        expect(marks().map((mark) => mark.textContent)).toEqual([ "matched" ]);

        act(() => render(
            <HighlightedText text="the matched word" highlightedTokens={null} />,
            container
        ));
        expect(marks()).toEqual([]);
        expect(container.textContent).toBe("the matched word");
    });

    it("re-applies the marks when the text changes under the same tokens", () => {
        act(() => render(
            <HighlightedText text="one match" highlightedTokens={[ "match" ]} />,
            container
        ));
        act(() => render(
            <HighlightedText text="another match here" highlightedTokens={[ "match" ]} />,
            container
        ));

        expect(container.textContent).toBe("another match here");
        expect(container.querySelectorAll(".ck-find-result")).toHaveLength(1);
    });
});

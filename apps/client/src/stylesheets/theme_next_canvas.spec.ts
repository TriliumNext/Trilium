import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/**
 * Checks the Next theme's properties panel of a drawing against Excalidraw's own stylesheet, loaded
 * after it, so that the theme wins by specificity whichever stylesheet loads last. Excalidraw
 * renders the panel beside the drawing (`.App-menu__left`) and, in the phone layout, in the island
 * of the bottom bar (`.App-mobile-menu`), which `usePropertiesSheet()` turns into a sheet.
 */
describe("Next theme of the drawing's properties panel", () => {
    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    it("draws the groups as cards in both layouts, larger in the phone layout", () => {
        const { side, sheet } = renderPanels();

        expect(getLook(side)).toEqual({
            gap: 5,
            groups: [ "plain", "DIV", "FIELDSET", "LABEL" ],
            corners: Array(3).fill("4px 4px 4px 4px"),
            backgrounds: Array(3).fill("rgb(7, 8, 9)"),
            shadows: Array(3).fill("1px 1px 1px rgb(13, 14, 15)"),
            zooms: Array(3).fill(1),
            titles: Array(3).fill("uppercase")
        });
        expect(getLook(sheet).groups[0]).toBe("hidden");

        const { sheet: strokedSheet } = renderPanels({ hasStroke: true });
        expect(getLook(strokedSheet)).toEqual({
            gap: 0,
            groups: [ "DIV", "DIV", "FIELDSET", "LABEL" ],
            corners: Array(4).fill("9px 9px 9px 9px"),
            backgrounds: Array(4).fill("rgb(10, 11, 12)"),
            shadows: Array(4).fill("none"),
            zooms: Array(4).fill(1.25),
            titles: Array(4).fill("uppercase")
        });
    });

    it("lays out the phone groups in two columns of at least 270px, spaced by borders", () => {
        const { sheet } = renderPanels({ hasStroke: true });
        const column = sheet.querySelector(".panelColumn");
        expect(column).not.toBeNull();
        const columnStyle = getComputedStyle(column as Element);
        const groups = [ ...column?.children ?? [] ].map((group) => {
            const style = getComputedStyle(group);
            const zoom = getZoom(style);
            const borders = [
                style.borderTopWidth, style.borderRightWidth,
                style.borderBottomWidth, style.borderLeftWidth
            ].map((width) => parseFloat(width) * zoom);
            return {
                flex: `${style.flexGrow} ${style.flexShrink} ${style.flexBasis}`,
                borders: `${borders.join(" ")} ${style.borderTopStyle} ${style.borderTopColor}`,
                background: style.backgroundClip,
                cardCorner: parseFloat(style.borderTopLeftRadius) * zoom - borders[0],
                cardMinWidth: parseFloat(style.minWidth) * zoom - borders[1] - borders[3]
            };
        });

        // Each group takes half a row, or the whole row when it is alone in it.
        expect(`${columnStyle.flexDirection} ${columnStyle.flexWrap}`).toBe("row wrap");
        expect(groups).toEqual(Array(4).fill({
            flex: "1 1 50%",
            borders: "4 4 4 4 solid transparent",
            background: "padding-box",
            cardCorner: 5,
            cardMinWidth: 270
        }));
        // The borders of two groups space them by 8px, and with the padding by 12px from the frame.
        const insets = [
            columnStyle.paddingTop, columnStyle.paddingRight,
            columnStyle.paddingBottom, columnStyle.paddingLeft
        ].map((padding) => parseFloat(padding) + 4);
        expect(insets).toEqual([ 12, 12, 12, 12 ]);
    });

    it("frames the phone panel as a menu, which scrolls inside its frame in the sheet", () => {
        const { sheet } = renderPanels();
        const island = sheet.closest(".Island");
        const column = sheet.querySelector(".panelColumn");
        expect(island).not.toBeNull();
        expect(column).not.toBeNull();
        const getFrame = () => {
            const style = getComputedStyle(column as Element);
            return {
                border: [ style.borderTopWidth, style.borderTopStyle, style.borderTopColor ],
                radius: style.borderTopLeftRadius,
                padding: [ style.paddingTop, style.paddingLeft, style.paddingBottom ],
                background: style.backgroundColor,
                blur: style.backdropFilter
            };
        };
        const getScroller = () => [ sheet, column ]
            .filter((element) => getComputedStyle(element as Element).overflowY === "auto");
        const menuFrame = {
            border: [ "1px", "solid", "rgb(1, 2, 3)" ],
            radius: "10px",
            padding: [ "8px", "8px", "8px" ],
            background: "rgb(4, 5, 6)",
            blur: "blur(20px)"
        };

        const islandStyle = getComputedStyle(island as Element);
        expect([ islandStyle.backgroundColor, islandStyle.boxShadow ])
            .toEqual([ "transparent", "none" ]);
        expect(getComputedStyle(sheet).marginBottom).toBe("0px");
        expect(getFrame()).toEqual(menuFrame);
        expect(getScroller()).toEqual([ column ]);

        // In fullscreen, the panel shares the island with the footer, and Excalidraw scrolls it.
        island?.removeAttribute("data-properties-sheet");
        expect(getFrame()).toEqual(menuFrame);
        expect(getScroller()).toEqual([ sheet ]);
    });
});

/** The variables of the Next theme, which its color schemes set. */
const THEME_VARIABLES = `:root {
    --dropdown-border-color: rgb(1, 2, 3);
    --dropdown-border-radius: 10px;
    --menu-background-color: rgb(4, 5, 6);
    --dropdown-backdrop-filter: blur(20px);
    --floating-button-background-color: rgb(7, 8, 9);
    --floating-button-shadow-color: rgb(13, 14, 15);
    --card-background-color: rgb(10, 11, 12);
}`;

function renderPanels({ hasStroke = false } = {}) {
    const groups = getGroups(hasStroke);
    const entry = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");
    const excalidrawStyles = readFileSync(join(dirname(entry), "..", "prod", "index.css"), "utf8");
    const themeStyles = readFileSync(join(__dirname, "theme-next/notes/canvas.css"), "utf8");
    document.head.innerHTML = `<style>${THEME_VARIABLES}</style><style>${themeStyles}</style>
        <style>${excalidrawStyles}</style>`;
    document.body.innerHTML = `<div class="excalidraw">
        <div class="Island App-menu__left">${groups}</div>
        <div class="App-bottom-bar">
            <div class="Island" data-properties-sheet popover="manual">
                <section class="App-mobile-menu">
                    <h2 class="visually-hidden">Selected shape actions</h2>
                    ${groups}
                </section>
                <footer class="App-toolbar"></footer>
            </div>
        </div>
    </div>`;

    const side = document.querySelector<HTMLElement>(".App-menu__left");
    const sheet = document.querySelector<HTMLElement>(".App-mobile-menu");
    if (!side || !sheet) {
        throw new Error("The panels did not render.");
    }
    return { side, sheet };
}

/**
 * The groups of Excalidraw's properties panel. The wrapper of the stroke color is empty when no
 * selected element takes one.
 */
function getGroups(hasStroke: boolean) {
    return `<div class="panelColumn">
        <div>${hasStroke ? "<h3>Stroke</h3>" : ""}</div>
        <div><h3>Background</h3></div>
        <fieldset><legend>Layers</legend></fieldset>
        <label class="control-label">Opacity</label>
    </div>`;
}

/**
 * The gap between the groups in pixels, each group as hidden, plain or the tag of a card, and the
 * case of the titles. For each card: its corners clockwise from the top left once zoomed, its
 * background, its shadow and its zoom.
 */
function getLook(panel: Element) {
    const column = panel.querySelector(".panelColumn");
    const groups = [ ...column?.children ?? [] ];
    const titles = [ ...panel.querySelectorAll(".panelColumn :is(h3, legend, label)") ];
    const getKind = (group: Element) => {
        const style = getComputedStyle(group);
        if (style.display === "none") {
            return "hidden";
        }
        return `${style.paddingTop} ${style.paddingLeft}` === "8px 12px" ? group.tagName : "plain";
    };
    const cards = groups
        .filter((group) => ![ "hidden", "plain" ].includes(getKind(group)))
        .map((group) => getComputedStyle(group));
    return {
        gap: column ? parseFloat(getComputedStyle(column).rowGap) : null,
        groups: groups.map(getKind),
        corners: cards.map((style) => [
            style.borderTopLeftRadius, style.borderTopRightRadius,
            style.borderBottomRightRadius, style.borderBottomLeftRadius
        ].map((radius) => `${parseFloat(radius) * getZoom(style)}px`).join(" ")),
        backgrounds: cards.map((style) => style.backgroundColor),
        shadows: cards.map((style) => style.boxShadow),
        zooms: cards.map(getZoom),
        titles: titles.map((title) => getComputedStyle(title).textTransform)
    };
}

function getZoom(style: CSSStyleDeclaration) {
    return parseFloat(style.zoom) || 1;
}

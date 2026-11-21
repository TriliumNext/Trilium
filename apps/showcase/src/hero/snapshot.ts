import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "playwright";

/**
 * Serializes the page into one self-contained HTML file: the DOM without scripts, only the CSS
 * rules whose selectors match an element, only the custom properties those rules reach, and only
 * the fonts the page draws with, subset to its characters and to the OpenType features a browser
 * applies by default; animations and transitions are off. Both color schemes survive, since a rule
 * is kept whatever media query it sits in. `fonttools` is the fontTools command, which needs the
 * Brotli module to write WOFF2. Resolves with the HTML and the numbers behind its size.
 */
export async function captureSnapshot(page: Page, { fonttools }: { fonttools: string }) {
    const harvested = await page.evaluate(harvestPage);
    const { css, declared, kept: keptProperties } = pruneCustomProperties(harvested.css,
        harvested.inlineStyles);

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-hero-"));
    try {
        const textFile = path.join(workDir, "chars.txt");
        fs.writeFileSync(textFile, harvested.chars);
        let fontFaces = "";
        const fonts: { family: string; bytes: number }[] = [];
        for (const face of harvested.fontFaces) {
            const source = path.join(workDir, "source");
            const subset = path.join(workDir, "subset.woff2");
            fs.writeFileSync(source, Buffer.from(await (await fetch(face.url)).arrayBuffer()));
            const run = (args: string[]) => execFileSync(fonttools, args, {
                stdio: [ "ignore", "ignore", "pipe" ]
            });
            // Chromium draws list markers with `tnum`, which is not among the default features.
            run([ "subset", source, `--text-file=${textFile}`, "--flavor=woff2",
                "--layout-features+=tnum", `--output-file=${subset}` ]);
            const data = fs.readFileSync(subset);
            fonts.push({ family: face.family, bytes: data.length });
            fontFaces += `@font-face{${face.descriptors}`
                + `src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");}\n`;
        }
        return {
            html: harvested.html.replace("/*__CSS__*/", () => css + fontFaces),
            stats: {
                rulesKept: harvested.rulesKept,
                rulesDropped: harvested.rulesDropped,
                customProperties: `${keptProperties} of ${declared}`,
                cssBytes: css.length,
                domBytes: harvested.html.length,
                fonts,
                unusedFonts: harvested.unusedFonts
            }
        };
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

/**
 * Drops the custom property declarations that nothing reaches: a property stays when a rule, an
 * inline style or another kept property reads it through `var()`.
 */
function pruneCustomProperties(css: string, inlineStyles: string) {
    const declaration = /(^|[{;\s])(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]*)(;?)/g;
    const values = new Map<string, string>();
    for (const [ , , name, value ] of css.matchAll(declaration)) {
        values.set(name, `${values.get(name) ?? ""} ${value}`);
    }
    const references = (text: string) => [ ...text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g) ]
        .map((match) => match[1]);
    const used = new Set(references(css.replace(declaration, "$1") + inlineStyles));
    const pending = [ ...used ];
    while (pending.length) {
        for (const name of references(values.get(pending.pop() ?? "") ?? "")) {
            if (!used.has(name)) {
                used.add(name);
                pending.push(name);
            }
        }
    }
    return {
        css: css.replace(declaration,
            (match, lead: string, name: string) => used.has(name) ? match : lead),
        declared: values.size,
        kept: used.size
    };
}

/**
 * Runs in the page. A selector stays when it matches an element once its states and
 * pseudo-elements are removed, so hover and focus styles stay too; a selector the browser
 * rejects once they are removed also stays.
 */
async function harvestPage() {
    const STATES = new RegExp("::?(?:hover|focus-visible|focus-within|focus|active|visited|link|"
        + "any-link|checked|indeterminate|disabled|enabled|placeholder-shown|autofill|before|after|"
        + "placeholder|selection|marker|first-line|first-letter|backdrop|file-selector-button|"
        + "-webkit-[a-z-]+|-moz-[a-z-]+|-ms-[a-z-]+)(?![\\w-])", "g");
    let rulesKept = 0;
    let rulesDropped = 0;
    const fontFaceRules: CSSFontFaceRule[] = [];
    const matches = new Map<string, boolean>();

    function selectorMatches(selector: string) {
        const plain = selector.replace(STATES, "").replace(/:not\(\s*\)/g, "").trim() || "*";
        if (!matches.has(plain)) {
            try {
                matches.set(plain, !!document.querySelector(
                    plain.replace(/(^|[\s>+~(,])&/g, "$1*")));
            } catch {
                matches.set(plain, true);
            }
        }
        return matches.get(plain);
    }

    /**
     * The app marks the color scheme with a `light-theme` or `dark-theme` class on `body`, which
     * the static snapshot cannot toggle. A selector that tests one moves under the matching
     * `prefers-color-scheme` query, the test replaced by `:nth-child(n)` to keep its specificity.
     */
    function unthemeSelector(selector: string) {
        const light = /:not\(\.dark-theme\)|\.light-theme(?![\w-])/g;
        const dark = /:not\(\.light-theme\)|\.dark-theme(?![\w-])/g;
        const scheme = light.test(selector) ? "light" : dark.test(selector) ? "dark" : null;
        if (!scheme) return { scheme, selector };
        return { scheme, selector: selector.replace(light, ":nth-child(n)")
            .replace(dark, ":nth-child(n)") };
    }

    function splitSelectors(text: string) {
        const parts = [];
        let depth = 0;
        let start = 0;
        for (const [ index, char ] of [ ...text ].entries()) {
            if (char === "(" || char === "[") depth++;
            else if (char === ")" || char === "]") depth--;
            else if (char === "," && depth === 0) {
                parts.push(text.slice(start, index).trim());
                start = index + 1;
            }
        }
        parts.push(text.slice(start).trim());
        return parts;
    }

    function readRules(sheet: CSSStyleSheet): CSSRuleList | CSSRule[] {
        try {
            return sheet.cssRules;
        } catch {
            return [];
        }
    }

    function serialize(rules: CSSRuleList | CSSRule[]) {
        let out = "";
        for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
                const body = rule.cssText.slice(rule.cssText.indexOf("{"));
                const byScheme = new Map<string | null, string[]>();
                for (const selector of splitSelectors(rule.selectorText)) {
                    const { scheme, selector: plain } = unthemeSelector(selector);
                    if (!selectorMatches(plain)) continue;
                    byScheme.set(scheme, [ ...byScheme.get(scheme) ?? [], plain ]);
                }
                if (!byScheme.size) {
                    rulesDropped++;
                    continue;
                }
                rulesKept++;
                for (const [ scheme, selectors ] of byScheme) {
                    const kept = `${selectors.join(",")}${body}`;
                    out += scheme
                        ? `@media (prefers-color-scheme: ${scheme}){${kept}}\n`
                        : `${kept}\n`;
                }
            } else if (rule instanceof CSSMediaRule) {
                if (/^print$/i.test(rule.conditionText)) continue;
                const inner = serialize(rule.cssRules);
                if (inner) out += `@media ${rule.conditionText}{${inner}}\n`;
            } else if (rule instanceof CSSSupportsRule) {
                const inner = serialize(rule.cssRules);
                if (inner) out += `@supports ${rule.conditionText}{${inner}}\n`;
            } else if (rule instanceof CSSContainerRule) {
                const inner = serialize(rule.cssRules);
                const condition = `${rule.containerName} ${rule.containerQuery}`;
                if (inner) out += `@container ${condition}{${inner}}\n`;
            } else if (rule instanceof CSSLayerBlockRule) {
                const inner = serialize(rule.cssRules);
                if (inner) out += `@layer ${rule.name}{${inner}}\n`;
            } else if (rule instanceof CSSImportRule) {
                const inner = rule.styleSheet ? serialize(readRules(rule.styleSheet)) : "";
                const media = rule.media.mediaText;
                if (inner) out += media && media !== "all" ? `@media ${media}{${inner}}\n` : inner;
            } else if (rule instanceof CSSFontFaceRule) {
                fontFaceRules.push(rule);
            } else if (!(rule instanceof CSSKeyframesRule || rule instanceof CSSPageRule)) {
                out += `${rule.cssText}\n`;
            }
        }
        return out;
    }

    // The `next` theme loads its light and dark sheets behind the `media` of their <link>.
    let css = "";
    for (const sheet of document.styleSheets) {
        const inner = serialize(readRules(sheet));
        const owner = sheet.ownerNode;
        const media = owner instanceof Element ? owner.getAttribute("media") : null;
        css += media && media !== "all" && inner ? `@media ${media}{${inner}}\n` : inner;
    }

    // Icon fonts draw through generated content, so `content` counts as text.
    const chars = new Set(`${document.body.innerText} 0123456789`);
    for (const element of document.querySelectorAll("*")) {
        for (const pseudo of [ "::before", "::after", "::marker" ]) {
            const content = getComputedStyle(element, pseudo).content;
            if (content && content !== "none" && content !== "normal") {
                for (const char of content.replace(/^"|"$/g, "")) chars.add(char);
            }
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            for (const char of element.value + element.placeholder) chars.add(char);
        }
    }

    // The browser downloads a face only once some text renders in it, so a loaded face is one
    // the page draws with.
    const faceKey = (family: string, weight: string, style: string) => [
        family.replace(/["']/g, "").trim(), weight || "normal", style || "normal"
    ].join("|");
    const loadedFaces = new Set([ ...document.fonts ]
        .filter((face) => face.status === "loaded")
        .map((face) => faceKey(face.family, face.weight, face.style)));
    const fontFaces: { family: string; url: string; descriptors: string }[] = [];
    const unusedFonts = new Set<string>();
    const seenFaces = new Set<string>();
    for (const face of fontFaceRules) {
        const family = face.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        const key = faceKey(family, face.style.getPropertyValue("font-weight"),
            face.style.getPropertyValue("font-style"));
        if (!loadedFaces.has(key)) {
            unusedFonts.add(family);
            continue;
        }
        if (seenFaces.has(key)) continue;
        seenFaces.add(key);
        const urls = [ ...face.style.getPropertyValue("src").matchAll(/url\(\s*["']?([^"')]+)/g) ]
            .map((match) => match[1]);
        const url = urls.find((candidate) => /woff2/i.test(candidate)) ?? urls[0];
        if (!url) continue;
        let descriptors = "";
        for (const name of face.style) {
            if (name !== "src") descriptors += `${name}:${face.style.getPropertyValue(name)};`;
        }
        const base = face.parentStyleSheet?.href ?? document.baseURI;
        fontFaces.push({ family, url: new URL(url, base).href, descriptors });
    }

    // Form state and canvases are copied into the clone as attributes and images.
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const liveFields = document.querySelectorAll("input, textarea, canvas");
    const clonedFields = clone.querySelectorAll("input, textarea, canvas");
    for (const [ index, live ] of [ ...liveFields ].entries()) {
        const target = clonedFields[index];
        if (live instanceof HTMLCanvasElement) {
            const image = document.createElement("img");
            try {
                image.src = live.toDataURL();
            } catch {
                // A tainted canvas stays blank.
            }
            for (const name of [ "class", "style" ]) {
                const value = target.getAttribute(name);
                if (value !== null) image.setAttribute(name, value);
            }
            target.replaceWith(image);
        } else if (live instanceof HTMLTextAreaElement) {
            target.textContent = live.value;
        } else if (live instanceof HTMLInputElement) {
            target.setAttribute("value", live.value);
            if (live.checked) target.setAttribute("checked", "");
        }
    }
    const removed = "script, link, style, noscript, template, iframe";
    for (const element of clone.querySelectorAll(removed)) {
        element.remove();
    }
    clone.querySelector("body")?.classList.remove("light-theme", "dark-theme");
    for (const image of clone.querySelectorAll("img")) {
        const source = image.getAttribute("src");
        image.removeAttribute("srcset");
        if (!source || source.startsWith("data:")) continue;
        const blob = await (await fetch(new URL(source, document.baseURI))).blob();
        image.src = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
        });
    }
    let inlineStyles = "";
    for (const element of clone.querySelectorAll("*")) {
        for (const attribute of [ ...element.attributes ]) {
            if (attribute.name.startsWith("on")) element.removeAttribute(attribute.name);
        }
        element.removeAttribute("contenteditable");
        inlineStyles += `${element.getAttribute("style") ?? ""}\n`;
    }
    const head = clone.querySelector("head");
    if (head) head.innerHTML = "<meta charset=\"utf-8\">"
        + "<meta name=\"viewport\" content=\"width=device-width\">"
        + "<style>/*__CSS__*/</style>"
        + "<style>html{pointer-events:none;user-select:none;overflow:hidden}"
        + "*,::before,::after{animation:none!important;transition:none!important}</style>";

    return {
        html: `<!doctype html>\n${clone.outerHTML}`,
        css,
        chars: [ ...chars ].join(""),
        fontFaces,
        unusedFonts: [ ...unusedFonts ],
        inlineStyles,
        rulesKept,
        rulesDropped
    };
}

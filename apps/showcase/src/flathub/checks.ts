import fs from "fs";
import type { Browser } from "playwright";

import { checkList } from "../shared/build.ts";
import type { PngInfo } from "../shared/png.ts";

/** The parts of an AppStream metainfo file that Flathub shows on the app page. */
export interface Metainfo {
    id: string;
    name: string;
    summary: string;
    developer: string;
    license: string;
    descriptionHtml: string;
    hasParagraph: boolean;
    /** The number of items in each list of the description. */
    listSizes: number[];
    keywords: string[];
    urls: { type: string | null; href: string }[];
    /** The primary colors, keyed by `scheme_preference`. */
    branding: Record<string, string>;
    releases: { version: string | null; date: string | null; descriptionHtml: string }[];
    hasContentRating: boolean;
}

export interface FlathubShot {
    file: string;
    caption: string;
    dark: boolean;
    png: PngInfo | undefined;
}

/**
 * Reads the parts of an AppStream metainfo file that Flathub shows on the app page, with the
 * browser's `DOMParser`. The description keeps only the markup AppStream allows.
 */
export async function readMetainfo(browser: Browser, file: string): Promise<Metainfo> {
    const page = await browser.newPage();
    try {
        return await page.evaluate((xml) => {
            const doc = new DOMParser().parseFromString(xml, "application/xml");
            const component = doc.documentElement;
            const text = (element: Element | undefined) =>
                element?.textContent.trim().replace(/\s+/g, " ") ?? "";
            const child = (parent: Element | undefined, name: string) => [
                ...parent?.children ?? []
            ].find((element) => element.localName === name);
            const children = (parent: Element | undefined, name: string) => [
                ...parent?.children ?? []
            ].filter((c) => c.localName === name && !c.hasAttribute("xml:lang"));
            const toHtml = (element: Element | undefined) => {
                if (!element) return "";
                const allowed = new Set([ "p", "ul", "ol", "li", "em", "code" ]);
                const convert = (node: Node): string => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const span = document.createElement("span");
                        span.textContent = node.textContent;
                        return span.innerHTML;
                    }
                    if (!(node instanceof Element)) return "";
                    const inner = [ ...node.childNodes ].map(convert).join("");
                    return allowed.has(node.localName)
                        ? `<${node.localName}>${inner}</${node.localName}>`
                        : inner;
                };
                return [ ...element.childNodes ].map(convert).join("").trim();
            };
            const description = child(component, "description");
            const branding = child(component, "branding");
            return {
                id: text(child(component, "id")),
                name: text(child(component, "name")),
                summary: text(child(component, "summary")),
                developer: text(child(child(component, "developer") ?? component, "name")),
                license: text(child(component, "project_license")),
                descriptionHtml: toHtml(description),
                hasParagraph: children(description, "p").some((p) => text(p)),
                listSizes: [ ...description?.querySelectorAll("ul, ol") ?? [] ]
                    .map((list) => children(list, "li").length),
                keywords: children(child(component, "keywords"), "keyword").map(text),
                urls: children(component, "url")
                    .map((url) => ({ type: url.getAttribute("type"), href: text(url) })),
                branding: Object.fromEntries(children(branding, "color")
                    .filter((color) => color.getAttribute("type") === "primary")
                    .map((color) => [ color.getAttribute("scheme_preference"), text(color) ])),
                releases: children(child(component, "releases"), "release").map((release) => ({
                    version: release.getAttribute("version"),
                    date: release.getAttribute("date"),
                    descriptionHtml: toHtml(child(release, "description"))
                })),
                hasContentRating: !!child(component, "content_rating")
            };
        }, fs.readFileSync(file, "utf8"));
    } finally {
        await page.close();
    }
}

/**
 * Checks the metainfo and the captured screenshots against Flathub's quality guidelines
 * (docs.flathub.org, "Quality guidelines"). `window` is the logical size and scale the
 * screenshots were taken at, and `iconSvg` is the source of the scalable icon the flatpak
 * installs.
 */
export function checkFlathubListing(meta: Metainfo, shots: FlathubShot[],
    window: { width: number; height: number; scale: number }, iconSvg: string) {
    const { checks, check } = checkList();

    check("Name", "under 20 characters", meta.name.length, meta.name.length < 20);
    const summary = meta.summary;
    check("Summary", "at most 35 characters, ideally 10 to 25", summary.length,
        summary.length <= 35);
    check("Summary", "no trailing full stop", summary, !summary.endsWith("."));
    check("Summary", "does not start with an article", summary.split(" ")[0],
        !/^(a|an|the)$/i.test(summary.split(" ")[0]));
    check("Description", "at least one paragraph", meta.hasParagraph ? "yes" : "no",
        meta.hasParagraph);
    const longest = Math.max(0, ...meta.listSizes);
    check("Description", "lists of at most 10 items", longest || "no list", longest <= 10);

    const { light, dark } = meta.branding;
    check("Branding", "a light and a dark primary color", `${light ?? "none"} / ${dark ?? "none"}`,
        light && dark);
    if (light && dark) {
        const [ lightL, darkL ] = [ lightness(light), lightness(dark) ];
        check("Branding", "dark color darker than the light one",
            `${lightL.toFixed(2)} / ${darkL.toFixed(2)}`, darkL < lightL);
        check("Branding", "neither near white nor near black",
            `${lightL.toFixed(2)} / ${darkL.toFixed(2)}`,
            [ lightL, darkL ].every((l) => l > 0.1 && l < 0.9));
    }

    const [ latest ] = meta.releases;
    check("Releases", "the latest release has notes", latest?.version ?? "none",
        latest?.descriptionHtml);
    const withoutNotes = meta.releases.filter((release) => !release.descriptionHtml).length;
    check("Releases", "every release has notes", `${withoutNotes} without`, withoutNotes === 0);
    check("Content rating", "an OARS rating", meta.hasContentRating ? "yes" : "no",
        meta.hasContentRating);

    const [ , iconWidth, iconHeight ] = iconSvg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
    check("Icon", "a square SVG", iconWidth ? `${iconWidth} x ${iconHeight}` : "no viewBox",
        iconWidth && iconWidth === iconHeight);

    check("Screenshots", "3 to 10", shots.length, shots.length >= 3 && shots.length <= 10);
    check("Screenshots", "the first one in the default (light) style",
        shots[0]?.dark ? "dark" : "light", shots[0] && !shots[0].dark);
    check("Screenshots", "not only dark ones", `${shots.filter((s) => s.dark).length} dark`,
        shots.some((shot) => !shot.dark));
    const windowSize = `${window.width * window.scale} x ${window.height * window.scale}`;
    check("Screenshots", "window at most 1000 x 700, or 2000 x 1400 on HiDPI", windowSize,
        window.width <= 1000 && window.height <= 700 && window.scale <= 2);
    for (const shot of shots) {
        check(shot.file, "PNG with alpha, so the window shadow shows", describeSize(shot.png),
            shot.png?.alpha);
        check(`${shot.file} caption`, "one sentence, no full stop, not starting with a number",
            shot.caption, shot.caption && !shot.caption.endsWith(".") && !/^\d/.test(shot.caption));
    }
    return checks;
}

function describeSize(png: PngInfo | undefined) {
    return png ? `${png.width} x ${png.height}` : "missing";
}

/** The HSL lightness of a `#rrggbb` color, from 0 to 1. */
function lightness(hex: string) {
    const channels = (hex.replace("#", "").match(/../g) ?? [])
        .map((pair) => parseInt(pair, 16) / 255);
    return (Math.max(...channels) + Math.min(...channels)) / 2;
}

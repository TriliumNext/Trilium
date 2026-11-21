import fs from "fs";
import path from "path";
import type { Browser } from "playwright";

import { type BuildOptions, outDir, repoRoot } from "../shared/build.ts";
import { zoomOutMindMap } from "../shared/scenes.ts";
import {
    captureShots, encodeWebp, type Shot, waitForCalendar, waitForSlideThumbnails
} from "../website/build.ts";

/**
 * The User Guide figures captured from the demo document. `page` is the Markdown file under
 * `docs/User Guide/User Guide` and `image` the attachment beside it that the shot overwrites;
 * the attachment must already be registered in `!!!meta.json` (`docs.mjs image <page> <file>
 * --title demo.webp`), since the build never changes the tree. Shots are light unless
 * `colorSchemes` says otherwise.
 */
const DOCS_SHOTS: DocsShot[] = [
    { scene: "board", page: "Collections.md", image: "Collections_collection_board.webp" },
    { scene: "geo-map", page: "Collections.md", image: "Collections_collection_geomap.webp" },
    {
        query: "note.title = 'Trip calendar'", page: "Collections.md",
        image: "Collections_collection_calendar.webp", prepare: waitForCalendar
    },
    {
        query: "note.title = 'Places to visit'", page: "Collections.md",
        image: "Collections_collection_table.webp"
    },
    {
        query: "note.title = 'Introducing Trilium Notes'", page: "Collections.md",
        image: "Collections_collection_presentation.webp", prepare: waitForSlideThumbnails
    },
    {
        query: "note.title = 'Trip calendar'", page: "Collections/Calendar.md",
        image: "Calendar_demo.webp", prepare: waitForCalendar
    },
    {
        query: "note.title = 'Places to visit'", page: "Collections/Table.md",
        image: "Table_demo.webp"
    },
    {
        query: "note.title = 'Introducing Trilium Notes'", page: "Collections/Presentation.md",
        image: "Presentation_demo.webp", prepare: waitForSlideThumbnails
    },
    { scene: "board", page: "Collections/Kanban Board.md", image: "Kanban Board_demo.webp" },
    { scene: "text", page: "Note Types/Text.md", image: "Text_demo.webp" },
    { scene: "dark", page: "Note Types/Code.md", image: "Code_demo.webp" },
    { scene: "canvas", page: "Note Types/Canvas.md", image: "Canvas_demo.webp" },
    {
        scene: "mind-map", page: "Note Types/Mind Map.md", image: "Mind Map_demo.webp",
        prepare: (page) => zoomOutMindMap(page, 2)
    },
    {
        query: "note.title = 'Packing for Rome'", page: "AI.md", image: "AI_demo.webp",
        window: { noteWidth: 720, height: 1000 }
    },
    {
        scene: "tree", area: "tree", page: "Basic Concepts and Features/UI Elements/Note Tree.md",
        image: "Note Tree_demo.webp"
    },
    {
        scene: "dark", area: "window", colorSchemes: [ "dark" ],
        page: "Basic Concepts and Features/Themes.md", image: "Themes_demo-dark.webp"
    }
];

interface DocsShot extends Omit<Shot, "area"> {
    area?: Shot["area"];
    page: string;
    image: string;
}

export const DOCS_TARGETS = {
    "user-guide": buildDocs
};

/**
 * Captures `DOCS_SHOTS` at 1x, writes each as WebP to `out/docs` and over its attachment in the
 * User Guide, and sets the size of the page's `<img>` to the image's. Run `docs.mjs sync`
 * afterwards to carry them into the in-app help.
 */
async function buildDocs(browser: Browser, options: BuildOptions) {
    const docsOutDir = path.join(outDir, "docs");
    const guideDir = path.join(repoRoot, "docs", "User Guide", "User Guide");
    fs.mkdirSync(docsOutDir, { recursive: true });
    const shots = DOCS_SHOTS
        .filter((shot) => options.only?.includes(shot.scene ?? shot.image) ?? true)
        .map((shot) => ({ area: "note" as const, colorSchemes: [ "light" as const ], ...shot }));
    for (const shot of shots) {
        const target = path.join(guideDir, path.dirname(shot.page), shot.image);
        if (!fs.existsSync(target)) {
            throw new Error(`${path.relative(repoRoot, target)} is not registered; run `
                + `docs.mjs image "${shot.page}" <file> --title ${shot.image.split("_").pop()}`);
        }
    }
    await captureShots(browser, options, shots, {
        colorSchemes: [ ...new Set(shots.flatMap((shot) => shot.colorSchemes)) ],
        scale: 1,
        async write(shot, _colorScheme, png) {
            const webp = await encodeWebp(browser, png);
            const output = path.join(docsOutDir, shot.image);
            fs.writeFileSync(output, webp);
            fs.copyFileSync(output, path.join(guideDir, path.dirname(shot.page), shot.image));
            resizeFigure(path.join(guideDir, shot.page), shot.image, png.readUInt32BE(16),
                png.readUInt32BE(20));
            console.log(`  ${shot.image} (${Math.round(webp.length / 1024)} KB)`);
        }
    });
}

/**
 * Sets `width`, `height` and the `aspect-ratio` style of every `<img>` in `pagePath` whose `src`
 * is `image`, and fails when the page has none.
 */
function resizeFigure(pagePath: string, image: string, width: number, height: number) {
    const markdown = fs.readFileSync(pagePath, "utf8");
    const sources = new Set([ image, image.replaceAll("&", "&amp;"), encodeURI(image) ]);
    let found = false;
    const updated = markdown.replace(/<img\b[^>]*>/g, (tag) => {
        const src = /\ssrc="([^"]*)"/.exec(tag)?.[1];
        if (!src || !sources.has(src)) return tag;
        found = true;
        return tag
            .replace(/aspect-ratio:\s*\d+\/\d+/, `aspect-ratio:${width}/${height}`)
            .replace(/\swidth="\d+"/, ` width="${width}"`)
            .replace(/\sheight="\d+"/, ` height="${height}"`);
    });
    if (!found) throw new Error(`${pagePath} has no <img src="${image}">.`);
    if (updated !== markdown) fs.writeFileSync(pagePath, updated);
}

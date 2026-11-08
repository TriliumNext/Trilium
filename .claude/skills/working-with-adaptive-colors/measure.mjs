#!/usr/bin/env node
/**
 * Measures the theme-adaptive colors in headless Chromium: loads the real stylesheets, applies
 * each palette color in every role, reads the adapted color back as sRGB through a canvas and
 * prints the shades and the WCAG contrast checks.
 *
 *   node .claude/skills/working-with-adaptive-colors/measure.mjs [options]
 *
 *   --page app|share      which dark-mode switch and page colors to use (default: app)
 *   --colors a,b,...      measure these colors instead of the text editor palette
 *   --set name=value      override a limit, e.g. --set --adaptive-text-dark-min-lightness=78
 *   --json                print the raw results as JSON
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const ROLES = [
    { key: "text", variable: "--tn-color", property: "color", tag: "span" },
    { key: "background", variable: "--tn-background", property: "background-color", tag: "span" },
    { key: "table-border", variable: "--tn-border-color", property: "border-color", tag: "td" },
    {
        key: "table-background", variable: "--tn-background", property: "background-color",
        tag: "td"
    }
];

const TARGETS = { text: 4.5, themeTextOnBackground: 4.5, tableBorder: 3, textOnBackground: 4.5 };

const args = parseArgs(process.argv.slice(2));
const page = args.page === "share" ? sharePage() : appPage();
const colors = args.colors ?? readPalette();
const results = await measure(page, colors, args.overrides);

if (args.json) {
    console.log(JSON.stringify(results, null, 2));
} else {
    printResults(page, results);
}

/** The stylesheets and page colors of the app, with the Next themes' main colors. */
function appPage() {
    return {
        name: "app",
        css: [ read("packages/ckeditor5/src/theme/adaptive_colors.css"),
            read("apps/client/src/stylesheets/adaptive-colors.css") ],
        darkTarget: "body",
        darkClass: "dark-theme",
        schemes: {
            light: readThemeColors("apps/client/src/stylesheets/theme-next-light.css"),
            dark: readThemeColors("apps/client/src/stylesheets/theme-next-dark.css")
        }
    };
}

/** The stylesheets and page colors of a shared page. */
function sharePage() {
    const base = read("packages/share-theme/src/base.css");
    const darkStart = base.indexOf("html.theme-dark");
    return {
        name: "share",
        css: [ read("packages/ckeditor5/src/theme/adaptive_colors.css"),
            read("packages/share-theme/src/content/adaptive_colors.css")
                .replace(/@import[^;]*;/g, "") ],
        darkTarget: "html",
        darkClass: "theme-dark",
        schemes: {
            light: {
                page: readVariable(base, "--background-primary"),
                text: readVariable(base, "--text-primary")
            },
            dark: {
                page: readVariable(base.slice(darkStart), "--background-primary"),
                text: readVariable(base.slice(darkStart), "--text-primary")
            }
        }
    };
}

function readThemeColors(path) {
    const css = read(path);
    return {
        page: readVariable(css, "--main-background-color"),
        text: readVariable(css, "--main-text-color")
    };
}

/** The four greys and the eleven hues of `color_palette.ts`, with their labels. */
function readPalette() {
    const palette = read("apps/client/src/widgets/type_widgets/text/color_palette.ts");
    const picker = read("apps/client/src/widgets/react/ColorPicker.tsx");
    const greys = [ ...palette.matchAll(/color: "(#[0-9a-f]{6})", label: "([^"]+)"/gi) ]
        .map(([ , color, label ]) => ({ color, label }));
    const hueLabels = [ ...between(palette, "HUE_LABELS = [", "]").matchAll(/"([^"]+)"/g) ]
        .map(([ , label ]) => label);
    const hues = [ ...between(picker, "DEFAULT_COLOR_PALETTE = [", "]").matchAll(/"(#[^"]+)"/g) ]
        .map(([ , color ], index) => ({ color, label: hueLabels[index] ?? "Pink" }));
    return [ ...greys, ...hues ];
}

async function measure(page, colors, overrides) {
    const browser = await chromium.launch();
    try {
        const tab = await browser.newPage();
        const overrideCss = overrides.length
            ? `:root { ${overrides.map(([ name, value ]) => `${name}: ${value};`).join(" ")} }`
            : "";
        await tab.setContent(`<!doctype html><style>${page.css.join("\n")}\n${overrideCss}</style>`
            + "<body><table><tbody><tr id=\"row\"></tr></tbody></table><div id=\"spans\"></div>");
        const results = {};
        for (const [ scheme, pageColors ] of Object.entries(page.schemes)) {
            results[scheme] = await tab.evaluate(measureInPage, {
                colors, roles: ROLES, pageColors, isDark: scheme === "dark",
                darkTarget: page.darkTarget, darkClass: page.darkClass
            });
        }
        return results;
    } finally {
        await browser.close();
    }
}

/** Runs in the page: the adapted sRGB hex of every color in every role, and the page colors. */
function measureInPage({ colors, roles, pageColors, isDark, darkTarget, darkClass }) {
    const target = darkTarget === "html" ? document.documentElement : document.body;
    target.classList.toggle(darkClass, isDark);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const toHex = (value) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "#000000";
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [ r, g, b ] = context.getImageData(0, 0, 1, 1).data;
        return `#${[ r, g, b ].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    };

    const shades = [];
    for (const { color, label } of colors) {
        const entry = { color, label: label ?? color };
        for (const role of roles) {
            const element = document.createElement(role.tag);
            element.setAttribute("style", `${role.property}:${color};${role.variable}:${color}`);
            const parent = document.getElementById(role.tag === "td" ? "row" : "spans");
            parent?.append(element);
            entry[role.key] = toHex(getComputedStyle(element).getPropertyValue(role.property));
            element.remove();
        }
        shades.push(entry);
    }
    return { page: toHex(pageColors.page), text: toHex(pageColors.text), shades };
}

function printResults(page, results) {
    console.log(`Adapted shades (${page.name} page)\n`);
    const header = [ "Color", "Source" ];
    for (const role of ROLES) {
        header.push(`${role.key} light`, `${role.key} dark`);
    }
    const rows = results.light.shades.map((light, index) => {
        const dark = results.dark.shades[index];
        const row = [ light.label, light.color ];
        for (const role of ROLES) {
            row.push(light[role.key], dark[role.key]);
        }
        return row;
    });
    printTable(header, rows);

    console.log("\nWCAG contrast, lowest pair");
    const checkRows = [];
    for (const [ scheme, { page: pageColor, text, shades } ] of Object.entries(results)) {
        const checks = {
            text: lowest(shades, (shade) => [ shade.text, pageColor, shade.label ]),
            themeTextOnBackground:
                lowest(shades, (shade) => [ text, shade.background, shade.label ]),
            tableBorder:
                lowest(shades, (shade) => [ shade["table-border"], pageColor, shade.label ]),
            textOnBackground: lowest(shades.flatMap((fg) => shades.map((bg) => [ fg, bg ])),
                ([ fg, bg ]) => [ fg.text, bg.background, `${fg.label} on ${bg.label}` ])
        };
        for (const [ check, { ratio, label } ] of Object.entries(checks)) {
            const verdict = ratio >= TARGETS[check] ? "ok" : "BELOW";
            checkRows.push([ `${scheme} (${pageColor})`, check, ratio.toFixed(2),
                String(TARGETS[check]), verdict, label ]);
        }
    }
    printTable([ "Scheme (page)", "Check", "Ratio", "Target", "", "Lowest" ], checkRows);
}

function lowest(items, pick) {
    let result = { ratio: Infinity, label: "" };
    for (const item of items) {
        const [ a, b, label ] = pick(item);
        const ratio = contrast(a, b);
        if (ratio < result.ratio) {
            result = { ratio, label };
        }
    }
    return result;
}

function contrast(a, b) {
    const [ lighter, darker ] = [ luminance(a), luminance(b) ].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex) {
    const channels = [ 1, 3, 5 ].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const [ r, g, b ] = channels
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function printTable(header, rows) {
    const widths = header.map((title, column) =>
        Math.max(title.length, ...rows.map((row) => String(row[column]).length)));
    const format = (row) => row
        .map((cell, column) => String(cell).padEnd(widths[column]))
        .join("  ");
    console.log(format(header));
    console.log(widths.map((width) => "-".repeat(width)).join("  "));
    for (const row of rows) {
        console.log(format(row));
    }
}

function parseArgs(argv) {
    const result = { page: "app", colors: undefined, overrides: [], json: false };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--page") {
            result.page = argv[++index];
        } else if (arg === "--colors") {
            // Commas inside `rgb()` or `hsl()` do not separate colors.
            result.colors = argv[++index].split(/,(?![^(]*\))/)
                .map((color) => ({ color: color.trim() }));
        } else if (arg === "--set") {
            const [ name, value ] = argv[++index].split("=");
            result.overrides.push([ name, value ]);
        } else if (arg === "--json") {
            result.json = true;
        } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(1);
        }
    }
    return result;
}

function readVariable(css, name) {
    const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) {
        throw new Error(`${name} not found`);
    }
    return match[1].trim();
}

function between(text, start, end) {
    const from = text.indexOf(start) + start.length;
    return text.slice(from, text.indexOf(end, from));
}

function read(path) {
    return readFileSync(join(ROOT, path), "utf8");
}

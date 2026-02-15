export async function buildMarkerIcon(color: string, iconClass: string, scale = window.devicePixelRatio || 1) {
    const iconUrl = await snapshotIcon(iconClass, 16 * scale);
    return `\
<svg width="${25 * scale}" height="${41 * scale}" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${color}" />
<circle cx="12.5" cy="12.5" r="8" fill="white" />
<image href="${iconUrl}" x="4.5" y="4.5" width="16" height="16" preserveAspectRatio="xMidYMid meet" />
</svg>
    `;
}

async function snapshotIcon(iconClass: string, size: number) {
    await document.fonts.ready;
    const glyph = getGlyphFromClass(iconClass);
    const rendered = renderMarkerCanvas({
        color: "black",
        glyph,
        size
    });
    return rendered?.toDataURL();
}

function renderMarkerCanvas({
    color,
    glyph,   // e.g. "\uf123"
    size = 32,
    scale = window.devicePixelRatio || 1
}) {
    const canvas = document.createElement("canvas");

    // High-DPI canvas
    canvas.width = size * scale;
    canvas.height = size * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Scale for retina
    ctx.scale(scale, scale);

    ctx.clearRect(0, 0, size, size);

    // Set font
    ctx.font = `${size}px ${glyph.fontFamily}`;
    ctx.fillStyle = color;

    // Measure glyph
    const metrics = ctx.measureText(glyph.content);

    const glyphWidth =
    metrics.actualBoundingBoxLeft +
    metrics.actualBoundingBoxRight;

    const glyphHeight =
    metrics.actualBoundingBoxAscent +
    metrics.actualBoundingBoxDescent;

    // Center position
    const x = (size - glyphWidth) / 2 + metrics.actualBoundingBoxLeft;
    const y = (size - glyphHeight) / 2 + metrics.actualBoundingBoxAscent;

    // Draw
    ctx.fillText(glyph.content, x, y);

    return canvas;
}

function getGlyphFromClass(iconClass: string) {
    const el = document.createElement("span");
    el.className = iconClass;

    document.body.appendChild(el);

    const style = window.getComputedStyle(el, "::before");
    const content = style.getPropertyValue("content");
    const fontFamily = style.getPropertyValue("font-family");

    document.body.removeChild(el);

    if (!content || content === "none") {
        return null;
    }

    // content is usually quoted like: '"\f123"'
    return {
        fontFamily,
        content: content.replace(/^["']|["']$/g, "")
    };
}

export function svgToImage(svgString){
    return new Promise<HTMLImageElement>(resolve => {
        const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };

        img.src = url;
        document.body.appendChild(img);
    });
}

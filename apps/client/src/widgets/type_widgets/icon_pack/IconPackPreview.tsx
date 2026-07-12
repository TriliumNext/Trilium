import "./IconPackPreview.css";

import { useEffect, useMemo, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import debounce from "../../../services/debounce";
import { t } from "../../../services/i18n";
import { useNoteLabel } from "../../react/hooks";
import IsolatedFrame from "../../react/IsolatedFrame";
import NoItems from "../../react/NoItems";
import previewStylesheet from "./icon_pack_preview.css?raw";

/** How long to wait after the last edit before re-parsing and re-rendering the (potentially large) preview. */
const PREVIEW_DEBOUNCE_MS = 1500;

/** In non-interactive previews (collection tiles) only this many glyphs are rendered to stay lightweight;
 * the count line still reports the true total. */
const NON_INTERACTIVE_ICON_LIMIT = 250;

/** Theme variables forwarded into the isolated preview frame so it matches the app's colours. */
const PREVIEW_CSS_VARS = [
    "--main-text-color",
    "--hover-item-background-color",
    "--hover-item-text-color",
    "--accented-background-color"
];

interface IconPackPreviewProps {
    note: FNote;
    content: string;
    /** When `false`, glyphs get no hover highlight and no tooltips (read-only previews). Defaults to `true`. */
    interactive?: boolean;
}

/**
 * Renders an icon pack's manifest as a grid of glyphs inside an isolated frame. Shared between the
 * icon-pack editor's preview pane and the read-only content renderer (collections, child listings).
 *
 * When {@link IconPackPreviewProps.interactive} is `false` (read-only previews), glyphs get no hover
 * highlight and no tooltips.
 */
export function IconPackPreview({ note, content, interactive = true }: IconPackPreviewProps) {
    // Fall back to the disabled label so disabled packs (#disabled:iconPack) still show their class in tooltips.
    const [ enabledPrefix ] = useNoteLabel(note, "iconPack");
    const prefix = enabledPrefix ?? note.getLabelValue("disabled:iconPack");
    // The user isn't meant to see the preview update on every keystroke — it lags a beat behind.
    const debounced = useDebouncedValue(content, PREVIEW_DEBOUNCE_MS);
    const font = useIconPackFont(note);

    const parsed = useMemo(() => parseManifest(debounced), [ debounced ]);
    const css = useMemo(() => buildPreviewCss(font), [ font ]);

    if (!parsed.ok) {
        return <div className="icon-pack-preview"><NoItems icon="bx bx-error-circle" text={t("icon_pack.invalid_manifest")} /></div>;
    }
    // Empty content means the manifest hasn't been loaded/typed yet — stay blank rather than flashing
    // the "no icons" state before the real content arrives.
    if (!debounced.trim()) {
        return <div className="icon-pack-preview" />;
    }
    if (!parsed.icons.length) {
        return <div className="icon-pack-preview"><NoItems icon="bx bx-images" text={t("icon_pack.no_icons")} /></div>;
    }

    // Keep read-only tiles cheap by rendering only a capped sample; the count line still shows the true total.
    const visibleIcons = interactive ? parsed.icons : parsed.icons.slice(0, NON_INTERACTIVE_ICON_LIMIT);

    return (
        <IsolatedFrame className="icon-pack-frame" title={t("icon_pack.preview_title")} css={css} cssVars={PREVIEW_CSS_VARS} bodyClassName={interactive ? "interactive" : undefined}>
            <div className="ip-grid">
                {visibleIcons.map((icon) => (
                    <div className="ip-cell" key={icon.id} title={interactive ? iconTooltip(prefix, icon) : undefined}>
                        <span className="ip-glyph">{icon.glyph}</span>
                    </div>
                ))}
            </div>
            <div className="ip-count">{t("icon_pack.count", { count: parsed.icons.length })}</div>
        </IsolatedFrame>
    );
}

interface PreviewIcon {
    id: string;
    glyph: string;
    terms: string[];
}

/** Builds the hover tooltip: the usable CSS class, the glyph's escaped code point, and the search terms. */
function iconTooltip(prefix: string | null | undefined, icon: PreviewIcon): string {
    const cssClass = prefix ? `${prefix} ${icon.id}` : icon.id;
    const codePoint = icon.glyph.codePointAt(0);
    const code = codePoint != null ? `\\${codePoint.toString(16)}` : "";
    return t("icon_pack.tooltip", { class: cssClass, code, terms: icon.terms.join(", ") });
}

type ParsedManifest =
    | { ok: true; icons: PreviewIcon[] }
    | { ok: false };

export function parseManifest(content: string): ParsedManifest {
    if (!content.trim()) return { ok: true, icons: [] };

    let data: unknown;
    try {
        data = JSON.parse(content);
    } catch {
        return { ok: false };
    }

    const rawIcons = (data as { icons?: unknown })?.icons;
    if (!rawIcons || typeof rawIcons !== "object") return { ok: false };

    const icons = Object.entries(rawIcons as Record<string, unknown>).map(([ id, value ]) => {
        const entry = value as { glyph?: unknown; terms?: unknown };
        const glyph = typeof entry?.glyph === "string" ? resolveGlyph(entry.glyph) : "";
        const terms = Array.isArray(entry?.terms) ? entry.terms.filter((term): term is string => typeof term === "string") : [];
        return { id, glyph, terms };
    });
    return { ok: true, icons };
}

/**
 * Returns the actual glyph character. Some manifests store the glyph as a literal escape string
 * (e.g. a CSS-style escape) rather than the real character; those are converted to their code
 * point. A value that is already a real character is returned unchanged.
 */
export function resolveGlyph(raw: string): string {
    const match = raw.match(/^\\u?([0-9a-fA-F]{2,6})$/);
    if (match) {
        const codePoint = parseInt(match[1], 16);
        // The regex admits up to 6 hex digits; guard the valid Unicode range so an out-of-range escape
        // (e.g. "\110000") isn't handed to String.fromCodePoint, which throws RangeError above U+10FFFF.
        if (!Number.isNaN(codePoint) && codePoint <= 0x10ffff) return String.fromCodePoint(codePoint);
    }
    return raw;
}

/** MIME types recognised as icon-pack fonts, in the same order of preference the server uses. */
const FONT_MIME_TO_FORMAT: Record<string, string> = {
    "font/woff2": "woff2",
    "font/woff": "woff",
    "font/ttf": "truetype"
};

interface IconPackFont {
    url: string;
    format: string;
}

/** Resolves the best font attachment on the note to an absolute download URL, mirroring the server's selection. */
function useIconPackFont(note: FNote): IconPackFont | null {
    const [ font, setFont ] = useState<IconPackFont | null>(null);
    useEffect(() => {
        let cancelled = false;
        note.getAttachmentsByRole("file").then((attachments) => {
            if (cancelled) return;
            const best = Object.keys(FONT_MIME_TO_FORMAT)
                .map((mime) => attachments.find((attachment) => attachment.mime === mime))
                .find(Boolean);
            // Resolve against the host document's base URL since the isolated frame has none.
            setFont(best
                ? { url: new URL(`api/attachments/download/${best.attachmentId}`, document.baseURI).href, format: FONT_MIME_TO_FORMAT[best.mime] }
                : null);
        }).catch(() => {
            if (!cancelled) setFont(null);
        });
        return () => { cancelled = true; };
    }, [ note ]);
    return font;
}

const PREVIEW_FONT_FAMILY = "tn-icon-pack-preview";

function buildPreviewCss(font: IconPackFont | null): string {
    const fontFace = font
        ? `@font-face { font-family: "${PREVIEW_FONT_FAMILY}"; src: url("${font.url}") format("${font.format}"); font-display: block; }`
        : "";
    // The static rules live in icon_pack_preview.css (its `.ip-glyph` uses PREVIEW_FONT_FAMILY).
    return `${fontFace}\n${previewStylesheet}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [ debounced, setDebounced ] = useState(value);
    const commit = useMemo(() => debounce(setDebounced, delayMs), [ delayMs ]);
    useEffect(() => {
        commit(value);
        return commit.clear;
    }, [ value, commit ]);
    return debounced;
}

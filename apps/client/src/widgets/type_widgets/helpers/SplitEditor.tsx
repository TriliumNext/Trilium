import "./SplitEditor.css";

import Split from "@triliumnext/split.js";
import { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { DEFAULT_GUTTER_SIZE } from "../../../services/resizer";
import utils, { isMobile } from "../../../services/utils";
import { ExtendedAdmonition } from "../../react/Admonition";
import { Badge } from "../../react/Badge";
import { useEffectiveReadOnly, useNoteBlob, useNoteLabel, useTriliumOption } from "../../react/hooks";
import { EditableCode, EditableCodeProps, ReadOnlyCode } from "../code/Code";
import { type DisplayMode, resolveDisplayMode } from "./split_editor_mode";

export interface SplitEditorProps extends EditableCodeProps {
    className?: string;
    error?: string | null;
    /** When the preview still shows a previous successful render despite the current {@link error}. */
    previewStale?: boolean;
    splitOptions?: Split.Options;
    previewContent: ComponentChildren;
    previewButtons?: ComponentChildren;
    editorBefore?: ComponentChildren;
    forceOrientation?: "horizontal" | "vertical";
    /** Forces the editor pane into read-only mode regardless of the note's own read-only state, e.g. for note types whose content isn't editable as text. */
    forceReadOnly?: boolean;
    /** Replaces the default CodeMirror editor pane, e.g. for note types whose content shouldn't be shown in a code editor (large `file` notes). Implies read-only; combine with {@link forceReadOnly} so the preview is still fed from the blob. */
    editorContent?: ComponentChildren;
    extraContent?: ComponentChildren;
}

/**
 * Abstract `TypeWidget` which contains a preview and editor pane, each displayed on half of the available screen.
 *
 * The active view is driven by the `#displayMode` label (`source`, `split`, `preview`); when unset
 * it falls back to the `#readOnly` label (truthy → preview, falsy → split). `#displayMode` always
 * wins so an explicit choice is never overridden by `#readOnly`. The editor and preview panes are
 * always mounted; switching modes only toggles a CSS class so CodeMirror state, scroll position and
 * pending edits survive the change.
 *
 * Features:
 *
 * - The two panes are resizeable via a split, on desktop. The split can be optionally customized via {@link buildSplitExtraOptions}.
 * - Can display errors to the user via {@link setError}.
 * - Horizontal or vertical orientation for the editor/preview split, adjustable via the switch split orientation button floating button.
 */
export default function SplitEditor({ note, noteContext, error, previewStale, splitOptions, previewContent, previewButtons, className, editorBefore, forceOrientation, forceReadOnly, editorContent, extraContent, ...editorProps }: SplitEditorProps) {
    const splitEditorOrientation = useSplitOrientation(forceOrientation);
    const [ displayMode ] = useNoteLabel(note, "displayMode");
    const readOnly = useEffectiveReadOnly(note, noteContext) || Boolean(forceReadOnly);
    const mode = resolveDisplayMode(displayMode, readOnly);
    const { editorMounted, previewMounted } = useMountedPanes(mode);

    // The editor only feeds content to the preview when it's an `EditableCode`. `ReadOnlyCode`
    // doesn't expose `onContentChanged`, and in preview-only mode the editor isn't mounted at all —
    // in both cases we read the blob directly so the preview stays populated.
    const editorPropagatesContent = editorMounted.current && !readOnly;
    const fallbackBlob = useNoteBlob(editorPropagatesContent ? null : note);
    const onContentChangedRef = useRef(editorProps.onContentChanged);
    useEffect(() => { onContentChangedRef.current = editorProps.onContentChanged; });
    useEffect(() => {
        if (!editorPropagatesContent && fallbackBlob) {
            onContentChangedRef.current?.(fallbackBlob.content ?? "");
        }
    }, [ fallbackBlob, editorPropagatesContent ]);

    const editor = (
        <>
            {editorBefore}
            <div className="note-detail-split-editor">
                {editorContent ?? (readOnly
                    ? <ReadOnlyCode note={note} noteContext={noteContext} {...editorProps} />
                    : <EditableCode
                        note={note}
                        noteContext={noteContext}
                        lineWrapping={false}
                        updateInterval={750} debounceUpdate
                        {...editorProps}
                    />)}
            </div>
            {extraContent}
        </>
    );

    return (
        <SplitLayout
            className={`note-detail-printable ${className ?? ""}`}
            mode={mode}
            orientation={splitEditorOrientation}
            splitOptions={splitOptions}
            editor={editor}
            isEditorMounted={editorMounted.current}
            isPreviewMounted={previewMounted.current}
            error={error}
            previewStale={previewStale}
            previewContent={previewContent}
            previewButtons={previewButtons}
        />
    );
}

export interface SplitLayoutProps {
    className?: string;
    mode: DisplayMode;
    orientation: "horizontal" | "vertical";
    splitOptions?: Split.Options;
    /** The content of the editor pane. */
    editor: ComponentChildren;
    /** Whether each pane is mounted, see {@link useMountedPanes}. */
    isEditorMounted: boolean;
    isPreviewMounted: boolean;
    error?: string | null;
    /** When the preview still shows a previous successful render despite the current {@link error}. */
    previewStale?: boolean;
    previewContent: ComponentChildren;
    previewButtons?: ComponentChildren;
}

/**
 * The editor and preview panes of a split editor, laid out for `mode`, and the render error over
 * the preview. The panes stay mounted across modes, which only toggle a CSS class.
 */
export function SplitLayout({ className, mode, orientation, splitOptions, editor, isEditorMounted, isPreviewMounted, error, previewStale, previewContent, previewButtons }: SplitLayoutProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const editorCol = isEditorMounted && (
        <div className="note-detail-split-editor-col">{editor}</div>
    );

    const previewCol = isPreviewMounted && <PreviewContainer
        error={error}
        previewStale={previewStale}
        previewContent={previewContent}
        previewButtons={previewButtons}
    />;

    useEffect(() => {
        if (mode !== "split" || !utils.isDesktop() || !containerRef.current) return;
        // Only the visible (non-display:none) panes participate in the split.
        const elements = (Array.from(containerRef.current.children) as HTMLElement[]);
        const splitInstance = Split(elements, {
            rtl: glob.isRtl,
            sizes: [ 50, 50 ],
            direction: orientation,
            gutterSize: DEFAULT_GUTTER_SIZE,
            ...splitOptions
        });

        return () => splitInstance.destroy();
    }, [ orientation, mode ]);

    const layoutClass = mode === "source" ? "split-source-only"
        : mode === "preview" ? "split-read-only"
            : `split-${orientation}`;

    return (
        <div ref={containerRef} className={`note-detail-split ${layoutClass} ${className ?? ""}`}>
            {orientation === "horizontal"
                ? <>{editorCol}{previewCol}</>
                : <>{previewCol}{editorCol}</>}
        </div>
    );
}

/**
 * Which panes of a split editor are mounted: each from the first `mode` that shows it, so that
 * switching back stays instant.
 */
export function useMountedPanes(mode: DisplayMode) {
    const editorMounted = useRef(mode !== "preview");
    const previewMounted = useRef(mode !== "source");
    if (mode !== "preview") editorMounted.current = true;
    if (mode !== "source") previewMounted.current = true;
    return { editorMounted, previewMounted };
}

function PreviewContainer({ error, previewStale, previewContent, previewButtons }: {
    error?: string | null;
    previewStale?: boolean;
    previewContent: ComponentChildren;
    previewButtons?: ComponentChildren;
}) {
    const { summary, details } = error ? splitPreviewError(error) : {};
    return (
        <div className="note-detail-split-preview-col">
            <div className={`note-detail-split-preview ${error ? "on-error" : ""}`}>
                {previewContent}
            </div>
            {error && (
                <ExtendedAdmonition
                    className="note-detail-error-card"
                    type="caution"
                    icon="bx bx-error-circle"
                    title={t("split_editor.render_error")}
                    detailsLabel={t("split_editor.show_details")}
                    details={details && <pre>{details}</pre>}
                >
                    <div className="note-detail-error-message">{summary}</div>
                </ExtendedAdmonition>
            )}
            {error && previewStale && (
                <Badge
                    className="note-detail-error-stale-badge"
                    icon="bx bx-history"
                    text={t("split_editor.last_valid_render")}
                />
            )}
            {/* Placed by whoever supplies them: they stand on a group that brings its own surface
                and pins itself to a corner of the pane (see the SVG section of SplitEditor.css). */}
            {previewButtons}
        </div>
    );
}

/**
 * Splits a raw preview/render error into its first line, shown under the title as a
 * headline, and the remaining lines, revealed by the "show details" collapsible. The
 * first line is never repeated in the details; `details` is omitted when the error is
 * a single line.
 */
function splitPreviewError(error: string): { summary: string; details?: string } {
    const trimmed = error.trim();
    const newlineIndex = trimmed.indexOf("\n");
    if (newlineIndex < 0) {
        return { summary: trimmed };
    }
    return {
        summary: trimmed.slice(0, newlineIndex).trim(),
        details: trimmed.slice(newlineIndex + 1).trim() || undefined
    };
}

function useSplitOrientation(forceOrientation?: "horizontal" | "vertical") {
    const [ splitEditorOrientation ] = useTriliumOption("splitEditorOrientation");
    if (forceOrientation) return forceOrientation;
    if (isMobile()) return "vertical";
    if (!splitEditorOrientation) return "horizontal";
    return splitEditorOrientation as "horizontal" | "vertical";
}

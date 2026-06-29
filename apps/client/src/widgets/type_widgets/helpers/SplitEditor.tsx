import "./SplitEditor.css";

import Split from "@triliumnext/split.js";
import { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { DEFAULT_GUTTER_SIZE } from "../../../services/resizer";
import utils, { isMobile } from "../../../services/utils";
import ActionButton, { ActionButtonProps } from "../../react/ActionButton";
import { ExtendedAdmonition } from "../../react/Admonition";
import { Badge } from "../../react/Badge";
import { useEffectiveReadOnly, useNoteBlob, useNoteLabel, useTriliumOption } from "../../react/hooks";
import { EditableCode, EditableCodeProps, ReadOnlyCode } from "../code/Code";

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
export default function SplitEditor({ note, noteContext, error, previewStale, splitOptions, previewContent, previewButtons, className, editorBefore, forceOrientation, extraContent, ...editorProps }: SplitEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const splitEditorOrientation = useSplitOrientation(forceOrientation);
    const [ displayMode ] = useNoteLabel(note, "displayMode");
    const readOnly = useEffectiveReadOnly(note, noteContext);
    const mode = displayMode === "source" || displayMode === "split" || displayMode === "preview"
        ? displayMode
        : readOnly ? "preview" : "split";

    // Lazy-mount each pane on first need, then keep it mounted so subsequent switches stay instant.
    const editorMounted = useRef(mode !== "preview");
    const previewMounted = useRef(mode !== "source");
    if (mode !== "preview") editorMounted.current = true;
    if (mode !== "source") previewMounted.current = true;

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

    const editor = editorMounted.current && (
        <div className="note-detail-split-editor-col">
            {editorBefore}
            <div className="note-detail-split-editor">
                {readOnly
                    ? <ReadOnlyCode note={note} noteContext={noteContext} {...editorProps} />
                    : <EditableCode
                        note={note}
                        noteContext={noteContext}
                        lineWrapping={false}
                        updateInterval={750} debounceUpdate
                        noBackgroundChange
                        {...editorProps}
                    />}
            </div>
            {extraContent}
        </div>
    );

    const preview = previewMounted.current && <PreviewContainer
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
            direction: splitEditorOrientation,
            gutterSize: DEFAULT_GUTTER_SIZE,
            ...splitOptions
        });

        return () => splitInstance.destroy();
    }, [ splitEditorOrientation, mode ]);

    const layoutClass = mode === "source" ? "split-source-only"
        : mode === "preview" ? "split-read-only"
            : `split-${splitEditorOrientation}`;

    return (
        <div ref={containerRef} className={`note-detail-split note-detail-printable ${layoutClass} ${className ?? ""}`}>
            {splitEditorOrientation === "horizontal"
                ? <>{editor}{preview}</>
                : <>{preview}{editor}</>}
        </div>
    );
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
            <div className="btn-group btn-group-sm map-type-switcher content-floating-buttons preview-buttons bottom-right" role="group">
                {previewButtons}
            </div>
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

export function PreviewButton(props: Omit<ActionButtonProps, "titlePosition">) {
    return <ActionButton
        {...props}
        className="tn-tool-button"
        noIconActionClass
        titlePosition="top"
    />;
}

function useSplitOrientation(forceOrientation?: "horizontal" | "vertical") {
    const [ splitEditorOrientation ] = useTriliumOption("splitEditorOrientation");
    if (forceOrientation) return forceOrientation;
    if (isMobile()) return "vertical";
    if (!splitEditorOrientation) return "horizontal";
    return splitEditorOrientation as "horizontal" | "vertical";
}

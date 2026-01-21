import "./SplitEditor.css";

import Split from "@triliumnext/split.js";
import { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { DEFAULT_GUTTER_SIZE } from "../../../services/resizer";
import utils, { isMobile } from "../../../services/utils";
import ActionButton, { ActionButtonProps } from "../../react/ActionButton";
import Admonition from "../../react/Admonition";
import { useNoteLabelBoolean, useTriliumOption } from "../../react/hooks";
import { EditableCode, EditableCodeProps } from "../code/Code";

export interface SplitEditorProps extends EditableCodeProps {
    className?: string;
    error?: string | null;
    splitOptions?: Split.Options;
    previewContent: ComponentChildren;
    previewButtons?: ComponentChildren;
    editorBefore?: ComponentChildren;
    forceOrientation?: "horizontal" | "vertical";
}

/**
 * Abstract `TypeWidget` which contains a preview and editor pane, each displayed on half of the available screen.
 *
 * Features:
 *
 * - The two panes are resizeable via a split, on desktop. The split can be optionally customized via {@link buildSplitExtraOptions}.
 * - Can display errors to the user via {@link setError}.
 * - Horizontal or vertical orientation for the editor/preview split, adjustable via the switch split orientation button floating button.
 */
export default function SplitEditor({ note, error, splitOptions, previewContent, previewButtons, className, editorBefore, forceOrientation, ...editorProps }: SplitEditorProps) {
    const splitEditorOrientation = useSplitOrientation(forceOrientation);
    const [ readOnly ] = useNoteLabelBoolean(note, "readOnly");
    const containerRef = useRef<HTMLDivElement>(null);

    const editor = (!readOnly &&
        <div className="note-detail-split-editor-col">
            {editorBefore}
            <div className="note-detail-split-editor">
                <EditableCode
                    note={note}
                    lineWrapping={false}
                    updateInterval={750} debounceUpdate
                    noBackgroundChange
                    {...editorProps}
                />
            </div>
            {error && <Admonition type="caution" className="note-detail-error-container">
                {error}
            </Admonition>}
        </div>
    );

    const preview = (
        <div className="note-detail-split-preview-col">
            <div className={`note-detail-split-preview ${error ? "on-error" : ""}`}>
                {previewContent}
            </div>
            <div className="btn-group btn-group-sm map-type-switcher content-floating-buttons preview-buttons bottom-right" role="group">
                {previewButtons}
            </div>
        </div>
    );

    useEffect(() => {
        if (!utils.isDesktop() || !containerRef.current || readOnly) return;
        const elements = Array.from(containerRef.current?.children) as HTMLElement[];
        const splitInstance = Split(elements, {
            rtl: glob.isRtl,
            sizes: [ 50, 50 ],
            direction: splitEditorOrientation,
            gutterSize: DEFAULT_GUTTER_SIZE,
            ...splitOptions
        });

        return () => splitInstance.destroy();
    }, [ readOnly, splitEditorOrientation ]);

    return (
        <div ref={containerRef} className={`note-detail-split note-detail-printable ${`split-${splitEditorOrientation}`} ${readOnly ? "split-read-only" : ""} ${className ?? ""}`}>
            {splitEditorOrientation === "horizontal"
                ? <>{editor}{preview}</>
                : <>{preview}{editor}</>}
        </div>
    );
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

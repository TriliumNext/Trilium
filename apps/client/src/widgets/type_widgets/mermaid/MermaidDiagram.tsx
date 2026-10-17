import "./MermaidDiagram.css";

import type VanillaCodeMirror from "@triliumnext/codemirror";
import { MERMAID_ATTACHMENT_MIME } from "@triliumnext/commons";
import fullscreenIcon from "boxicons/svg/regular/bx-fullscreen.svg?raw";
import helpIcon from "boxicons/svg/regular/bx-help-circle.svg?raw";
import zoomInIcon from "boxicons/svg/regular/bx-zoom-in.svg?raw";
import zoomOutIcon from "boxicons/svg/regular/bx-zoom-out.svg?raw";
import type { RefObject } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { renderMermaidSvg } from "../../../services/mermaid";
import type { SourceEmbedProps } from "../../../services/source_embeds";
import { isMobile, openInAppHelpFromUrl } from "../../../services/utils";
import { OverlayFullscreenButton } from "../../react/OverlayControlGroup";
import { useZoomPanWheel } from "../../react/zoom_pan";
import { useZoomPanKeyboard } from "../../react/zoom_pan_keyboard";
import { SplitLayout, useMountedPanes } from "../helpers/SplitEditor";
import { type DisplayMode, resolveDisplayMode } from "../helpers/split_editor_mode";
import {
    SvgPreview, type SvgZoom, SvgZoomControls, useSvgRender, useSvgZoom
} from "../helpers/SvgSplitEditor";
import mermaidLinter from "../linters/mermaid";
import {
    type ContentEmbedTool,
    type ContentEmbedToolbarItem,
    type ContentEmbedToolProvider,
    needsFullscreenButton,
    showContentEmbedFullscreen,
    useContentEmbedDisplayMode,
    useContentEmbedEvent,
    useNeedsFullscreenButton
} from "../text/content_embed_tools";
import { useEditableEmbed } from "../text/editable_embed";

const CodeEmbedEditor = lazy(() => import("../code/CodeEmbedEditor"));

/**
 * A Mermaid diagram in an embed, laid out by the `SplitLayout` and shown in the `SvgPreview` of
 * the Mermaid note type: its source in CodeMirror, the diagram, or both side by side, as the
 * display mode of its embed picks. The source can be edited while the
 * Editable toggle of the embed is on. The zoom and fullscreen are buttons of
 * the toolbar of the embed. The source is kept inline or in an attachment, see
 * `SOURCE_EMBED_TYPES`.
 */
export default function MermaidDiagram({ content, editor }: SourceEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [ previewEl, setPreviewEl ] = useState<HTMLDivElement | null>(null);
    const [ source, setSource ] = useState(content);
    const { svg, error } = useMermaidRender(source);

    const zoom = useSvgZoom();
    const [ tools ] = useState(() => new MermaidDiagramTools(rootRef));
    const { canEdit, isEditing } = useEditableEmbed(rootRef, {
        editor,
        note: null,
        tools,
        focusTarget: ".cm-content"
    });
    const mode = resolveDisplayMode(useContentEmbedDisplayMode(rootRef), !isEditing);
    const { editorMounted, previewMounted } = useMountedPanes(mode);
    const isFullscreen = useIsEmbedFullscreen(rootRef);
    const hasFullscreenButton = useNeedsFullscreenButton(rootRef) && !isFullscreen;
    tools.setState(zoom, mode);

    // A source saved elsewhere, or undone, replaces the shown one unless it has unsaved edits.
    useEffect(() => {
        if (editor?.getUnsavedContent() === undefined) {
            setSource(content);
        }
    }, [ content ]);
    useZoomPanKeyboard(zoom.ref, previewEl);
    useZoomPanWheel(zoom.ref, previewEl, true);

    const setupEditor = useCallback((view: VanillaCodeMirror) => {
        view.setNamedExtension("mermaid-lint", mermaidLinter());
    }, []);

    return (
        <div ref={rootRef} className="mermaid-diagram">
            <SplitLayout
                className="svg-editor"
                mode={mode}
                orientation={isMobile() ? "vertical" : "horizontal"}
                editor={(
                    <div className="note-detail-split-editor">
                        <Suspense fallback={null}>
                            <CodeEmbedEditor
                                key={isEditing ? "editing" : "read-only"}
                                note={null}
                                editor={isEditing ? editor : undefined}
                                content={source}
                                mime={MERMAID_ATTACHMENT_MIME}
                                onClose={setSource}
                                onChange={setSource}
                                onReady={setupEditor}
                            />
                        </Suspense>
                    </div>
                )}
                isEditorMounted={editorMounted.current}
                isPreviewMounted={previewMounted.current}
                error={error}
                previewStale={!!svg}
                previewContent={<SvgPreview svg={svg} zoom={zoom} viewportRef={setPreviewEl} />}
                previewButtons={(!canEdit || isFullscreen) && !!svg && (
                    <SvgZoomControls
                        zoom={zoom}
                        after={!canEdit && hasFullscreenButton && (
                            <OverlayFullscreenButton
                                isFullscreen={false}
                                onToggle={() => showContentEmbedFullscreen(rootRef.current)}
                            />
                        )}
                    />
                )}
            />
        </div>
    );
}

/**
 * The SVG of the Mermaid `source`, rendered a moment after it stops changing. While the source
 * fails to render, `error` holds why and `svg` keeps the last diagram that rendered.
 */
function useMermaidRender(source: string) {
    const { svg, error, render } = useSvgRender(renderMermaidSvg);
    const isFirstRender = useRef(true);

    useEffect(() => {
        const delay = isFirstRender.current ? 0 : RENDER_DELAY;
        isFirstRender.current = false;
        const timeout = setTimeout(() => render(source), delay);
        return () => clearTimeout(timeout);
    }, [ source ]);

    return { svg, error };
}

/** Whether the embed that contains `ref` is in fullscreen, where its toolbar does not show. */
function useIsEmbedFullscreen(ref: RefObject<HTMLElement | null>) {
    const [ isFullscreen, setIsFullscreen ] = useState(false);
    useContentEmbedEvent(ref, "enterFullscreen", () => setIsFullscreen(true));
    useContentEmbedEvent(ref, "leaveFullscreen", () => setIsFullscreen(false));
    return isFullscreen;
}

/** The zoom and fullscreen of a Mermaid diagram, as buttons of the toolbar of its embed. */
class MermaidDiagramTools implements ContentEmbedToolProvider {
    readonly hiddenToolbarItems: readonly ContentEmbedToolbarItem[] = [
        "contentEmbedBoxSizeDropdown", "toggleContentEmbedTitle", "convertEmbedToLink"
    ];
    readonly hasEditableFlag = true;
    readonly hasDisplayModes = true;
    private zoom: SvgZoom | null = null;
    private isDiagramShown = true;
    private isSourceShown = false;
    private listeners = new Set<() => void>();
    private shownTools = "";

    constructor(private readonly rootRef: RefObject<HTMLElement | null>) {}

    /** Follows the zoom state and the display mode of the latest render. */
    setState(zoom: SvgZoom, mode: DisplayMode) {
        this.zoom = zoom;
        this.isDiagramShown = mode !== "source";
        this.isSourceShown = mode !== "preview";
        // Notifies after the render, as a listener updates the toolbar of the editor.
        queueMicrotask(() => this.update());
    }

    getTools(): ContentEmbedTool[] {
        const zoom = this.zoom;
        if (!zoom) return [];
        if (!this.isDiagramShown) return [ ...this.getFullscreenTools(), ...this.getHelpTools() ];

        return [
            {
                id: "zoomOut",
                label: t("zoom_controls.zoom_out"),
                icon: zoomOutIcon,
                isEnabled: zoom.canZoomOut,
                group: "zoom"
            },
            {
                id: "resetZoom",
                label: t("zoom_controls.reset"),
                text: `${Math.round(zoom.scale * 100)}%`,
                group: "zoom"
            },
            {
                id: "zoomIn",
                label: t("zoom_controls.zoom_in"),
                icon: zoomInIcon,
                isEnabled: zoom.canZoomIn,
                group: "zoom"
            },
            ...this.getFullscreenTools(),
            ...this.getHelpTools()
        ];
    }

    execute(id: string) {
        const zoom = this.zoom;
        if (id === "fullscreen") {
            showContentEmbedFullscreen(this.rootRef.current);
        } else if (id === "syntaxHelp") {
            openInAppHelpFromUrl(MERMAID_HELP_PAGE);
        } else if (id === "zoomOut") {
            zoom?.zoomOut();
        } else if (id === "zoomIn") {
            zoom?.zoomIn();
        } else if (id === "resetZoom") {
            zoom?.reset();
        }
    }

    subscribe(callback: () => void) {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    /** Fullscreen, while the title row of the embed, which has a button for it, is hidden. */
    private getFullscreenTools(): ContentEmbedTool[] {
        if (!needsFullscreenButton(this.rootRef.current?.closest<HTMLElement>(".include-note"))) {
            return [];
        }

        return [
            { id: "fullscreen", label: t("common.fullscreen"), icon: fullscreenIcon, group: "zoom" }
        ];
    }

    /** The help on the Mermaid syntax, while the source shows. */
    private getHelpTools(): ContentEmbedTool[] {
        if (!this.isSourceShown) return [];

        return [
            { id: "syntaxHelp", label: t("mermaid.syntax_help"), icon: helpIcon, group: "help" }
        ];
    }

    private update() {
        const shownTools = JSON.stringify(this.getTools());
        if (shownTools !== this.shownTools) {
            this.shownTools = shownTools;
            for (const listener of this.listeners) {
                listener();
            }
        }
    }
}

/** The in-app help page on Mermaid diagrams. */
const MERMAID_HELP_PAGE = "s1aBHPd79XYj";
/** How long the source has to stay unchanged before the diagram renders again, in milliseconds. */
const RENDER_DELAY = 300;

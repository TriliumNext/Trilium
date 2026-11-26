import "./Handwriting.css";

import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import ColorPicker from "../../react/ColorPicker";
import { useEditorSpacedUpdate } from "../../react/hooks/editor";
import { useEffectiveReadOnly } from "../../react/hooks/note_context";
import OverlayControlGroup, {
    OverlayControlButton, OverlayControlDropdown, ZoomControls
} from "../../react/OverlayControlGroup";
import Slider from "../../react/Slider";
import { TypeWidgetProps } from "../type_widget";
import { AUTO_COLOR, type InkDocument, PAPER_STYLES, parseInkDocument } from "./ink_document";
import InkSurface, { type InkSurfaceState, type SurfaceTool } from "./ink_surface";

const TOOLS: { tool: SurfaceTool, icon: string, title: () => string }[] = [
    { tool: "pen", icon: "bx-pen", title: () => t("handwriting.pen") },
    { tool: "highlighter", icon: "bx-highlight", title: () => t("handwriting.highlighter") },
    { tool: "eraser", icon: "bx-eraser", title: () => t("handwriting.eraser") }
];

export default function Handwriting({ note, noteContext }: TypeWidgetProps) {
    const surfaceElRef = useRef<HTMLDivElement>(null);
    const surfaceRef = useRef<InkSurface | undefined>(undefined);
    const pendingDocRef = useRef<InkDocument | undefined>(undefined);
    const [ tool, setTool ] = useState<SurfaceTool>("pen");
    const [ color, setColor ] = useState(AUTO_COLOR);
    const [ size, setSize ] = useState(3);
    const [ state, setState ] = useState<InkSurfaceState>({ zoom: 1, canUndo: false, canRedo: false });
    const isReadOnly = useEffectiveReadOnly(note, noteContext);

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "handwriting",
        getData() {
            const surface = surfaceRef.current;
            return surface ? { content: surface.serialize() } : undefined;
        },
        onContentChange(content) {
            const doc = parseInkDocument(content);
            if (surfaceRef.current) {
                surfaceRef.current.load(doc);
            } else {
                pendingDocRef.current = doc;
            }
        }
    });

    useEffect(() => {
        if (!surfaceElRef.current) return;
        const surface = new InkSurface(surfaceElRef.current, {
            // As in canvas notes, each change postpones the save, so it runs once writing pauses.
            onChange: () => {
                spacedUpdate.resetUpdateTimer();
                spacedUpdate.scheduleUpdate();
            },
            onGestureStart: () => spacedUpdate.resetUpdateTimer(),
            onStateChange: setState
        });
        surfaceRef.current = surface;
        if (pendingDocRef.current) {
            surface.load(pendingDocRef.current);
            pendingDocRef.current = undefined;
        }
        return () => {
            surface.destroy();
            surfaceRef.current = undefined;
        };
    }, [ spacedUpdate ]);

    useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        surface.tool = tool;
        surface.color = color;
        surface.size = size;
        surface.readOnly = isReadOnly;
    }, [ tool, color, size, isReadOnly ]);

    function cyclePaper() {
        const surface = surfaceRef.current;
        if (!surface) return;
        const next = (PAPER_STYLES.indexOf(surface.getPaper()) + 1) % PAPER_STYLES.length;
        surface.setPaper(PAPER_STYLES[next]);
    }

    return (
        <div className="handwriting-container">
            <div ref={surfaceElRef} className="handwriting-surface" data-tool={isReadOnly ? "pan" : tool} />

            {!isReadOnly && (
                <OverlayControlGroup placement="top-center" className="handwriting-tools">
                    {TOOLS.map(({ tool: itemTool, icon, title }) => (
                        <OverlayControlButton
                            key={itemTool}
                            title={title()}
                            icon={icon}
                            active={tool === itemTool}
                            onClick={() => setTool(itemTool)}
                        />
                    ))}
                    <OverlayControlDropdown title={t("handwriting.pen_settings")} icon="bx-palette" panel>
                        <div className="handwriting-pen-settings">
                            <ColorPicker
                                currentValue={color === AUTO_COLOR ? null : color}
                                onChange={(newColor) => setColor(newColor ?? AUTO_COLOR)}
                            />
                            <Slider
                                title={t("handwriting.thickness")}
                                value={size}
                                min={1}
                                max={12}
                                step={0.5}
                                onChange={setSize}
                            />
                        </div>
                    </OverlayControlDropdown>
                    <OverlayControlButton
                        title={t("handwriting.change_paper")}
                        icon="bx-grid"
                        onClick={cyclePaper}
                    />
                    <OverlayControlButton
                        title={t("handwriting.undo")}
                        icon="bx-undo"
                        disabled={!state.canUndo}
                        onClick={() => surfaceRef.current?.undo()}
                    />
                    <OverlayControlButton
                        title={t("handwriting.redo")}
                        icon="bx-redo"
                        disabled={!state.canRedo}
                        onClick={() => surfaceRef.current?.redo()}
                    />
                </OverlayControlGroup>
            )}

            <OverlayControlGroup placement="bottom-end" className="handwriting-zoom">
                <ZoomControls
                    percent={Math.round(state.zoom * 100)}
                    onZoomIn={() => surfaceRef.current?.zoomBy(1.25)}
                    onZoomOut={() => surfaceRef.current?.zoomBy(0.8)}
                    onReset={() => surfaceRef.current?.resetZoom()}
                />
            </OverlayControlGroup>
        </div>
    );
}

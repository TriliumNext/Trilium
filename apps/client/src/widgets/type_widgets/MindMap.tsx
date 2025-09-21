import { useCallback, useEffect, useRef } from "preact/hooks";
import { TypeWidgetProps } from "./type_widget";
import { MindElixirData, MindElixirInstance, Operation, default as VanillaMindElixir } from "mind-elixir";
import { HTMLAttributes, RefObject } from "preact";
// allow node-menu plugin css to be bundled by webpack
import nodeMenu from "@mind-elixir/node-menu";
import "mind-elixir/style";
import "@mind-elixir/node-menu/dist/style.css";
import "./MindMap.css";
import { useEditorSpacedUpdate, useTriliumEvent, useTriliumEvents } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";
import utils from "../../services/utils";

const NEW_TOPIC_NAME = "";

interface MindElixirProps {
    apiRef?: RefObject<MindElixirInstance>;
    containerProps?: Omit<HTMLAttributes<HTMLDivElement>, "ref">;
    content: MindElixirData;
    onChange?: () => void;
}

export default function MindMap({ note, ntxId }: TypeWidgetProps) {
    const content = VanillaMindElixir.new(NEW_TOPIC_NAME);
    const apiRef = useRef<MindElixirInstance>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const spacedUpdate = useEditorSpacedUpdate({
        note,
        getData: async () => {
            if (!apiRef.current) return;
            return {
                content: apiRef.current.getDataString(),
                attachments: [
                    {
                        role: "image",
                        title: "mindmap-export.svg",
                        mime: "image/svg+xml",
                        content: await apiRef.current.exportSvg().text(),
                        position: 0
                    }
                ]
            }
        },
        onContentChange: (content) => {
            let newContent: MindElixirData;
            if (content) {
                try {
                    newContent = JSON.parse(content) as MindElixirData;
                } catch (e) {
                    console.warn(e);
                    console.debug("Wrong JSON content: ", content);
                }
            } else {
                newContent = VanillaMindElixir.new(NEW_TOPIC_NAME)
            }
            apiRef.current?.init(newContent!);
        }
    });

    // Allow search.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        resolve(refToJQuerySelector(containerRef).find(".map-canvas"));
    });

    // Export as PNG or SVG.
    useTriliumEvents([ "exportSvg", "exportPng" ], async ({ ntxId: eventNtxId }, eventName) => {
        if (eventNtxId !== ntxId || !apiRef.current) return;
        const title = note.title;
        const svg = await apiRef.current.exportSvg().text();
        if (eventName === "exportSvg") {
            utils.downloadSvg(title, svg);
        } else {
            utils.downloadSvgAsPng(title, svg);
        }
    });

    const onKeyDown = useCallback((e: KeyboardEvent) => {
        /*
        * Some global shortcuts interfere with the default shortcuts of the mind map,
        * as defined here: https://mind-elixir.com/docs/guides/shortcuts
        */
        if (e.key === "F1") {
            e.stopPropagation();
        }

        // Zoom controls
        const isCtrl = e.ctrlKey && !e.altKey && !e.metaKey;
        if (isCtrl && (e.key == "-" || e.key == "=" || e.key == "0")) {
            e.stopPropagation();
        }
    }, []);

    return (
        <div ref={containerRef} className="note-detail-mind-map note-detail-printable">
            <MindElixir
                apiRef={apiRef}
                content={content}
                onChange={() => spacedUpdate.scheduleUpdate()}
                containerProps={{
                    className: "mind-map-container",
                    onKeyDown
                }}
            />
        </div>
    )
}

function MindElixir({ content, containerProps, apiRef: externalApiRef, onChange }: MindElixirProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<MindElixirInstance>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const mind = new VanillaMindElixir({
            el: containerRef.current
        });

        mind.install(nodeMenu);
        mind.init(content);

        apiRef.current = mind;
        if (externalApiRef) {
            externalApiRef.current = mind;
        }

        return () => mind.destroy();
    }, []);

    // On change listener.
    useEffect(() => {
        if (!onChange) return;

        const listener = (operation: Operation) => {
            if (operation.name !== "beginEdit") {
                onChange();
            }
        }
        apiRef.current?.bus.addListener("operation", listener);

        // Direction change buttons don't report change, so we have to hook in manually.
        const $container = refToJQuerySelector(containerRef);
        $container.on("click", ".mind-elixir-toolbar.lt", onChange);

        return () => {
            $container.off("click", ".mind-elixir-toolbar.lt", onChange);
            apiRef.current?.bus?.removeListener("operation", listener);
        };
    }, [ onChange ]);

    return (
        <div ref={containerRef} {...containerProps} />
    )
}

import "mind-elixir/style";
import "@mind-elixir/node-menu/dist/style.css";
import "./MindMap.css";

// allow node-menu plugin css to be bundled by webpack
import nodeMenu from "@mind-elixir/node-menu";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { snapdom } from "@zumer/snapdom";
import { default as VanillaMindElixir,MindElixirData, MindElixirInstance, Operation, Options } from "mind-elixir";
import { HTMLAttributes, RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import utils from "../../services/utils";
import { useEditorSpacedUpdate, useNoteLabelBoolean, useSyncedRef, useTriliumEvent, useTriliumEvents, useTriliumOption } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";
import { TypeWidgetProps } from "./type_widget";

const NEW_TOPIC_NAME = "";

interface MindElixirProps {
    apiRef?: RefObject<MindElixirInstance>;
    containerProps?: Omit<HTMLAttributes<HTMLDivElement>, "ref">;
    containerRef?: RefObject<HTMLDivElement>;
    editable: boolean;
    onChange?: () => void;
}

const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, Options["locale"] | null> = {
    ar: null,
    cn: "zh_CN",
    de: null,
    en: "en",
    en_rtl: "en",
    "en-GB": "en",
    es: "es",
    fr: "fr",
    it: "it",
    ja: "ja",
    pt: "pt",
    pl: null,
    pt_br: "pt",
    ro: "ro",
    ru: "ru",
    tw: "zh_TW",
    uk: null
};

export default function MindMap({ note, ntxId, noteContext }: TypeWidgetProps) {
    const apiRef = useRef<MindElixirInstance>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");


    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteType: "mindMap",
        noteContext,
        getData: async () => {
            if (!apiRef.current) return;

            const result = await snapdom(apiRef.current.nodes, {
                backgroundColor: "transparent",
                scale: 2
            });

            // a data URL in the format: "data:image/svg+xml;charset=utf-8,<url-encoded-svg>"
            // We need to extract the content after the comma and decode the URL encoding (%3C to <, %20 to space, etc.)
            // to get raw SVG content that Trilium's backend can store as an attachment
            const svgContent = decodeURIComponent(result.url.split(',')[1]);

            return {
                content: apiRef.current.getDataString(),
                attachments: [
                    {
                        role: "image",
                        title: "mindmap-export.svg",
                        mime: "image/svg+xml",
                        content: svgContent,
                        position: 0
                    }
                ]
            };
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
                newContent = VanillaMindElixir.new(NEW_TOPIC_NAME);
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
        const nodes = apiRef.current.nodes;
        if (eventName === "exportSvg") {
            await utils.downloadAsSvg(note.title, nodes);
        } else {
            await utils.downloadAsPng(note.title, nodes);
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
        <MindElixir
            containerRef={containerRef}
            apiRef={apiRef}
            onChange={() => spacedUpdate.scheduleUpdate()}
            editable={!isReadOnly}
            containerProps={{
                className: "mind-map-container",
                onKeyDown
            }}
        />
    );
}

function MindElixir({ containerRef: externalContainerRef, containerProps, apiRef: externalApiRef, onChange, editable }: MindElixirProps) {
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const apiRef = useRef<MindElixirInstance>(null);
    const [ locale ] = useTriliumOption("locale");

    function reinitialize() {
        if (!containerRef.current) return;

        const mind = new VanillaMindElixir({
            el: containerRef.current,
            locale: LOCALE_MAPPINGS[locale as DISPLAYABLE_LOCALE_IDS] ?? undefined,
            editable
        });

        if (editable) {
            mind.install(nodeMenu);
        }

        apiRef.current = mind;
        if (externalApiRef) {
            externalApiRef.current = mind;
        }
    }

    useEffect(() => {
        reinitialize();
        return () => {
            apiRef.current?.destroy();
            apiRef.current = null;
        };
    }, []);

    useEffect(() => {
        const data = apiRef.current?.getData();
        reinitialize();
        if (data) {
            apiRef.current?.init(data);
        }
    }, [ editable, locale ]);

    // On change listener.
    useEffect(() => {
        const bus = apiRef.current?.bus;
        if (!onChange || !bus) return;

        const operationListener = (operation: Operation) => {
            if (operation.name !== "beginEdit") {
                onChange();
            }
        };

        bus.addListener("operation", operationListener);
        bus.addListener("changeDirection", onChange);

        return () => {
            bus.removeListener("operation", operationListener);
            bus.removeListener("changeDirection", onChange);
        };
    }, [ onChange ]);

    return (
        <div ref={containerRef} {...containerProps} />
    );
}

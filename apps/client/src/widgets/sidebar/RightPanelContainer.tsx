//! This is currently only used for the new layout.
import "./RightPanelContainer.css";

import Split from "@triliumnext/split.js";
import { VNode } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

import appContext from "../../components/app_context";
import { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import options from "../../services/options";
import { DEFAULT_GUTTER_SIZE } from "../../services/resizer";
import Button from "../react/Button";
import { useActiveNoteContext, useLegacyWidget, useNoteProperty, useTriliumEvent, useTriliumOptionJson } from "../react/hooks";
import Icon from "../react/Icon";
import LegacyRightPanelWidget from "../right_panel_widget";
import HighlightsList from "./HighlightsList";
import PdfAttachments from "./pdf/PdfAttachments";
import PdfLayers from "./pdf/PdfLayers";
import PdfPages from "./pdf/PdfPages";
import RightPanelWidget from "./RightPanelWidget";
import TableOfContents from "./TableOfContents";

const MIN_WIDTH_PERCENT = 5;

interface RightPanelWidgetDefinition {
    el: VNode;
    enabled: boolean;
    position?: number;
}

export default function RightPanelContainer({ widgetsByParent }: { widgetsByParent: WidgetsByParent }) {
    const [ rightPaneVisible, setRightPaneVisible ] = useState(options.is("rightPaneVisible"));
    const items = useItems(rightPaneVisible, widgetsByParent);
    useSplit(rightPaneVisible);
    useTriliumEvent("toggleRightPane", useCallback(() => {
        setRightPaneVisible(current => {
            const newValue = !current;
            options.save("rightPaneVisible", newValue.toString());
            return newValue;
        });
    }, []));

    return (
        <div id="right-pane">
            {rightPaneVisible && (
                items.length > 0 ? (
                    items
                ) : (
                    <div className="no-items">
                        <Icon icon="bx bx-sidebar" />
                        {t("right_pane.empty_message")}
                        <Button
                            text={t("right_pane.empty_button")}
                            triggerCommand="toggleRightPane"
                        />
                    </div>
                )
            )}
        </div>
    );
}

function useItems(rightPaneVisible: boolean, widgetsByParent: WidgetsByParent) {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const [ highlightsList ] = useTriliumOptionJson<string[]>("highlightsList");
    const isPdf = noteType === "file" && noteMime === "application/pdf";

    if (!rightPaneVisible) return [];
    const definitions: RightPanelWidgetDefinition[] = [
        {
            el: <TableOfContents />,
            enabled: (noteType === "text" || noteType === "doc" || isPdf),
        },
        {
            el: <PdfPages />,
            enabled: isPdf,
        },
        {
            el: <PdfAttachments />,
            enabled: isPdf,
        },
        {
            el: <PdfLayers />,
            enabled: isPdf,
        },
        {
            el: <HighlightsList />,
            enabled: noteType === "text" && highlightsList.length > 0,
        },
        ...widgetsByParent.getLegacyWidgets("right-pane").map((widget) => ({
            el: <CustomLegacyWidget key={widget._noteId} originalWidget={widget as LegacyRightPanelWidget} />,
            enabled: true,
            position: widget.position
        })),
        ...widgetsByParent.getPreactWidgets("right-pane").map((widget) => {
            const El = widget.render;
            return {
                el: <El />,
                enabled: true,
                position: widget.position
            };
        })
    ];

    // Assign a position to items that don't have one yet.
    let pos = 10;
    for (const definition of definitions) {
        if (!definition.position) {
            definition.position = pos;
            pos += 10;
        }
    }

    return definitions
        .filter(e => e.enabled)
        .toSorted((a, b) => (a.position ?? 10) - (b.position ?? 10))
        .map(e => e.el);
}

function useSplit(visible: boolean) {
    // Split between right pane and the content pane.
    useEffect(() => {
        if (!visible) return;

        // We are intentionally omitting useTriliumOption to avoid re-render due to size change.
        const rightPaneWidth = Math.max(MIN_WIDTH_PERCENT, options.getInt("rightPaneWidth") ?? MIN_WIDTH_PERCENT);
        const splitInstance = Split(["#center-pane", "#right-pane"], {
            sizes: [100 - rightPaneWidth, rightPaneWidth],
            gutterSize: DEFAULT_GUTTER_SIZE,
            minSize: [300, 180],
            rtl: glob.isRtl,
            onDragEnd: (sizes) => options.save("rightPaneWidth", Math.round(sizes[1]))
        });
        return () => splitInstance.destroy();
    }, [ visible ]);
}

function CustomLegacyWidget({ originalWidget }: { originalWidget: LegacyRightPanelWidget }) {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <RightPanelWidget
            id={originalWidget._noteId}
            title={originalWidget.widgetTitle}
            containerRef={containerRef}
            contextMenuItems={[
                {
                    title: t("right_pane.custom_widget_go_to_source"),
                    uiIcon: "bx bx-code-curly",
                    handler: () => appContext.tabManager.openInNewTab(originalWidget._noteId, null, true)
                }
            ]}
        >
            <CustomWidgetContent originalWidget={originalWidget} />
        </RightPanelWidget>
    );
}

function CustomWidgetContent({ originalWidget }: { originalWidget: LegacyRightPanelWidget }) {
    const { noteContext } = useActiveNoteContext();
    const [ el ] = useLegacyWidget(() => {
        originalWidget.contentSized();

        // Monkey-patch the original widget by replacing the default initialization logic.
        originalWidget.doRender = function doRender(this: LegacyRightPanelWidget) {
            this.$widget = $("<div>");
            this.$body = this.$widget;
            const renderResult = this.doRenderBody();
            if (typeof renderResult === "object" && "catch" in renderResult) {
                this.initialized = renderResult.catch((e) => {
                    this.logRenderingError(e);
                });
            } else {
                this.initialized = Promise.resolve();
            }
        };

        return originalWidget;
    }, {
        noteContext
    });

    return el;
}

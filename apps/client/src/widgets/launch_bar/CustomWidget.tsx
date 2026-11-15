import { useContext, useEffect, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { LauncherWidgetDefinitionWithType } from "../../services/frontend_script_api_preact";
import { t } from "../../services/i18n";
import toast from "../../services/toast";
import { getErrorMessage } from "../../services/utils";
import BasicWidget from "../basic_widget";
import NoteContextAwareWidget from "../note_context_aware_widget";
import { useLegacyWidget } from "../react/hooks/legacy";
import { useNoteRelationTarget } from "../react/hooks/note";
import { ParentComponent } from "../react/react_utils";
import { launcherContextMenuHandler, LauncherNoteProps } from "./launch_bar_widgets";

/**
 * A launcher that renders the widget its `~widget` script returns, either a Preact launcher widget
 * or a legacy jQuery one.
 */
export default function CustomWidget({ launcherNote }: LauncherNoteProps) {
    const [ widgetNote ] = useNoteRelationTarget(launcherNote, "widget");
    const [ widget, setWidget ] = useState<BasicWidget | NoteContextAwareWidget | LauncherWidgetDefinitionWithType>();

    // A `BasicWidget` only in the mobile layout, which wraps the launch bar in one.
    const parentComponent = useContext(ParentComponent) as Partial<BasicWidget> | null;
    parentComponent?.contentSized?.();

    useEffect(() => {
        (async function() {
            let widget: BasicWidget;
            try {
                widget = await widgetNote?.executeScript();
            } catch (e) {
                toast.showError(t("toast.bundle-error.message", {
                    id: widgetNote?.noteId,
                    title: widgetNote?.title,
                    message: getErrorMessage(e)
                }));
                return;
            }

            if (widgetNote && widget instanceof BasicWidget) {
                widget._noteId = widgetNote.noteId;
            }
            setWidget(widget);
        })();
    }, [ widgetNote ]);

    return (
        <div onContextMenu={launcherContextMenuHandler(launcherNote)}>
            {widget && (
                ("type" in widget && widget.type === "preact-launcher-widget")
                    ? <ReactWidgetRenderer widget={widget as LauncherWidgetDefinitionWithType} />
                    : <LegacyWidgetRenderer widget={widget as BasicWidget} />
            )}
        </div>
    );
}

function LegacyWidgetRenderer({ widget }: { widget: BasicWidget }) {
    const [ widgetEl ] = useLegacyWidget(() => widget, {
        noteContext: appContext.tabManager.getActiveContext() ?? undefined
    });

    return widgetEl;
}

function ReactWidgetRenderer({ widget }: { widget: LauncherWidgetDefinitionWithType }) {
    const El = widget.render;
    return <El />;
}

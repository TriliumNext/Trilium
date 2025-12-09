import { useEffect, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useNoteContext, useTriliumEvents } from "../react/hooks";
import appContext from "../../components/app_context";

export default function ClosePaneButton() {
    const { noteContext, ntxId, parentComponent } = useNoteContext();
    const [isEnabled, setIsEnabled] = useState(false);

    function refresh() {
        const isMainOfSomeContext = appContext.tabManager.noteContexts.some(c => c.mainNtxId === ntxId);
        setIsEnabled(!!(noteContext && (!!noteContext.mainNtxId || isMainOfSomeContext)));
    }

    useTriliumEvents(["noteContextRemoved", "noteContextReorder", "newNoteContextCreated"], refresh);
    useEffect(refresh, [ntxId]);

    return (
        <ActionButton
            icon="bx bx-x"
            text={t("close_pane_button.close_this_pane")}
            className={!isEnabled ? "hidden-ext" : ""}
            onClick={(e) => {
                // to avoid split pane container detecting click within the pane which would try to activate this
                // pane (which is being removed)
                e.stopPropagation();

                parentComponent?.triggerCommand("closeThisNoteSplit", { ntxId: parentComponent.getClosestNtxId() });
            }}
        />
    )
}

import { useContext, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { ParentComponent } from "../react/react_utils";
import BasicWidget from "../basic_widget";
import { useNoteContext, useTriliumEvents } from "../react/hooks";
import appContext from "../../components/app_context";

interface MovePaneButtonProps {
    direction: "left" | "right";
}

export default function MovePaneButton({ direction }: MovePaneButtonProps) {
    const parentWidget = useContext(ParentComponent) as BasicWidget | undefined;
    const { noteContext, ntxId } = useNoteContext();
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    function isEnabled() {
        if (direction === "left") {
            // movable if the current context is not a main context, i.e. non-null mainNtxId
            return !!noteContext?.mainNtxId;
        } else {
            const currentIndex = appContext.tabManager.noteContexts.findIndex((c) => c.ntxId === ntxId);
            const nextContext = appContext.tabManager.noteContexts[currentIndex + 1];
            // movable if the next context is not null and not a main context, i.e. non-null mainNtxId
            return !!nextContext?.mainNtxId;
        }
    }

    useTriliumEvents([ "noteContextRemoved", "newNoteContextCreated", "noteContextReorder", "contextsReopened" ], () => {
        setRefreshCounter(refreshCounter + 1);
    });

    return (
        <ActionButton
            icon={direction === "left" ? "bx bx-chevron-left" : "bx bx-chevron-right"}
            text={direction === "left" ? t("move_pane_button.move_left") : t("move_pane_button.move_right")}
            onClick={(() => parentWidget?.triggerCommand("moveThisNoteSplit", { ntxId: parentWidget.getClosestNtxId(), isMovingLeft: direction === "left" }))}
            className={!isEnabled() ? "hidden-ext" : ""}
        />
    );
}

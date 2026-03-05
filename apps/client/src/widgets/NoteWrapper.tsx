import "./NoteWrapper.css";

import { isExperimentalFeatureEnabled } from "../services/experimental_features";
import { isDesktop } from "../services/utils";
import ClosePaneButton from "./buttons/close_pane_button";
import CreatePaneButton from "./buttons/create_pane_button";
import MovePaneButton from "./buttons/move_pane_button";
import FloatingButtons from "./FloatingButtons";
import { DESKTOP_FLOATING_BUTTONS } from "./FloatingButtonsDefinitions";
import { LegacyWidgetRenderer } from "./launch_bar/LauncherDefinitions";
import SpacerWidget from "./launch_bar/SpacerWidget";
import NoteBadges from "./layout/NoteBadges";
import NoteIcon from "./note_icon";
import NoteTitleWidget from "./note_title";
import NoteActions from "./ribbon/NoteActions";
import Ribbon from "./ribbon/Ribbon";
import WatchedFileUpdateStatusWidget from "./watched_file_update_status";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");
const cachedIsDesktop = isDesktop();

export default function NoteWrapper() {
    return (
        <div className="component note-split">
            <TitleRow />
            {!isNewLayout && <Ribbon />}
            {cachedIsDesktop && <LegacyWidgetRenderer widget={new WatchedFileUpdateStatusWidget()} />}
            {!isNewLayout && <FloatingButtons items={DESKTOP_FLOATING_BUTTONS} />}
        </div>
    );
}

function TitleRow() {
    return (
        <div className="component title-row note-split-title">
            <NoteIcon />
            <NoteTitleWidget />
            {isNewLayout && <NoteBadges />}
            <SpacerWidget baseSize={0} growthFactor={1} />
            {!isNewLayout ? (
                <>
                    <MovePaneButton direction="left" />
                    <MovePaneButton direction="right" />
                    <ClosePaneButton />
                    <CreatePaneButton />
                </>
            ) : (
                <NoteActions />
            )}
        </div>
    );
}

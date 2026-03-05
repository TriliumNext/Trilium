import "./NoteWrapper.css";

import { isExperimentalFeatureEnabled } from "../services/experimental_features";
import { isDesktop } from "../services/utils";
import ApiLog from "./api_log";
import ClosePaneButton from "./buttons/close_pane_button";
import CreatePaneButton from "./buttons/create_pane_button";
import MovePaneButton from "./buttons/move_pane_button";
import NoteList from "./collections/NoteList";
import ScrollingContainer from "./containers/ScrollingContainer";
import FindWidget from "./find";
import FloatingButtons from "./FloatingButtons";
import { DESKTOP_FLOATING_BUTTONS } from "./FloatingButtonsDefinitions";
import { LegacyWidgetRenderer } from "./launch_bar/LauncherDefinitions";
import SpacerWidget from "./launch_bar/SpacerWidget";
import InlineTitle from "./layout/InlineTitle";
import NoteBadges from "./layout/NoteBadges";
import NoteTitleActions from "./layout/NoteTitleActions";
import NoteIcon from "./note_icon";
import NoteTitleWidget from "./note_title";
import NoteDetail from "./NoteDetail";
import PromotedAttributes from "./PromotedAttributes";
import ReadOnlyNoteInfoBar from "./ReadOnlyNoteInfoBar";
import NoteActions from "./ribbon/NoteActions";
import Ribbon from "./ribbon/Ribbon";
import ScrollPadding from "./scroll_padding";
import SearchResult from "./search_result";
import SharedInfo from "./shared_info";
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
            <ScrollingContainer>
                {isNewLayout ? (
                    <>
                        <InlineTitle />
                        <NoteTitleActions />
                    </>
                ) : (
                    <>
                        <ReadOnlyNoteInfoBar />
                        <SharedInfo />
                    </>
                )}
                {!isNewLayout && <PromotedAttributes />}
                <NoteDetail />
                <NoteList media="screen" />
                <SearchResult />
                <ScrollPadding />
            </ScrollingContainer>
            <ApiLog />
            <LegacyWidgetRenderer widget={new FindWidget()} />
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

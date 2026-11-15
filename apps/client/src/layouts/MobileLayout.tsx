import "./MobileLayout.css";

import GlobalMenu from "../widgets/buttons/global_menu.js";
import NoteList from "../widgets/collections/NoteList.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import InlineTitle from "../widgets/layout/InlineTitle.js";
import NoteBadges from "../widgets/layout/NoteBadges.js";
import NoteTitleActions from "../widgets/layout/NoteTitleActions.js";
import MobileDetailMenu from "../widgets/mobile_widgets/mobile_detail_menu.js";
import NoteIcon from "../widgets/note_icon.js";
import NoteTitleWidget from "../widgets/note_title.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import NoteDetail from "../widgets/NoteDetail.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import ScrollPadding from "../widgets/scroll_padding.js";
import MobileEditorToolbar from "../widgets/type_widgets/text/mobile_editor_toolbar.js";

/** The mobile layout as a single Preact tree, which `mobile_layout.tsx` is moved into piece by piece. */
export default function MobileLayout() {
    return (
        <div id="root-widget" className="mobile-layout horizontal-layout">
            <div id="mobile-rest-container">
                <NoteSplits />
            </div>
            <div id="mobile-bottom-bar">
                <div id="launcher-pane" className="horizontal">
                    <LauncherContainer isHorizontalLayout={true} />
                    <GlobalMenu isHorizontalLayout={true} />
                </div>
            </div>
        </div>
    );
}

/**
 * One note split per note context of the active tab, each with a title row (the note's icon, title,
 * badges and menu) above its inline title, title actions, content, list of child notes and scroll
 * padding, then the text editor's toolbar. The splits are the children of `#detail-container`, as
 * the stylesheets select them.
 */
function NoteSplits() {
    const [ splits ] = useLegacyWidget(() => new SplitNoteContainer(() =>
        new NoteWrapperWidget()
            .child(new FlexContainer("row")
                .class("title-row note-split-title")
                .child(<NoteIcon />)
                .child(<NoteTitleWidget placement="split" />)
                .child(<NoteBadges />)
                .child(<MobileDetailMenu />))
            .child(new ScrollingContainer()
                .filling()
                .child(<InlineTitle />)
                .child(<NoteTitleActions />)
                .child(<NoteDetail />)
                .child(<NoteList media="screen" />)
                .child(<ScrollPadding />))
            .child(<MobileEditorToolbar />)
    ), { containerId: "detail-container" });
    return splits;
}

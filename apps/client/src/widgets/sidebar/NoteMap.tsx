// Also imported by the map itself, which the styles of its container belong to: the header's are
// wanted before it has finished loading, so they cannot wait for that module to arrive.
import "./NoteMap.css";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import MapTypeSwitcher from "../note_map/MapTypeSwitcher";
import { NOTE_MAP_TYPE_OPTION, toMapType } from "../note_map/utils";
import ActionButton from "../react/ActionButton";
import { useActiveNoteContext, useTriliumOption } from "../react/hooks";
import LazyComponent from "../react/LazyComponent";
import RightPanelWidget from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

/**
 * The card is rendered here and the map itself loaded on demand from within it, rather than the whole
 * widget being loaded on demand from the pane: the lazy wrapper is a `display: contents` element, which
 * leaves no box but is still an element as far as selectors are concerned, so a card behind it is no
 * longer a child of the tab body and misses everything the pane styles by that relation — its dividing
 * border, the first card's header padding, the sharing out of the tab's height.
 *
 * Which map to draw is asked here too, rather than in the map's own floating overlay: a card of the
 * pane keeps its controls in its header, and a map this small has little room to stand buttons over.
 * The map reads the same option, so the two stay of one mind without being told.
 *
 * It grows, sharing the room the tab's lists leave over with the backlinks below them and taking all
 * of it where they are collapsed — a map is worth whatever height it is given, and there is no height
 * at which it is finished being read. Where it stops is in NoteMap.css.
 */
export default function NoteMap() {
    const { notePath } = useActiveNoteContext();
    // The reader's own preference rather than the note's — see NOTE_MAP_TYPE_OPTION.
    const [ mapType, setMapType ] = useTriliumOption(NOTE_MAP_TYPE_OPTION);

    return (
        <RightPanelWidget
            id="noteMap"
            title={t("note_map.title")}
            buttons={<>
                <SidebarHelp section="noteMap" />
                <MapTypeSwitcher mapType={toMapType(mapType)} setMapType={(type) => void setMapType(type)} />
                {/* One rung of the same ladder the quick-edit popup already offers: a press here takes the
                    map from a card to the greater part of the window, and the popup's own expand takes it
                    on to a tab. What it opens is this card's own map — nothing else opens that view, so it
                    is drawn in `expanded` mode and left showing the map being expanded, rather than
                    whichever one the note itself asks for.

                    The popup rather than a split, because a map that sits beside the note
                    being read looks as though it follows it and doesn't; a glance that goes away when it
                    has sent the reader somewhere makes no such promise. */}
                {notePath && (
                    <ActionButton
                        icon="bx bx-expand-alt"
                        text={t("note_map.expand")}
                        onClick={() => void appContext.triggerCommand("openInPopup", {
                            noteIdOrPath: notePath,
                            viewScope: { viewMode: "note-map" }
                        })}
                    />
                )}
            </>}
            grow
            noPadding
        >
            <LazyComponent loader={() => import("./NoteMapGraph.jsx")} />
        </RightPanelWidget>
    );
}

import "./selection.css";

import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import ScrollableLabel from "../../react/ScrollableLabel";

/**
 * A mark the user picked out of a chart: which one it is, what it stands for, and what can be done
 * with it. Held by the page rather than by either view, since the strip naming it belongs to the
 * page and both views fill it.
 */
export interface SpaceUsageSelection {
    /** The mark's own id, which is how the chart knows to draw it as chosen. */
    markId: string;
    /**
     * Note IDs from the root (inclusive) down to the note, where the mark stands for one — the strip
     * reads the name and the path it shows out of this.
     */
    notePath?: string[];
    /** What to call a mark that stands for no note: a bucket, or one of a note's attachments. */
    label?: string;
    /** The size the mark's area encodes, in bytes. */
    size: number;
    /** What a tap on the strip raises. Absent for a mark with nothing to offer, such as a crowd. */
    onActivate?: (event: MouseEvent) => void;
    /**
     * What a second tap on the mark itself does, once it is the chosen one: walking into a child in
     * Browse, opening the note in Overview. This is what keeps a touch screen's first tap free to
     * name the mark rather than act on it — naming it would otherwise cost the reader the action.
     * Absent for a mark that stands for a crowd, which has nothing to be opened.
     */
    onOpen?: () => void;
}

/**
 * What the chosen mark is, along the foot of the screen: where the mark is, what it is called, and
 * how much it takes. This is how a chart identifies itself where there is no hover to do it, a phone,
 * so it says what the tooltip would have said, and a tap on it raises the same menu a right-click
 * raises on a desktop.
 *
 * It stands there with nothing chosen too, saying what to do instead: the strip is the map's legend
 * on a touch screen, and a legend that appears only once you have guessed the gesture is no legend.
 */
export default function SelectionStrip({ selection, containerRef }: {
    selection: SpaceUsageSelection | null,
    /** Held by the page, which measures the strip to leave the map room to scroll clear of it. */
    containerRef?: RefObject<HTMLDivElement>
}) {
    const titles = usePathTitles(selection?.notePath);
    // The note's own title is the last of them; anything above it is where the note sits. A mark
    // standing for no note carries its name instead, and has no location to show.
    const name = selection?.notePath ? titles[titles.length - 1] ?? "" : selection?.label ?? "";
    const path = titles.slice(0, -1);

    return (
        <div
            ref={containerRef}
            className={clsx("space-usage-selection", selection?.onActivate && "space-usage-selection-actionable")}
            onClick={(event) => selection?.onActivate?.(event)}
        >
            {selection ? (
                <>
                    {/* Both lines are as long as what they name, and neither is worth cutting short:
                        swiped along instead, with the fades saying where they carry on.

                        The path walks itself: it is the line the reader did not ask for, and its own
                        end — the note's parent — is the part that says which of several like-named
                        notes this is. The name is left to be swiped, being what was tapped.

                        Keyed on the mark, so a new one gets new labels rather than the last one's:
                        each starts back at its beginning, with its walk to take and its swipe to be
                        handed over by. Two marks can read exactly alike — siblings share a path — so
                        the text is no sign that the item is still the same one. */}
                    <ScrollableLabel
                        key={`${selection.markId}/path`}
                        className="space-usage-selection-path"
                        autoScroll
                    >
                        {path.join(" › ")}
                    </ScrollableLabel>
                    <ScrollableLabel
                        key={`${selection.markId}/name`}
                        className="space-usage-selection-name"
                    >{name}</ScrollableLabel>
                    <span className="space-usage-selection-size">{formatSize(selection.size)}</span>
                </>
            ) : (
                <span className="space-usage-selection-hint">{t("space_usage.selection_hint")}</span>
            )}
        </div>
    );
}

/**
 * The titles along the selected path, in path order, standing in with the note IDs until they
 * arrive. One froca call for the whole chain, and one selection is ever shown at a time, so the
 * strip asks again only when a different mark is picked.
 */
function usePathTitles(notePath: string[] | undefined) {
    const [ resolved, setResolved ] = useState<{ notePath: string[], titles: string[] }>();

    useEffect(() => {
        if (!notePath) {
            return;
        }

        let cancelled = false;

        // Silent: the reading the mark came from predates the tap, so the note may already be gone.
        void froca.getNotes(notePath, true).then((notes) => {
            if (!cancelled) {
                const byNoteId = new Map(notes.map((note) => [ note.noteId, note.title ]));

                setResolved({ notePath, titles: notePath.map((noteId) => byNoteId.get(noteId) ?? noteId) });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [ notePath ]);

    // Kept with the path they were asked for, and handed back only for that one. Titles arrive a
    // tick or more after the mark that wanted them, and the rest of the strip is drawn from the mark
    // itself: without this, the moment between one selection and its titles is drawn with the last
    // one's, which names the wrong note beside the right size — and a mark that names no note at all
    // would go on wearing the note's ancestors under its label.
    return resolved && resolved.notePath === notePath ? resolved.titles : notePath ?? [];
}

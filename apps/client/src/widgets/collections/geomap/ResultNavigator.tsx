import "./ResultNavigator.css";

import { useContext } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import { ParentMap } from "./map";
import { frameResult, type SearchResult } from "./results";

interface ResultNavigatorProps {
    /** What the search turned up, in the order the list offered it. */
    results: SearchResult[];
    /** Which of them the map is standing on. */
    index: number;
    /** Stands the map on another of them; the map is pointed at it here. */
    onStep(index: number): void;
}

/**
 * Steps through what a search turned up, one result at a time.
 *
 * Taking a result closes the list, so comparing several of them meant asking for the list again for
 * each — this walks them in the order they were offered, nearest first.
 *
 * A group of its own under the search bar rather than buttons in it: the bar has no room for three
 * more, and one of the results may be a note of the map's own, which opens the detail pane instead of
 * the place panel — buttons living on either panel would go as soon as the other was reached.
 */
export default function ResultNavigator({ results, index, onStep }: ResultNavigatorProps) {
    const map = useContext(ParentMap);

    // Nothing to step between, and nothing worth saying about where one stands among one.
    if (!map || results.length < 2) return null;

    const step = (to: number) => {
        onStep(to);
        frameResult(map, results[to]);
    };

    return (
        <OverlayControlGroup className="geo-result-navigator" placement="top-start" overCanvas>
            <OverlayControlButton
                title={t("geo-map.previous-result")}
                icon="bx-chevron-left"
                disabled={index <= 0}
                onClick={() => step(index - 1)}
            />
            {/* The count is a readout rather than a choice, so pressing it does the one thing that
                needs no choosing: points the map back at what it is standing on, after the reader
                has panned away from it. */}
            <OverlayControlButton
                text={`${index + 1} / ${results.length}`}
                className="geo-result-position"
                aria-label={t("geo-map.result-position", { index: index + 1, total: results.length })}
                onClick={() => step(index)}
            />
            <OverlayControlButton
                title={t("geo-map.next-result")}
                icon="bx-chevron-right"
                disabled={index >= results.length - 1}
                onClick={() => step(index + 1)}
            />
        </OverlayControlGroup>
    );
}

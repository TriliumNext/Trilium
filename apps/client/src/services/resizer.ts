import Split from "@triliumnext/split.js";

import type { PaneMode } from "../widgets/react/peek_pane.js";
import options from "./options.js";

export const DEFAULT_GUTTER_SIZE = 5;

let leftPaneWidth: number;
let layoutOrientation: string;
let leftInstance: ReturnType<typeof Split> | null;
let leftRafId: number | undefined;

const noteSplitMap = new Map<string[], ReturnType<typeof Split> | undefined>(); // key: a group of ntxIds, value: the corresponding Split instance
const noteSplitRafMap = new Map<string[], number>();
let splitNoteContainer: HTMLElement | undefined;

/**
 * Sizes the left pane for its mode. Docked, a Split sizes `#left-pane-host` against `#rest-pane`;
 * peeking, the host covers `#rest-pane` and a Split sizes `#left-pane` against the host's spacer.
 * Both share the `leftPaneWidth` option, a percentage of `#horizontal-main-container`.
 */
function setupLeftPaneResizer(mode: PaneMode) {
    if (leftRafId !== undefined) {
        cancelAnimationFrame(leftRafId);
        leftRafId = undefined;
    }
    if (leftInstance) {
        leftInstance.destroy();
        leftInstance = null;
    }

    layoutOrientation = layoutOrientation ?? options.get("layoutOrientation");
    // `.left-pane-peek-button` follows `#launcher-pane` in the vertical layout, and is not
    // displayed while the pane is docked.
    const reservedPx = layoutOrientation === "vertical"
        ? ($("#launcher-pane").outerWidth() || 0)
            + ($(".left-pane-peek-button").get(0)?.offsetWidth ?? 0)
        : 0;
    // Window resizing causes `window.innerWidth` to change, so `reservedWidth` needs to be recalculated each time.
    const reservedWidth = reservedPx / window.innerWidth * 100;
    if (mode !== "docked") {
        $("#rest-pane").css("width", layoutOrientation === "vertical" ? `${100 - reservedWidth}%` : "100%");
    }
    if (mode === "closed") {
        return;
    }

    leftPaneWidth = leftPaneWidth ?? (options.getInt("leftPaneWidth") ?? 0);
    if (!leftPaneWidth || leftPaneWidth < 5) {
        leftPaneWidth = 5;
    }

    const isDocked = mode === "docked";
    const elements = isDocked
        ? [ "#left-pane-host", "#rest-pane" ]
        : [ "#left-pane", "#left-pane-host > .peek-pane-spacer" ];
    // The peeking host starts after the launcher pane, so the pane takes a larger share of it.
    const scale = isDocked ? 1 : 100 / (100 - reservedWidth);
    const size = leftPaneWidth * scale;
    const otherWidth = isDocked ? 100 - size - reservedWidth : 100 - size;

    // Deferred a frame so that Split.js measures #left-pane once it is laid out; otherwise
    // `minSize` has no effect.
    leftRafId = requestAnimationFrame(() => {
        leftRafId = undefined;
        leftInstance = Split(elements, {
            sizes: [ size, otherWidth ],
            gutterSize: DEFAULT_GUTTER_SIZE,
            minSize: [ 150, 300 ],
            rtl: glob.isRtl,
            onDragEnd: (sizes) => {
                leftPaneWidth = Math.round(sizes[0] / scale);
                options.save("leftPaneWidth", leftPaneWidth);
            }
        });
    });
}

function findKeyByNtxId(ntxId: string): string[] | undefined {
    // Find the corresponding key in noteSplitMap based on ntxId
    for (const key of noteSplitMap.keys()) {
        if (key.includes(ntxId)) return key;
    }
    return undefined;
}

function setupNoteSplitResizer(ntxIds: string[]) {
    let targetNtxIds: string[] | undefined;
    for (const ntxId of ntxIds) {
        targetNtxIds = findKeyByNtxId(ntxId);
        if (targetNtxIds) break;
    }

    if (targetNtxIds) {
        noteSplitMap.get(targetNtxIds)?.destroy();
        for (const id of ntxIds) {
            if (!targetNtxIds.includes(id)) {
                targetNtxIds.push(id)
            };
        }
    } else {
        targetNtxIds = [...ntxIds];
    }
    noteSplitMap.set(targetNtxIds, undefined);
    createSplitInstance(targetNtxIds);
}


function delNoteSplitResizer(ntxIds: string[]) {
    let targetNtxIds = findKeyByNtxId(ntxIds[0]);
    if (!targetNtxIds) {
        return;
    }

    noteSplitMap.get(targetNtxIds)?.destroy();
    noteSplitMap.delete(targetNtxIds);
    targetNtxIds = targetNtxIds.filter(id => !ntxIds.includes(id));

    if (targetNtxIds.length >= 2) {
        noteSplitMap.set(targetNtxIds, undefined);
        createSplitInstance(targetNtxIds);
    }
}

function moveNoteSplitResizer(ntxId: string) {
    const targetNtxIds = findKeyByNtxId(ntxId);
    if (!targetNtxIds) {
        return;
    }
    noteSplitMap.get(targetNtxIds)?.destroy();
    noteSplitMap.set(targetNtxIds, undefined);
    createSplitInstance(targetNtxIds);
}

function createSplitInstance(targetNtxIds: string[]) {
    const prevRafId = noteSplitRafMap.get(targetNtxIds);
    if (prevRafId) {
        cancelAnimationFrame(prevRafId);
    }

    const rafId = requestAnimationFrame(() => {
        splitNoteContainer = splitNoteContainer ?? $("#center-pane").find(".split-note-container-widget")[0];
        const splitPanels = [...splitNoteContainer.querySelectorAll<HTMLElement>(':scope > .note-split')]
            .filter(el => targetNtxIds.includes(el.getAttribute('data-ntx-id') ?? ""));
        const splitInstance = Split(splitPanels, {
            rtl: glob.isRtl,
            gutterSize: DEFAULT_GUTTER_SIZE,
            minSize: 150,
        });
        noteSplitMap.set(targetNtxIds, splitInstance);
        noteSplitRafMap.delete(targetNtxIds);
    });
    noteSplitRafMap.set(targetNtxIds, rafId);
}

export default {
    setupLeftPaneResizer,
    setupNoteSplitResizer,
    delNoteSplitResizer,
    moveNoteSplitResizer
};

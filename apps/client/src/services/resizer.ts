import options from "./options.js";
import Split from "split.js"

export const DEFAULT_GUTTER_SIZE = 5;

let leftPaneWidth: number;
let reservedPx: number;
let layoutOrientation: string;
let leftInstance: ReturnType<typeof Split> | null;
let rightPaneWidth: number;
let rightInstance: ReturnType<typeof Split> | null;

const noteSplitMap = new Map<string[], ReturnType<typeof Split> | undefined>(); // key: a group of ntxIds, value: the corresponding Split instance
const noteSplitRafMap = new Map<string[], number>();
let splitNoteContainer: HTMLElement | undefined;

function setupLeftPaneResizer(leftPaneVisible: boolean) {
    if (leftInstance) {
        leftInstance.destroy();
        leftInstance = null;
    }

    $("#left-pane").toggle(leftPaneVisible);

    layoutOrientation = layoutOrientation ?? options.get("layoutOrientation");
    reservedPx = reservedPx ?? (layoutOrientation === "vertical" ? ($("#launcher-pane").outerWidth() || 0) : 0);
    // Window resizing causes `window.innerWidth` to change, so `reservedWidth` needs to be recalculated each time.
    const reservedWidth = reservedPx / window.innerWidth * 100;
    if (!leftPaneVisible) {
        $("#rest-pane").css("width", layoutOrientation === "vertical" ? `${100 - reservedWidth}%` : "100%");
        return;
    }

    leftPaneWidth = leftPaneWidth ?? (options.getInt("leftPaneWidth") ?? 0);
    if (!leftPaneWidth || leftPaneWidth < 5) {
        leftPaneWidth = 5;
    }

    const restPaneWidth = 100 - leftPaneWidth - reservedWidth;
    if (leftPaneVisible) {
        // Delayed initialization ensures that all DOM elements are fully rendered and part of the layout,
        // preventing Split.js from retrieving incorrect dimensions due to #left-pane not being rendered yet,
        // which would cause the minSize setting to have no effect.
        requestAnimationFrame(() => {
            leftInstance = Split(["#left-pane", "#rest-pane"], {
                sizes: [leftPaneWidth, restPaneWidth],
                gutterSize: DEFAULT_GUTTER_SIZE,
                minSize: [150, 300],
                onDragEnd: (sizes) => {
                    leftPaneWidth = Math.round(sizes[0]);
                    options.save("leftPaneWidth", Math.round(sizes[0]));
                }
            });
        });
    }
}

function setupRightPaneResizer() {
    if (rightInstance) {
        rightInstance.destroy();
        rightInstance = null;
    }

    const rightPaneVisible = $("#right-pane").is(":visible");

    if (!rightPaneVisible) {
        $("#center-pane").css("width", "100%");

        return;
    }

    rightPaneWidth = rightPaneWidth ?? (options.getInt("rightPaneWidth") ?? 0);
    if (!rightPaneWidth || rightPaneWidth < 5) {
        rightPaneWidth = 5;
    }

    if (rightPaneVisible) {
        rightInstance = Split(["#center-pane", "#right-pane"], {
            sizes: [100 - rightPaneWidth, rightPaneWidth],
            gutterSize: DEFAULT_GUTTER_SIZE,
            minSize: [300, 180],
            onDragEnd: (sizes) => {
                rightPaneWidth = Math.round(sizes[1]);
                options.save("rightPaneWidth", Math.round(sizes[1]));
            }
        });
    }
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
    setupRightPaneResizer,
    setupNoteSplitResizer,
    delNoteSplitResizer,
    moveNoteSplitResizer
};

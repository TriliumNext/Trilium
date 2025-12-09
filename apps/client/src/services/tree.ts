import ws from "./ws.js";
import utils from "./utils.js";
import froca from "./froca.js";
import hoistedNoteService from "./hoisted_note.js";
import appContext from "../components/app_context.js";

export const NOTE_PATH_TITLE_SEPARATOR = " › ";

async function resolveNotePath(notePath: string, hoistedNoteId = "root") {
    const runPath = await resolveNotePathToSegments(notePath, hoistedNoteId);

    return runPath ? runPath.join("/") : null;
}

/**
 * Accepts notePath which might or might not be valid and returns an existing path as close to the original
 * notePath as possible. Part of the path might not be valid because of note moving (which causes
 * path change) or other corruption, in that case, this will try to get some other valid path to the correct note.
 */
async function resolveNotePathToSegments(notePath: string, hoistedNoteId = "root", logErrors = true) {
    utils.assertArguments(notePath);

    // we might get notePath with the params suffix, remove it if present
    notePath = notePath.split("?")[0].trim();

    if (notePath.length === 0) {
        return null;
    }

    const path = notePath.split("/").reverse();
    const effectivePathSegments: string[] = [];
    let childNoteId: string | null = null;
    let i = 0;

    for (let i = 0; i < path.length; i++) {
        const parentNoteId = path[i];

        if (childNoteId !== null) {
            const child = await froca.getNote(childNoteId, !logErrors);

            if (!child) {
                if (logErrors) {
                    ws.logError(`Can't find note ${childNoteId}`);
                }

                return null;
            }

            child.sortParents();

            const parents = child.getParentNotes();

            if (!parents.length) {
                if (logErrors) {
                    ws.logError(`No parents found for note ${childNoteId} (${child.title}) for path ${notePath}`);
                }

                return null;
            }

            if (!parents.some(p => p.noteId === parentNoteId) || (i === path.length - 1 && parentNoteId !== 'root')) {
                if (logErrors) {
                    const parent = froca.getNoteFromCache(parentNoteId);

                    console.debug(
                        utils.now(),
                        `Did not find parent ${parentNoteId} (${parent ? parent.title : "n/a"})
                        for child ${childNoteId} (${child.title}), available parents: ${parents.map((p) => `${p.noteId} (${p.title})`)}.
                        You can ignore this message as it is mostly harmless.`
                    );
                }

                const activeNotePath = appContext.tabManager.getActiveContextNotePath();
                const bestNotePath = child.getBestNotePath(hoistedNoteId, activeNotePath);

                if (bestNotePath) {
                    const pathToRoot = bestNotePath.reverse().slice(1);

                    for (const noteId of pathToRoot) {
                        effectivePathSegments.push(noteId);
                    }
                }

                break;
            }
        }

        effectivePathSegments.push(parentNoteId);
        childNoteId = parentNoteId;
    }

    effectivePathSegments.reverse();

    if (effectivePathSegments.includes(hoistedNoteId) && effectivePathSegments.includes('root')) {
        return effectivePathSegments;
    } else {
        const noteId = getNoteIdFromUrl(notePath);
        if (!noteId) {
            throw new Error(`Unable to find note with ID: ${noteId}.`);
        }
        const note = await froca.getNote(noteId);
        if (!note) {
            throw new Error(`Unable to find note: ${notePath}.`);
        }

        const activeNotePath = appContext.tabManager.getActiveContextNotePath();
        const bestNotePath = note.getBestNotePath(hoistedNoteId, activeNotePath);

        if (!bestNotePath) {
            throw new Error(`Did not find any path segments for '${note.toString()}', hoisted note '${hoistedNoteId}'`);
        }

        // if there isn't actually any note path with hoisted note, then return the original resolved note path
        return bestNotePath.includes(hoistedNoteId) ? bestNotePath : effectivePathSegments;
    }
}

ws.subscribeToMessages((message) => {
    if (message.type === "openNote") {
        appContext.tabManager.activateOrOpenNote(message.noteId);

        if (utils.isElectron()) {
            const currentWindow = utils.dynamicRequire("@electron/remote").getCurrentWindow();

            currentWindow.show();
        }
    }
});

function getParentProtectedStatus(node: Fancytree.FancytreeNode) {
    return hoistedNoteService.isHoistedNode(node) ? false : node.getParent().data.isProtected;
}

function getNoteIdFromUrl(urlOrNotePath: string | null | undefined) {
    if (!urlOrNotePath) {
        return null;
    }

    const [notePath] = urlOrNotePath.split("?");
    const segments = notePath.split("/");

    return segments[segments.length - 1];
}

async function getBranchIdFromUrl(urlOrNotePath: string) {
    const { noteId, parentNoteId } = getNoteIdAndParentIdFromUrl(urlOrNotePath);
    if (!parentNoteId) {
        return null;
    }

    return await froca.getBranchId(parentNoteId, noteId);
}

function getNoteIdAndParentIdFromUrl(urlOrNotePath: string) {
    if (!urlOrNotePath) {
        return {};
    }

    const [notePath] = urlOrNotePath.split("?");

    if (notePath === "root") {
        return {
            noteId: "root",
            parentNoteId: "none"
        };
    }

    let parentNoteId = "root";
    let noteId = "";

    if (notePath) {
        const segments = notePath.split("/");

        noteId = segments[segments.length - 1];

        if (segments.length > 1) {
            parentNoteId = segments[segments.length - 2];
        }
    }

    return {
        parentNoteId,
        noteId
    };
}

function getNotePath(node: Fancytree.FancytreeNode) {
    if (!node) {
        logError("Node is null");
        return "";
    }

    const path: string[] = [];

    while (node) {
        if (node.data.noteId) {
            path.push(node.data.noteId);
        }

        node = node.getParent();
    }

    return path.reverse().join("/");
}

async function getNoteTitle(noteId: string, parentNoteId: string | null = null) {
    utils.assertArguments(noteId);

    const note = await froca.getNote(noteId);
    if (!note) {
        return "[not found]";
    }

    let { title } = note;

    if (parentNoteId !== null) {
        const branchId = note.parentToBranch[parentNoteId];

        if (branchId) {
            const branch = froca.getBranch(branchId);

            if (branch?.prefix) {
                title = `${branch.prefix} - ${title}`;
            }
        }
    }

    return title;
}

async function getNotePathTitleComponents(notePath: string) {
    const titleComponents: string[] = [];

    if (notePath.startsWith("root/")) {
        notePath = notePath.substr(5);
    }

    // special case when we want just root's title
    if (notePath === "root") {
        titleComponents.push(await getNoteTitle(notePath));
    } else {
        let parentNoteId = "root";

        for (const noteId of notePath.split("/")) {
            titleComponents.push(await getNoteTitle(noteId, parentNoteId));

            parentNoteId = noteId;
        }
    }

    return titleComponents;
}

async function getNotePathTitle(notePath: string) {
    utils.assertArguments(notePath);

    const titlePath = await getNotePathTitleComponents(notePath);

    return titlePath.join(NOTE_PATH_TITLE_SEPARATOR);
}

async function getNoteTitleWithPathAsSuffix(notePath: string) {
    utils.assertArguments(notePath);

    const titleComponents = await getNotePathTitleComponents(notePath);

    if (!titleComponents || titleComponents.length === 0) {
        return "";
    }

    const title = titleComponents[titleComponents.length - 1];
    const path = titleComponents.slice(0, titleComponents.length - 1);

    const $titleWithPath = $('<span class="note-title-with-path">').append($('<span class="note-title">').text(title));

    $titleWithPath.append(formatNotePath(path));

    return $titleWithPath;
}

function formatNotePath(path: string[]) {
    const $notePath = $('<span class="note-path">');

    if (path.length > 0) {
        $notePath.append($(`<span class="path-bracket"> (</span>)`));

        for (let segmentIndex = 0; segmentIndex < path.length; segmentIndex++) {
            $notePath.append($(`<span>`).text(path[segmentIndex]));

            if (segmentIndex < path.length - 1) {
                $notePath.append($(`<span class="path-delimiter">`).text(" / "));
            }
        }

        $notePath.append($(`<span class="path-bracket">)</span>)`));
    }

    return $notePath;
}

function isNotePathInHiddenSubtree(notePath: string) {
    return notePath?.includes("root/_hidden");
}

export default {
    resolveNotePath,
    resolveNotePathToSegments,
    getParentProtectedStatus,
    getNotePath,
    getNotePathTitleComponents,
    getNoteIdFromUrl,
    getNoteIdAndParentIdFromUrl,
    getBranchIdFromUrl,
    getNoteTitle,
    getNotePathTitle,
    getNoteTitleWithPathAsSuffix,
    isNotePathInHiddenSubtree,
    formatNotePath
};

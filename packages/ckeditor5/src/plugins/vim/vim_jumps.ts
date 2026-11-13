import type { CodeMirrorV, Marker, Pos, Vim } from "@replit/codemirror-vim-core";

/** The jump list of `Ctrl+O` and `Ctrl+I`, in the form the engine keeps it. */
export type JumpList = ReturnType<Vim["getVimGlobalState_"]>["jumpList"];

/** How many places a jump list keeps, as in the engine. */
const SIZE = 100;

/**
 * A jump list for one editor. The engine keeps a single list for every editor, which would send
 * `Ctrl+O` to a place in another note, so each session puts its own list in the engine before it
 * runs keys. The list is the ring of bookmarks of the engine's `createCircularJumpList()`, which
 * the engine does not export.
 */
export function createJumpList(): JumpList {
    const buffer: (Marker | undefined)[] = new Array(SIZE);
    let pointer = -1;
    let head = 0;
    let tail = 0;

    function useNextSlot(cm: CodeMirrorV, cursor: Pos) {
        pointer++;
        buffer[pointer % SIZE]?.clear();
        buffer[pointer % SIZE] = cm.setBookmark(cursor);
    }

    function move(cm: CodeMirrorV, offset: number): Marker | undefined {
        pointer = Math.min(Math.max(pointer + offset, tail), head);
        let mark = buffer[(SIZE + pointer) % SIZE];
        if (mark && !mark.find()) {
            // Skips the places that were deleted, and the one of the cursor.
            const step = offset > 0 ? 1 : -1;
            const cursor = cm.getCursor();
            do {
                pointer += step;
                mark = buffer[(SIZE + pointer) % SIZE];
                const found = mark?.find();
                if (found && (found.line !== cursor.line || found.ch !== cursor.ch)) {
                    break;
                }
            } while (pointer < head && pointer > tail);
        }
        return mark;
    }

    return {
        cachedCursor: undefined,
        add(cm, oldCur, newCur) {
            // Unlike the engine, records the place jumped from when the last place was deleted.
            const last = buffer[pointer % SIZE]?.find();
            if (last?.line !== oldCur.line || last.ch !== oldCur.ch) {
                useNextSlot(cm as CodeMirrorV, oldCur);
            }
            useNextSlot(cm as CodeMirrorV, newCur);
            head = pointer;
            tail = Math.max(pointer - SIZE + 1, 0);
        },
        move: (cm, offset) => move(cm as CodeMirrorV, offset),
        find(cm, offset) {
            const saved = pointer;
            const mark = move(cm as CodeMirrorV, offset);
            pointer = saved;
            return mark?.find();
        }
    };
}

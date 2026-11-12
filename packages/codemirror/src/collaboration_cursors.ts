import type { CollabPeer } from "@triliumnext/commons";
import { type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** A range of the selection of a peer, from its anchor to the caret. */
export interface PeerRange {
    anchor: number;
    head: number;
}

/** Sets who the other editors are, which removes the cursors of the ones that left. */
export const setPeers = StateEffect.define<CollabPeer[]>();
/** Shows the selection of a peer, or hides its cursor when it has no range. */
export const setPeerSelection = StateEffect.define<{ peerId: string; ranges: PeerRange[] }>();
/** Removes every cursor. The peers show again once they send their selection. */
export const clearPeerSelections = StateEffect.define<null>();

interface PeerCursors {
    peers: Map<string, CollabPeer>;
    selections: Map<string, PeerRange[]>;
    decorations: DecorationSet;
}

/**
 * Shows where the other editors of a session have their selection: a caret labeled with the name
 * of the user, and a highlight over each selected range, both in the user's avatar color. The
 * positions follow the edits around them.
 */
export const peerCursors = StateField.define<PeerCursors>({
    create: () => ({ peers: new Map(), selections: new Map(), decorations: Decoration.none }),

    update(value, transaction) {
        let { peers } = value;
        let selections = new Map<string, PeerRange[]>();
        for (const [ peerId, ranges ] of value.selections) {
            selections.set(peerId, ranges.map(({ anchor, head }) => ({
                anchor: transaction.changes.mapPos(anchor, 1),
                head: transaction.changes.mapPos(head, 1)
            })));
        }

        for (const effect of transaction.effects) {
            if (effect.is(setPeers)) {
                peers = new Map(effect.value.map((peer) => [ peer.peerId, peer ]));
            } else if (effect.is(setPeerSelection)) {
                selections.set(effect.value.peerId, effect.value.ranges);
            } else if (effect.is(clearPeerSelections)) {
                selections = new Map();
            }
        }
        for (const peerId of selections.keys()) {
            if (!peers.has(peerId)) {
                selections.delete(peerId);
            }
        }
        return { peers, selections, decorations: buildDecorations(peers, selections) };
    },

    provide: (field) => [ EditorView.decorations.from(field, (value) => value.decorations), buildCursorTheme() ]
});

function buildDecorations(peers: Map<string, CollabPeer>, selections: Map<string, PeerRange[]>) {
    const decorations: Range<Decoration>[] = [];
    for (const [ peerId, ranges ] of selections) {
        const peer = peers.get(peerId) as CollabPeer;
        for (const { anchor, head } of ranges) {
            if (anchor !== head) {
                decorations.push(Decoration.mark({
                    class: "cm-collab-selection",
                    attributes: { style: `--collab-hue:${peer.avatarHue}` }
                }).range(Math.min(anchor, head), Math.max(anchor, head)));
            }
        }
        const caret = ranges[ranges.length - 1];
        if (caret) {
            decorations.push(Decoration.widget({ widget: new CaretWidget(peer), side: 1 }).range(caret.head));
        }
    }
    return Decoration.set(decorations, true);
}

class CaretWidget extends WidgetType {

    constructor(private peer: CollabPeer) {
        super();
    }

    override eq(other: CaretWidget) {
        return other.peer.username === this.peer.username && other.peer.avatarHue === this.peer.avatarHue;
    }

    toDOM() {
        const caret = document.createElement("span");
        caret.className = "cm-collab-caret";
        caret.style.setProperty("--collab-hue", String(this.peer.avatarHue));
        caret.dataset.username = this.peer.username;
        return caret;
    }

}

/** The look of the cursors. A function, since `peerCursors` asks for it while this module loads. */
function buildCursorTheme() {
    const peerColor = "hsl(var(--collab-hue) 55% 45%)";
    return EditorView.baseTheme({
        ".cm-collab-selection": {
            backgroundColor: "hsl(var(--collab-hue) 55% 45% / 0.25)"
        },
        ".cm-collab-caret": {
            position: "relative",
            pointerEvents: "none",
            userSelect: "none"
        },
        ".cm-collab-caret::before": {
            content: "''",
            position: "absolute",
            insetBlock: "-0.1em",
            insetInlineStart: "-1px",
            borderInlineStart: `2px solid ${peerColor}`
        },
        ".cm-collab-caret::after": {
            content: "attr(data-username)",
            position: "absolute",
            insetBlockEnd: "calc(100% + 0.1em)",
            insetInlineStart: "-1px",
            padding: "0 4px",
            borderRadius: "3px 3px 3px 0",
            backgroundColor: peerColor,
            color: "white",
            fontFamily: "var(--main-font-family, sans-serif)",
            fontSize: "11px",
            lineHeight: "1.4",
            whiteSpace: "nowrap"
        }
    });
}

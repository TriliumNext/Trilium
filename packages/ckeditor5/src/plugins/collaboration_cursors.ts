import "../theme/collaboration.css";

import type { CollabPeer } from "@triliumnext/commons";
import type { Editor, ModelRange, ModelWriter } from "ckeditor5";

const CARET_GROUP = "collab-caret";
const SELECTION_GROUP = "collab-selection";

/**
 * Shows where the other editors of a session have their selection: a caret labeled with the name
 * of the user, and a highlight over a selected range, both in the user's avatar color. They are
 * markers without operations, so they follow the edits around them and never reach the other
 * editors or the saved note.
 */
export default class PeerCursors {

    private peers = new Map<string, CollabPeer>();

    constructor(private editor: Editor) {
        const conversion = editor.conversion.for("editingDowncast");
        conversion.markerToElement({
            model: CARET_GROUP,
            view: ({ markerName }, { writer }) => {
                const peer = this.getPeer(markerName);
                return writer.createUIElement("span", {
                    class: "collab-caret",
                    style: `--collab-hue:${peer.avatarHue}`,
                    "data-username": peer.username
                });
            }
        });
        conversion.markerToHighlight({
            model: SELECTION_GROUP,
            view: ({ markerName }) => ({
                classes: "collab-selection",
                attributes: { style: `--collab-hue:${this.getPeer(markerName).avatarHue}` }
            })
        });
    }

    /** Sets who the other editors are, and removes the cursors of the ones that left. */
    setPeers(peers: CollabPeer[]) {
        // Removing a highlight asks for its description once more, so the peers go after their cursors.
        const peerIds = new Set(peers.map((peer) => peer.peerId));
        this.removeMarkers((peerId) => !peerIds.has(peerId));
        this.peers = new Map(peers.map((peer) => [ peer.peerId, peer ]));
    }

    has(peerId: string) {
        return this.peers.has(peerId);
    }

    /** Removes every cursor. The peers show again once they send their selection. */
    clear() {
        this.removeMarkers(() => true);
    }

    /** Shows the selection of a peer, or hides its cursor when there is no range to show. */
    show(peerId: string, range: ModelRange | undefined, isBackward: boolean) {
        this.editor.model.enqueueChange({ isUndoable: false }, (writer) => {
            const caret = range && (isBackward ? range.start : range.end);
            this.setMarker(writer, `${CARET_GROUP}:${peerId}`, caret && writer.createRange(caret));
            this.setMarker(writer, `${SELECTION_GROUP}:${peerId}`, range?.isCollapsed ? undefined : range);
        });
    }

    private removeMarkers(isRemoved: (peerId: string) => boolean) {
        const { model } = this.editor;
        model.enqueueChange({ isUndoable: false }, (writer) => {
            for (const group of [ CARET_GROUP, SELECTION_GROUP ]) {
                for (const marker of [ ...model.markers.getMarkersGroup(group) ]) {
                    if (isRemoved(marker.name.slice(group.length + 1))) {
                        writer.removeMarker(marker);
                    }
                }
            }
        });
    }

    private setMarker(writer: ModelWriter, name: string, range: ModelRange | undefined) {
        const isShown = this.editor.model.markers.has(name);
        if (!range) {
            if (isShown) {
                writer.removeMarker(name);
            }
        } else if (isShown) {
            writer.updateMarker(name, { range });
        } else {
            writer.addMarker(name, { range, usingOperation: false, affectsData: false });
        }
    }

    /** The peer a cursor belongs to. Only the peers of the session get a cursor. */
    private getPeer(markerName: string) {
        return this.peers.get(markerName.slice(markerName.indexOf(":") + 1)) as CollabPeer;
    }

}

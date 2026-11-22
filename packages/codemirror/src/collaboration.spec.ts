import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { CollabClientMessage, CollabPeer, CollabServerMessage } from "@triliumnext/commons";
import { CollaborationSessions } from "@triliumnext/commons/src/lib/collaboration_sessions.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CodeCollaboration from "./collaboration.js";

const NOTE_ID = "note";
const HASH_DELAY = 500;
const SELECTION_DELAY = 100;

let views: EditorView[] = [];

beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
});

afterEach(() => {
    for (const view of views) {
        view.destroy();
    }
    views = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("CodeCollaboration", () => {
    describe("in a session", () => {
        it("sends local edits and applies the ones of other editors", () => {
            const network = new Network();
            const first = network.addEditor("writer1", "let a = 1;");
            const second = network.addEditor("writer2", "other");
            expect(first.view.state.readOnly).toBe(true);
            network.drain();

            // The second editor takes the content of the first one.
            expect(text(second)).toBe("let a = 1;");
            expect(first.view.state.readOnly).toBe(false);
            expect(first.collaboration).toMatchObject({ isActive: true, noteId: NOTE_ID, isSaver: true });
            expect(second.collaboration.isSaver).toBe(false);
            expect(network.saverChanges).toEqual([ "writer1:true" ]);

            type(first, 10, "\nlet b = 2;");
            type(second, 0, "// start\n");
            network.drain();
            expect(text(first)).toBe("// start\nlet a = 1;\nlet b = 2;");
            expect(text(second)).toBe(text(first));

            // Each editor undoes its own edit, and the edit of the other one stays.
            undo(first.view);
            network.drain();
            expect(text(second)).toBe("// start\nlet a = 1;");
            expect(text(first)).toBe(text(second));
            expect(network.count("collab-reset")).toBe(0);
        });

        it("sends one batch at a time, and what was typed meanwhile after it", () => {
            const network = new Network();
            const first = network.addEditor("writer1", "");
            const second = network.addEditor("writer2", "");
            network.drain();

            type(first, 0, "a");
            type(first, 1, "b");
            type(first, 2, "c");
            expect(network.sent.filter((message) => message.type === "collab-ops")).toHaveLength(1);
            network.drain();
            expect(text(second)).toBe("abc");
            expect(network.count("collab-ops")).toBe(4);

            // A batch based on an older version is sent again, on top of what the editor missed.
            type(first, 0, "1");
            type(second, 3, "2");
            network.drain();
            expect(network.count("collab-rejected")).toBe(1);
            expect(text(first)).toBe("1abc2");
            expect(text(second)).toBe("1abc2");
        });

        it("keeps an editor read-only for a user who cannot write, and leaves one that is turned down alone", () => {
            const network = new Network();
            const writer = network.addEditor("writer1", "content");
            const reader = network.addEditor("reader1", "");
            const stranger = network.addEditor("stranger1", "mine");
            network.drain();

            expect(text(reader)).toBe("content");
            expect(reader.view.state.readOnly).toBe(true);
            type(writer, 7, "!");
            network.drain();
            expect(text(reader)).toBe("content!");

            expect(stranger.collaboration).toMatchObject({ isActive: false, noteId: undefined });
            expect(stranger.view.state.readOnly).toBe(false);
            expect(text(stranger)).toBe("mine");
        });

        it("passes the saving on when the saver leaves, and joins again after a lost connection", () => {
            const network = new Network();
            const first = network.addEditor("writer1", "content");
            const second = network.addEditor("writer2", "");
            network.drain();

            network.disconnect("writer2");
            type(first, 7, "!");
            type(second, 0, "lost");
            second.collaboration.rejoin();
            network.drain();
            expect(text(second)).toBe("content!");

            // The server has the editor join again when the access of its user changed.
            const joins = () => network.sent.filter((message) => message.type === "collab-join").length;
            const before = joins();
            second.collaboration.receive({ type: "collab-rejoin", noteId: NOTE_ID, memberId: "writer2" });
            expect(joins()).toBe(before + 1);
            expect(second.view.state.readOnly).toBe(true);
            network.drain();
            expect(second.view.state.readOnly).toBe(false);

            first.collaboration.stop();
            network.drain();
            expect(network.saverChanges).toEqual([ "writer1:true", "writer2:true" ]);
            expect(network.sent.some((message) => message.type === "collab-leave" && message.memberId === "writer1")).toBe(true);
            // The changes of an editor outside a session go nowhere.
            const sent = network.sent.length;
            type(first, 0, "alone");
            expect(network.sent).toHaveLength(sent);

            // Without a session there is nothing to stop or to join again.
            first.collaboration.stop();
            first.collaboration.rejoin();
            expect(first.collaboration.isActive).toBe(false);
        });
    });

    describe("when the editors diverge", () => {
        it("resets the others from the saver once the hashes differ", () => {
            const network = new Network();
            const first = network.addEditor("writer1", "content");
            const second = network.addEditor("writer2", "");
            network.drain();

            // A batch that reaches the second editor alone leaves it with other content of the same
            // length. A change of the length would fail on the next batch, which says so by itself.
            second.collaboration.receive({
                type: "collab-ops", noteId: NOTE_ID, memberId: "writer2", epoch: network.epoch, version: 1, isOwn: false,
                ops: [ { clientID: "ghost", changes: [ [ 1, "X" ], 6 ] } ]
            });
            Object.assign(second.collaboration, { version: 0 });
            type(first, 0, "A");
            network.drain();
            expect(text(second)).toBe("AXontent");

            vi.advanceTimersByTime(HASH_DELAY);
            while (!first.view.state.readOnly && network.deliverNext()) {
                // The server compares the hashes and asks the saver for its content.
            }
            // The saver does not change until the server has given its content to the others.
            expect(first.view.state.readOnly).toBe(true);
            network.drain();

            expect(network.count("collab-reset")).toBeGreaterThan(0);
            expect(text(second)).toBe("Acontent");
            expect(first.view.state.readOnly).toBe(false);

            type(second, 0, "B");
            network.drain();
            expect(text(first)).toBe("BAcontent");

            // An editor with changes the server has not accepted has no version to report.
            const sent = network.sent.length;
            type(first, 0, "C");
            vi.advanceTimersByTime(HASH_DELAY);
            const sentByFirst = network.sent.slice(sent).filter((message) => message.memberId === "writer1");
            expect(sentByFirst.map((message) => message.type)).toEqual([ "collab-ops" ]);
        });

        it("asks for a reset when it cannot apply a batch or the batches after a snapshot", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const network = new Network();
            const first = network.addEditor("writer1", "content");
            const second = network.addEditor("writer2", "");
            network.drain();

            // The change is for a longer document than the editors hold, its sender included.
            const broken = { clientID: "writer2", changes: [ 50, [ 0, "x" ] ] };
            network.send("writer2", { type: "collab-ops", epoch: network.epoch, baseVersion: 0, ops: [ broken ] });
            network.deliver("up", "writer2");
            network.deliver("down", "writer1");
            expect(first.view.state.readOnly).toBe(true);
            expect(network.sent.at(-1)).toMatchObject({ type: "collab-error", memberId: "writer1" });
            // While the editor waits for the reset, it drops what is left of the epoch.
            first.collaboration.receive({
                type: "collab-rejected", noteId: NOTE_ID, memberId: "writer1", epoch: network.epoch
            });
            network.drain();
            expect(first.view.state.readOnly).toBe(false);
            expect(text(second)).toBe(text(first));

            const third = network.addEditor("writer3", "");
            network.deliver("up", "writer3");
            third.collaboration.receive({
                type: "collab-joined", noteId: NOTE_ID, memberId: "writer3", epoch: network.epoch, version: 1,
                snapshot: { doc: "content" }, batches: [ [ broken ] ], canWrite: true
            });
            expect(network.sent.at(-1)).toMatchObject({ type: "collab-error", memberId: "writer3" });
            expect(warn).toHaveBeenCalledTimes(3);
        });

        it("ignores the messages of another editor, session or epoch", () => {
            const network = new Network();
            const editor = network.addEditor("writer1", "content");
            const address = { noteId: NOTE_ID, memberId: "writer1" };
            const batch = {
                type: "collab-ops" as const, epoch: 1, version: 1, isOwn: false,
                ops: [ { clientID: "x", changes: [ [ 0, "no" ], 7 ] } ]
            };

            // The editor is still joining.
            editor.collaboration.receive({ ...address, ...batch });
            network.drain();
            editor.collaboration.receive({ ...address, ...batch, memberId: "other" });
            editor.collaboration.receive({ ...address, ...batch, noteId: "other" });
            editor.collaboration.receive({ ...address, ...batch, epoch: 7 });
            expect(text(editor)).toBe("content");
            expect(network.sent.map((message) => message.type)).toEqual([ "collab-join" ]);
        });
    });

    describe("cursors", () => {
        function joinTwo(doc = "Hello world") {
            const network = new Network();
            const first = network.addEditor("writer1", doc);
            const second = network.addEditor("writer2", "");
            network.drain();
            // Each editor sends where it is to the one that joined.
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            return { network, first, second };
        }

        function select(editor: Editor, anchor: number, head = anchor) {
            editor.view.dispatch({ selection: EditorSelection.single(anchor, head) });
        }

        /** The carets an editor shows, as the text before each with the name on it. */
        function caretsOf(editor: Editor) {
            return Array.from(editor.view.dom.querySelectorAll<HTMLElement>(".cm-collab-caret"), (caret) => {
                const before = editor.view.state.sliceDoc(0, editor.view.posAtDOM(caret));
                return `${before}|${caret.dataset.username}|${caret.style.getPropertyValue("--collab-hue")}`;
            });
        }

        function highlightsOf(editor: Editor) {
            return Array.from(editor.view.dom.querySelectorAll(".cm-collab-selection"), (mark) => mark.textContent);
        }

        it("shows the caret and the selection of another editor with the name and color of its user", () => {
            const { network, first, second } = joinTwo();
            expect(network.peers.get("writer1")).toEqual([ "writer2" ]);
            expect(caretsOf(second)).toEqual([ "|writer1|100" ]);

            select(first, 5);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(caretsOf(second)).toEqual([ "Hello|writer1|100" ]);
            expect(caretsOf(first)).toEqual([ "|writer2|200" ]);
            expect(highlightsOf(second)).toEqual([]);

            // The caret follows the text typed before it, and is no part of the content.
            type(second, 0, ">>");
            expect(caretsOf(second)).toEqual([ ">>Hello|writer1|100" ]);
            expect(text(second)).toBe(">>Hello world");
            network.drain();

            // A selection made backward has its caret at its start.
            select(first, 13, 8);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(highlightsOf(second)).toEqual([ "world" ]);
            expect(caretsOf(second)).toEqual([ ">>Hello |writer1|100" ]);
        });

        it("sends the selection once the server has every edit, and again when it came too late", () => {
            const { network, first, second } = joinTwo();

            type(first, 5, "!");
            select(first, 6);
            vi.advanceTimersByTime(SELECTION_DELAY);
            expect(network.sent.at(-1)?.type).toBe("collab-ops");
            network.drain();
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(caretsOf(second)).toEqual([ "Hello!|writer1|100" ]);

            // A selection that reaches the server after a batch of another editor is refused.
            select(first, 0);
            vi.advanceTimersByTime(SELECTION_DELAY);
            type(second, 12, "?");
            network.deliver("up", "writer2");
            network.drain();
            expect(network.count("collab-selection-rejected")).toBe(1);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(caretsOf(second)).toEqual([ "|writer1|100" ]);
        });

        it("places a selection behind the changes the server has not accepted yet", () => {
            const { network, first, second } = joinTwo();

            select(first, 5);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.deliver("up", "writer1");
            // The second editor types before the caret, which was sent without knowing of it.
            type(second, 0, "> ");
            network.deliver("down", "writer2");
            expect(caretsOf(second)).toEqual([ "> Hello|writer1|100" ]);
        });

        it("hides the cursor of an editor that left, of a stranger, and one that points nowhere", () => {
            const { network, first, second } = joinTwo();
            const selection = (ranges: unknown, peerId = "1") => second.collaboration.receive({
                type: "collab-selection", noteId: NOTE_ID, memberId: "writer2", epoch: network.epoch, peerId,
                selection: { ranges }
            });

            selection([ { anchor: 2, head: 4 } ]);
            expect(highlightsOf(second)).toEqual([ "ll" ]);
            selection([ { anchor: 2, head: 400 } ]);
            expect(caretsOf(second)).toEqual([]);
            selection([ { anchor: 2, head: 3 } ]);
            selection("nonsense");
            expect(caretsOf(second)).toEqual([]);
            selection([ { anchor: 1, head: 1 } ], "9");
            expect(caretsOf(second)).toEqual([]);

            selection([ { anchor: 1, head: 1 } ]);
            expect(caretsOf(second)).toEqual([ "H|writer1|100" ]);
            first.collaboration.stop();
            network.drain();
            expect(network.peers.get("writer2")).toEqual([]);
            expect(caretsOf(second)).toEqual([]);
        });
    });

    it("ends with the same content in every editor after random concurrent edits, without a reset", () => {
        for (let seed = 1; seed <= 40; seed++) {
            const random = createRandom(seed);
            const network = new Network();
            const editors = [ network.addEditor("writer1", "function main() {\n    return 42;\n}\n"), network.addEditor("writer2", "") ];
            network.drain();

            for (let edits = 0; edits < 40;) {
                if (random() < 0.4) {
                    makeRandomEdit(editors[Math.floor(random() * editors.length)] as Editor, random);
                    edits++;
                } else {
                    network.deliverNext(random);
                }
                if (edits === 20 && editors.length === 2) {
                    editors.push(network.addEditor("writer3", ""));
                }
            }
            for (let round = 0; round < 2; round++) {
                network.drain(random);
                vi.advanceTimersByTime(HASH_DELAY);
            }
            network.drain(random);

            expect(new Set(editors.map(text)).size, `seed ${seed}`).toBe(1);
            expect(network.count("collab-reset"), `seed ${seed}`).toBe(0);
            for (const editor of editors) {
                editor.view.destroy();
            }
        }
    });
});

interface Editor {
    view: EditorView;
    collaboration: CodeCollaboration;
}

type Direction = "up" | "down";

/** The sessions of the server and the wires to it. Each wire delivers in order, like a socket. */
class Network {
    readonly sent: CollabClientMessage[] = [];
    readonly received: CollabServerMessage[] = [];
    readonly saverChanges: string[] = [];
    /** The names of the other editors, as each editor was last told. */
    readonly peers = new Map<string, string[]>();
    epoch = 1;

    private editors = new Map<string, Editor>();
    private wires = new Map<string, (CollabClientMessage | CollabServerMessage)[]>();
    private sessions = new CollaborationSessions({
        send: (clientId, message) => this.wire("down", clientId).push(message),
        getAccess: (_noteId, userId = "") => (userId.startsWith("stranger") ? null : {
            canWrite: userId.startsWith("writer"),
            user: { userId, username: userId, avatarHue: 100 * Number(userId.at(-1)) }
        })
    });

    /** Creates an editor with the content and joins it. Its name is also its user. */
    addEditor(id: string, doc: string): Editor {
        const view = new EditorView({ doc, extensions: [ history() ], parent: document.body });
        views.push(view);
        const editor = { view, collaboration: new CodeCollaboration(view) };
        this.editors.set(id, editor);
        editor.collaboration.start(this.sessionOf(id));
        return editor;
    }

    sessionOf(id: string) {
        return {
            noteId: NOTE_ID,
            memberId: id,
            send: (message: CollabClientMessage) => this.send(id, message),
            onSaverChange: (isSaver: boolean) => this.saverChanges.push(`${id}:${isSaver}`),
            onPeersChange: (peers: CollabPeer[]) => this.peers.set(id, peers.map((peer) => peer.username))
        };
    }

    send(id: string, message: object) {
        const complete = { noteId: NOTE_ID, memberId: id, ...message } as CollabClientMessage;
        this.sent.push(complete);
        this.wire("up", id).push(complete);
    }

    /** Drops the connection of an editor and what is on its wires. */
    disconnect(id: string) {
        this.wires.delete(`up:${id}`);
        this.wires.delete(`down:${id}`);
        this.sessions.handleDisconnect(id);
    }

    count(type: CollabServerMessage["type"]) {
        return this.received.filter((message) => message.type === type).length;
    }

    deliver(direction: Direction, id: string) {
        const message = this.wire(direction, id).shift();
        if (!message) {
            throw new Error(`Nothing to deliver ${direction} for ${id}.`);
        }
        if (direction === "up") {
            this.sessions.handleMessage(id, id, message as CollabClientMessage);
            return;
        }

        const received = message as CollabServerMessage;
        this.received.push(received);
        if ("epoch" in received) {
            this.epoch = received.epoch;
        }
        this.editors.get(id)?.collaboration.receive(received);
    }

    /** Delivers the oldest message of a random wire, or of the first one. */
    deliverNext(random: () => number = () => 0) {
        const busy = [ ...this.wires ].filter(([ , queue ]) => queue.length).map(([ name ]) => name);
        if (!busy.length) {
            return false;
        }
        const [ direction, id ] = (busy[Math.floor(random() * busy.length)] as string).split(":");
        this.deliver(direction as Direction, id as string);
        return true;
    }

    drain(random?: () => number) {
        while (this.deliverNext(random)) {
            // Each delivery can put more messages on the wires.
        }
    }

    private wire(direction: Direction, id: string) {
        const name = `${direction}:${id}`;
        let queue = this.wires.get(name);
        if (!queue) {
            queue = [];
            this.wires.set(name, queue);
        }
        return queue;
    }
}

function text(editor: Editor) {
    return editor.view.state.doc.toString();
}

function type(editor: Editor, from: number, insert: string) {
    editor.view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
}

function makeRandomEdit(editor: Editor, random: () => number) {
    const { view } = editor;
    const length = view.state.doc.length;
    const from = Math.floor(random() * (length + 1));
    const choice = random();
    if (view.state.readOnly) {
        return;
    }
    if (choice < 0.5) {
        view.dispatch({ changes: { from, insert: random() < 0.2 ? "\n" : "xy".slice(0, 1 + Math.floor(random() * 2)) } });
    } else if (choice < 0.8) {
        view.dispatch({ changes: { from, to: Math.min(length, from + 1 + Math.floor(random() * 4)) } });
    } else if (choice < 0.95) {
        undo(view);
    } else {
        redo(view);
    }
}

/** Mulberry32, so a failing run can be replayed from its seed. */
function createRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

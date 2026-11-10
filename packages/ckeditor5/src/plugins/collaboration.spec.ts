import type { CollabClientMessage, CollabPeer, CollabServerMessage } from "@triliumnext/commons";
import {
    _getModelData, _setModelData, Bold, type ClassicEditor, Essentials, Heading, Italic, List, type ModelRange,
    Paragraph, Table
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

// The sessions are the server half of the protocol. The module has no imports of its own, so the
// editors here run against the real one.
import { CollaborationSessions } from "../../../trilium-core/src/services/collaboration_sessions.js";
import { createTestEditor, createTestEditorOf } from "../../test/editor-kit.js";
import { registerTestCleanup } from "../../test/globals-test-kit.js";
import { ClassicEditor as TriliumEditor } from "../index.js";
import Collaboration from "./collaboration.js";

const PLUGINS = [ Essentials, Paragraph, Bold, Italic, Heading, List, Table, Collaboration ];
const NOTE_ID = "note";
const HASH_DELAY = 500;
const SELECTION_DELAY = 100;

const INITIAL_DATA = [
    "<h2>Title</h2>",
    "<p>The quick brown fox jumps over the lazy dog.</p>",
    "<p>Second <strong>paragraph</strong> with <i>some</i> formatting.</p>",
    "<ul><li>one</li><li>two<ul><li>nested</li></ul></li><li>three</li></ul>",
    "<figure class=\"table\"><table><tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody></table></figure>",
    "<p>Last paragraph.</p>"
].join("");

describe("Collaboration", () => {
    describe("in a session", () => {
        it("sends local edits and applies the ones of other editors", async () => {
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Hello</p>");
            const second = await network.addEditor("writer2", "<p>Other</p>");
            network.drain();

            // The second editor takes the content of the first one.
            expect(second.getData()).toBe("<p>Hello</p>");
            expect(first.plugins.get("Collaboration").isActive).toBe(true);
            expect(first.plugins.get("Collaboration").noteId).toBe(NOTE_ID);

            typeAt(first, [ 0, 5 ], " world");
            typeAt(second, [ 0, 0 ], "> ");
            network.drain();
            expect(first.getData()).toBe("<p>&gt; Hello world</p>");
            expect(second.getData()).toBe("<p>&gt; Hello world</p>");

            // Each editor undoes its own edit, and the edit of the other one stays.
            first.execute("undo");
            network.drain();
            expect(first.getData()).toBe("<p>&gt; Hello</p>");
            expect(second.getData()).toBe("<p>&gt; Hello</p>");
            expect(network.count("collab-reset")).toBe(0);
        });

        it("carries the content of Trilium's own editor build", async () => {
            const content = [
                "<h2>Title</h2><p>Hello <strong>world</strong></p><ul><li>one</li><li>two</li></ul>",
                "<ul class=\"todo-list\"><li><label class=\"todo-list__label\"><input type=\"checkbox\" disabled=\"disabled\">",
                "<span class=\"todo-list__label__description\">todo</span></label></li></ul>",
                "<figure class=\"table\"><table><tbody><tr><td>a</td><td>b</td></tr></tbody></table></figure>",
                "<pre><code class=\"language-plaintext\">code</code></pre><aside class=\"admonition note\"><p>note</p></aside>"
            ].join("");
            const create = (initialData: string) => () =>
                createTestEditorOf(TriliumEditor, undefined, { initialData }) as unknown as Promise<ClassicEditor>;
            const network = new Network();
            const first = await network.addEditor("writer1", "", create(content));
            const second = await network.addEditor("writer2", "", create(""));
            network.drain();
            expect(second.getData()).toBe(first.getData());
            expect(second.getData()).toContain("<aside class=\"admonition note\"><p>note</p></aside>");

            typeAt(first, [ 1, 11 ], "!");
            first.execute("enter");
            typeAt(second, [ 0, 0 ], "> ");
            network.drain();
            expect(second.getData()).toBe(first.getData());
            expect(first.getData()).toContain("<h2>&gt; Title</h2><p>Hello <strong>world!</strong></p><p>&nbsp;</p>");
            expect(network.count("collab-reset")).toBe(0);
        });

        it("makes the first writer the saver, and the next one when it leaves", async () => {
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Hello</p>");
            const second = await network.addEditor("writer2", "");
            network.drain();
            expect(network.saverChanges).toEqual([ "writer1:true" ]);
            expect(first.plugins.get("Collaboration").isSaver).toBe(true);
            expect(second.plugins.get("Collaboration").isSaver).toBe(false);

            first.plugins.get("Collaboration").stop();
            network.drain();
            expect(network.saverChanges).toEqual([ "writer1:true", "writer2:true" ]);
            expect(first.plugins.get("Collaboration").isActive).toBe(false);

            // An editor that is destroyed leaves the session.
            await second.destroy();
            expect(network.sent.at(-1)).toMatchObject({ type: "collab-leave", memberId: "writer2" });
        });

        it("keeps an editor read-only while it joins, and for a user who cannot write", async () => {
            const network = new Network();
            const writer = await network.addEditor("writer1", "<p>Hello</p>");
            expect(writer.isReadOnly).toBe(true);
            network.drain();
            expect(writer.isReadOnly).toBe(false);

            const reader = await network.addEditor("reader1", "");
            network.drain();
            expect(reader.getData()).toBe("<p>Hello</p>");
            expect(reader.isReadOnly).toBe(true);

            typeAt(writer, [ 0, 5 ], "!");
            network.drain();
            expect(reader.getData()).toBe("<p>Hello!</p>");

            // A user who cannot see the note edits it as before.
            const stranger = await network.addEditor("stranger1", "<p>Mine</p>");
            network.drain();
            expect(stranger.isReadOnly).toBe(false);
            expect(stranger.plugins.get("Collaboration").isActive).toBe(false);
            expect(stranger.plugins.get("Collaboration").noteId).toBeUndefined();
            expect(stranger.getData()).toBe("<p>Mine</p>");
        });

        it("gives an editor that joins the nodes the session deleted, so an undo restores them", async () => {
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Before</p>");
            // What the editor deleted before the session stays out of the snapshot.
            first.setData("<p>One</p><p>Two</p>");
            first.plugins.get("Collaboration").start(network.sessionOf("writer1"));
            network.drain();

            // The deleted character lands next to the text of the earlier content in the graveyard.
            first.model.change((writer) => writer.setSelection(first.model.createPositionFromPath(root(first), [ 0, 3 ])));
            first.execute("delete");
            first.model.change((writer) => writer.setSelection(first.model.createPositionFromPath(root(first), [ 1, 0 ])));
            first.execute("delete");
            network.drain();
            expect(first.getData()).toBe("<p>OnTwo</p>");

            const second = await network.addEditor("writer2", "<p>Unrelated</p>");
            network.drain();
            expect(second.getData()).toBe("<p>OnTwo</p>");
            const snapshot = network.received.find((message) => message.type === "collab-joined" && message.snapshot);
            expect(snapshot).toMatchObject({ snapshot: { graveyard: [ { name: "paragraph" }, { data: "e" } ] } });

            first.execute("undo");
            first.execute("undo");
            network.drain();
            expect(second.getData()).toBe("<p>One</p><p>Two</p>");
            expect(network.count("collab-reset")).toBe(0);
        });

        it("joins again from the content of the others after the connection was lost", async () => {
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Hello</p>");
            const second = await network.addEditor("writer2", "");
            network.drain();

            network.disconnect("writer2");
            typeAt(first, [ 0, 5 ], "!");
            typeAt(second, [ 0, 0 ], "lost");
            second.plugins.get("Collaboration").rejoin();
            network.drain();
            expect(second.getData()).toBe("<p>Hello!</p>");

            // Without a session there is nothing to join again.
            second.plugins.get("Collaboration").stop();
            second.plugins.get("Collaboration").stop();
            second.plugins.get("Collaboration").rejoin();
            expect(second.plugins.get("Collaboration").isActive).toBe(false);
        });
    });

    describe("when the editors diverge", () => {
        it("resets the others from the saver once the hashes differ", async () => {
            useFakeTimers();
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Hello</p>");
            const second = await network.addEditor("writer2", "");
            network.drain();

            // A change that reaches no other editor, as a post-fixer on a remote batch makes.
            second.model.enqueueChange({ isLocal: false }, (writer) => {
                writer.insertText("?", root(second).getChild(0) as never, "end");
            });
            typeAt(first, [ 0, 0 ], "A");
            network.drain();
            expect(second.getData()).toBe("<p>AHello?</p>");

            vi.advanceTimersByTime(HASH_DELAY);
            expect(first.isReadOnly).toBe(false);
            while (!first.isReadOnly && network.deliverRandom()) {
                // The server compares the hashes and asks the saver for its model.
            }
            // The saver does not change until the server has given its model to the others.
            expect(first.isReadOnly).toBe(true);
            expect(network.count("collab-reset")).toBe(0);
            network.drain();

            expect(network.count("collab-reset")).toBe(2);
            expect(second.getData()).toBe("<p>AHello</p>");
            expect(first.isReadOnly).toBe(false);

            typeAt(second, [ 0, 0 ], "B");
            network.drain();
            expect(first.getData()).toBe("<p>BAHello</p>");

            // An editor with operations the server has not accepted has no version to report.
            const sent = network.sent.length;
            typeAt(first, [ 0, 0 ], "C");
            vi.advanceTimersByTime(HASH_DELAY);
            const sentByFirst = network.sent.slice(sent).filter((message) => message.memberId === "writer1");
            expect(sentByFirst.map((message) => message.type)).toEqual([ "collab-ops" ]);
        });

        it("asks for a reset when it cannot apply a batch, also as the saver", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            registerTestCleanup(() => warn.mockRestore());
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Hello</p>");
            const second = await network.addEditor("writer2", "");
            network.drain();

            const broken = {
                __className: "MoveOperation", baseVersion: 0, howMany: 5,
                sourcePosition: { root: "main", path: [ 7, 0 ], stickiness: "toNone" },
                targetPosition: { root: "$graveyard", path: [ 0 ], stickiness: "toNone" }
            };
            for (const [ sender, receiver ] of [ [ "writer2", first ], [ "writer1", second ] ] as const) {
                const epoch = network.epoch;
                typeAt(receiver, [ 0, 0 ], "x");
                network.send(sender, { type: "collab-ops", epoch, baseVersion: network.version, ops: [ broken ] });
                network.deliver("up", sender);
                network.deliver("down", receiver === first ? "writer1" : "writer2");
                expect(receiver.isReadOnly).toBe(true);
                expect(network.sent.at(-1)).toMatchObject({ type: "collab-error" });

                network.drain();
                expect(network.epoch).toBe(epoch + 1);
                expect(first.isReadOnly).toBe(false);
                expect(second.getData()).toBe(first.getData());
            }
            expect(warn).toHaveBeenCalledTimes(2);

            // A snapshot that cannot be loaded is reported the same way.
            const third = await network.addEditor("writer3", "");
            network.deliver("up", "writer3");
            third.plugins.get("Collaboration").receive({
                type: "collab-joined", noteId: NOTE_ID, memberId: "writer3", epoch: network.epoch, version: 0,
                snapshot: { main: [], graveyard: [] }, batches: [ [ broken ] ], canWrite: true
            });
            expect(network.sent.at(-1)).toMatchObject({ type: "collab-error", memberId: "writer3" });
        });

        it("ignores the messages of another editor, session or epoch", async () => {
            const network = new Network();
            const editor = await network.addEditor("writer1", "<p>Hello</p>");
            const plugin = editor.plugins.get("Collaboration");
            const address = { noteId: NOTE_ID, memberId: "writer1" };
            const batch = { type: "collab-ops" as const, epoch: 1, version: 1, isOwn: false, ops: [ "broken" ] };

            // The editor is still joining.
            plugin.receive({ ...address, ...batch });
            network.drain();
            plugin.receive({ ...address, ...batch, memberId: "other" });
            plugin.receive({ ...address, ...batch, noteId: "other" });
            plugin.receive({ ...address, ...batch, epoch: 7 });
            plugin.receive({ ...address, type: "collab-rejected", epoch: 7 });
            expect(network.sent.map((message) => message.type)).toEqual([ "collab-join" ]);
            expect(editor.getData()).toBe("<p>Hello</p>");

            // While the editor waits for a reset, it drops the batches of the epoch that ends.
            plugin.receive({ ...address, type: "collab-snapshot-request", epoch: 1, authoritative: true });
            plugin.receive({ ...address, ...batch });
            expect(network.sent.map((message) => message.type)).toEqual([ "collab-join", "collab-snapshot" ]);
        });
    });

    describe("cursors", () => {
        /** The cursors an editor shows, as the marker of each with its range in the model. */
        function cursorsOf(editor: ClassicEditor) {
            return Object.fromEntries(Array.from(editor.model.markers, (marker) => [
                marker.name, `${marker.getStart().path.join(".")}-${marker.getEnd().path.join(".")}`
            ]));
        }

        function select(editor: ClassicEditor, start: number[], end = start, backward = false) {
            const { model } = editor;
            model.change((writer) => writer.setSelection(model.createRange(
                model.createPositionFromPath(root(editor), start), model.createPositionFromPath(root(editor), end)
            ), { backward }));
        }

        async function joinTwo() {
            useFakeTimers();
            const network = new Network();
            const first = await network.addEditor("writer1", "<p>Hello world</p>");
            const second = await network.addEditor("writer2", "");
            network.drain();
            // Each editor sends where it is to the one that joined.
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            return { network, first, second };
        }

        it("shows the caret of another editor with the name and color of its user", async () => {
            const { network, first, second } = await joinTwo();
            expect(network.peers.get("writer1")).toEqual([ "writer2" ]);
            expect(network.peers.get("writer2")).toEqual([ "writer1" ]);

            select(first, [ 0, 5 ]);
            expect(cursorsOf(second)).not.toHaveProperty("collab-caret:1", "0.5-0.5");
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.5-0.5" });
            expect(cursorsOf(first)).not.toHaveProperty("collab-caret:1");

            const caret = second.editing.view.getDomRoot()?.querySelector<HTMLElement>(".collab-caret");
            expect(caret?.dataset.username).toBe("writer1");
            expect(caret?.style.getPropertyValue("--collab-hue")).toBe("100");
            expect(caret?.previousSibling?.textContent?.replaceAll("\u2060", "")).toBe("Hello");
            // The cursor is not content: it is neither saved nor sent to anyone.
            expect(second.getData()).toBe("<p>Hello world</p>");
            expect(network.count("collab-ops")).toBe(0);

            // The caret follows the text typed before it.
            typeAt(second, [ 0, 0 ], ">>");
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.7-0.7" });
        });

        it("keeps one caret for a user who types at it", async () => {
            const { network, first, second } = await joinTwo();
            select(first, [ 0, 5 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();

            // The text arrives before the selection that follows it.
            first.execute("insertText", { text: "abc" });
            network.drain();
            expect(cursorsOf(second)).toEqual({ "collab-caret:1": "0.8-0.8" });
            expect(second.editing.view.getDomRoot()?.querySelectorAll(".collab-caret")).toHaveLength(1);
        });

        it("highlights a selected range, with the caret at the end the user extends", async () => {
            const { network, first, second } = await joinTwo();

            select(first, [ 0, 0 ], [ 0, 5 ], true);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.0-0.0", "collab-selection:1:0": "0.0-0.5" });
            const highlight = second.editing.view.getDomRoot()?.querySelector<HTMLElement>(".collab-selection");
            expect(highlight?.textContent).toBe("Hello");
            expect(highlight?.style.getPropertyValue("--collab-hue")).toBe("100");

            select(first, [ 0, 6 ], [ 0, 11 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.11-0.11", "collab-selection:1:0": "0.6-0.11" });

            select(first, [ 0, 2 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.2-0.2" });
            expect(cursorsOf(second)).not.toHaveProperty("collab-selection:1:0");
        });

        it("highlights each selected table cell, without a caret between the cells", async () => {
            useFakeTimers();
            const network = new Network();
            const table = "<figure class=\"table\"><table><tbody><tr><td>a1</td><td>b1</td><td>c1</td></tr>"
                + "<tr><td>a2</td><td>b2</td><td>c2</td></tr></tbody></table></figure>";
            const first = await network.addEditor("writer1", table);
            const second = await network.addEditor("writer2", "");
            network.drain();

            // The selection of a row is one range around each of its cells.
            const { model } = first;
            model.change((writer) => writer.setSelection([ 0, 1, 2 ].map((cell) => model.createRange(
                model.createPositionFromPath(root(first), [ 0, 1, cell ]),
                model.createPositionFromPath(root(first), [ 0, 1, cell + 1 ])
            ))));
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();

            const dom = second.editing.view.getDomRoot();
            expect(cursorsOf(second)).toEqual({
                "collab-selection:1:0": "0.1.0-0.1.1", "collab-selection:1:1": "0.1.1-0.1.2", "collab-selection:1:2": "0.1.2-0.1.3"
            });
            expect(Array.from(dom?.querySelectorAll(".collab-selection") ?? [], (cell) => cell.textContent)).toEqual([ "a2", "b2", "c2" ]);
            expect(Array.from(dom?.querySelectorAll("tr") ?? [], (row) => row.children.length)).toEqual([ 3, 3 ]);

            // A selection with fewer ranges drops the highlights it no longer has.
            select(first, [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 2 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toEqual({ "collab-caret:1": "0.0.0.0.2-0.0.0.0.2", "collab-selection:1:0": "0.0.0.0.0-0.0.0.0.2" });
        });

        it("sends the selection once the server has every edit, and again when it came too late", async () => {
            const { network, first, second } = await joinTwo();

            // The selection waits for the acknowledgement of the text typed with it.
            typeAt(first, [ 0, 5 ], "!");
            vi.advanceTimersByTime(SELECTION_DELAY);
            expect(network.sent.at(-1)?.type).toBe("collab-ops");
            network.drain();
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.6-0.6" });

            // A selection that reaches the server after a batch of another editor is refused.
            select(first, [ 0, 0 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            typeAt(second, [ 0, 6 ], "?");
            network.deliver("up", "writer2");
            network.drain();
            expect(network.count("collab-selection-rejected")).toBe(1);
            expect(cursorsOf(second)).not.toMatchObject({ "collab-caret:1": "0.0-0.0" });
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.drain();
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.0-0.0" });
        });

        it("places a selection behind the edits the server has not accepted yet", async () => {
            const { network, first, second } = await joinTwo();

            select(first, [ 0, 5 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            network.deliver("up", "writer1");
            // The second editor types before the caret, which was sent without knowing of it.
            typeAt(second, [ 0, 0 ], "> ");
            network.deliver("down", "writer2");
            expect(cursorsOf(second)).toMatchObject({ "collab-caret:1": "0.7-0.7" });
        });

        it("hides the cursor of an editor that left, sent no range or one that leads nowhere", async () => {
            const { network, first, second } = await joinTwo();
            const plugin = second.plugins.get("Collaboration");
            const selection = (ranges: { start: number[]; end: number[] }[]) => plugin.receive({
                type: "collab-selection", noteId: NOTE_ID, memberId: "writer2", epoch: network.epoch, peerId: "1",
                selection: { ranges, isBackward: false }
            });
            expect(cursorsOf(second)).toHaveProperty("collab-caret:1");

            selection([]);
            expect(cursorsOf(second)).toEqual({});
            selection([ { start: [ 0, 1 ], end: [ 0, 3 ] } ]);
            expect(cursorsOf(second)).toEqual({ "collab-caret:1": "0.3-0.3", "collab-selection:1:0": "0.1-0.3" });
            selection([ { start: [ 9, 9 ], end: [ 9, 9 ] } ]);
            expect(cursorsOf(second)).toEqual({});

            // A list of peers that still names the editor keeps its cursor, and a stranger gets none.
            selection([ { start: [ 0, 1 ], end: [ 0, 1 ] } ]);
            const peer = { peerId: "1", userId: "writer1", username: "writer1", avatarHue: 100 };
            plugin.receive({ type: "collab-peers", noteId: NOTE_ID, memberId: "writer2", peers: [ peer ] });
            plugin.receive({
                type: "collab-selection", noteId: NOTE_ID, memberId: "writer2", epoch: network.epoch, peerId: "9",
                selection: { ranges: [ { start: [ 0, 2 ], end: [ 0, 2 ] } ], isBackward: false }
            });
            expect(cursorsOf(second)).toEqual({ "collab-caret:1": "0.1-0.1" });

            first.plugins.get("Collaboration").stop();
            network.drain();
            expect(network.peers.get("writer2")).toEqual([]);
            expect(cursorsOf(second)).toEqual({});

            // An editor outside a session has nobody to tell where it is.
            const sent = network.sent.length;
            select(first, [ 0, 3 ]);
            vi.advanceTimersByTime(SELECTION_DELAY);
            expect(network.sent).toHaveLength(sent);
        });

        it("drops the cursors on a reset, and shows them again from what the editors send", async () => {
            const { network, first, second } = await joinTwo();
            expect(cursorsOf(second)).toHaveProperty("collab-caret:1");

            second.plugins.get("Collaboration").receive({
                type: "collab-reset", noteId: NOTE_ID, memberId: "writer2", epoch: network.epoch,
                snapshot: { main: [ { name: "paragraph", children: [ { data: "Hello world" } ] } ], graveyard: [] }
            });
            expect(cursorsOf(second)).toEqual({});
            expect(first.getData()).toBe("<p>Hello world</p>");
        });
    });

    it("ends with the same model in every editor after random concurrent edits", async () => {
        useFakeTimers();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        registerTestCleanup(() => warn.mockRestore());
        let resets = 0;

        for (let seed = 1; seed <= 25; seed++) {
            const random = createRandom(seed);
            const network = new Network();
            const editors = [
                await network.addEditor("writer1", INITIAL_DATA),
                await network.addEditor("writer2", "")
            ];
            network.drain();

            for (let edits = 0; edits < 30;) {
                if (random() < 0.3) {
                    edits += makeRandomEdit(pick(random, editors), random) ? 1 : 0;
                } else {
                    network.deliverRandom(random);
                }
                if (edits === 15 && editors.length === 2) {
                    editors.push(await network.addEditor("writer3", ""));
                }
            }

            // The hashes go out once the editors are idle, and a reset needs another round.
            for (let round = 0; round < 4; round++) {
                network.drain(random);
                vi.advanceTimersByTime(HASH_DELAY);
            }
            network.drain(random);

            const models = editors.map((editor) => _getModelData(editor.model, { withoutSelection: true }));
            expect(new Set(models).size, `seed ${seed}`).toBe(1);
            expect(editors.map((editor) => editor.isReadOnly), `seed ${seed}`).toEqual([ false, false, false ]);
            resets += network.count("collab-reset") ? 1 : 0;
            for (const editor of editors) {
                await editor.destroy();
            }
        }

        // Some runs converge by themselves and some need the reset, and both must end equal.
        expect(resets).toBeGreaterThan(0);
        expect(resets).toBeLessThan(25);
    }, 120_000);
});

type Direction = "up" | "down";

/** The sessions of the server and the wires to it. Each wire delivers in order, like a socket. */
class Network {

    readonly sent: CollabClientMessage[] = [];
    readonly received: CollabServerMessage[] = [];
    readonly saverChanges: string[] = [];
    /** The names of the other editors, as each editor was last told. */
    readonly peers = new Map<string, string[]>();
    epoch = 1;
    version = 0;

    private editors = new Map<string, ClassicEditor>();
    private wires = new Map<string, (CollabClientMessage | CollabServerMessage)[]>();
    private sessions = new CollaborationSessions({
        send: (clientId, message) => this.wire("down", clientId).push(message),
        getAccess: (_noteId, userId = "") => (userId.startsWith("stranger") ? null : {
            canWrite: userId.startsWith("writer"),
            user: { userId, username: userId, avatarHue: 100 * Number(userId.at(-1)) }
        })
    });

    /** Creates an editor with the content and joins it. Its name is also its user. */
    async addEditor(id: string, data: string, create = () => createTestEditor(PLUGINS, { initialData: data })) {
        const editor = await create();
        this.editors.set(id, editor);
        editor.plugins.get("Collaboration").start(this.sessionOf(id));
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

    send(id: string, message: Record<string, unknown>) {
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
        if (received.type === "collab-ops") {
            this.version = received.version;
        } else if (received.type === "collab-reset") {
            this.version = 0;
        }
        this.editors.get(id)?.plugins.get("Collaboration").receive(received);
    }

    /** Delivers the oldest message of a random wire, or of the first one. */
    deliverRandom(random: () => number = () => 0) {
        const busy = [ ...this.wires ].filter(([ , queue ]) => queue.length).map(([ name ]) => name);
        if (!busy.length) {
            return false;
        }
        const [ direction, id ] = pick(random, busy).split(":");
        this.deliver(direction as Direction, id ?? "");
        return true;
    }

    drain(random?: () => number) {
        while (this.deliverRandom(random)) {
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

function useFakeTimers() {
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
    registerTestCleanup(() => {
        vi.useRealTimers();
    });
}

function root(editor: ClassicEditor) {
    const mainRoot = editor.model.document.getRoot();
    if (!mainRoot) {
        throw new Error("The editor has no main root.");
    }
    return mainRoot;
}

function typeAt(editor: ClassicEditor, path: number[], text: string) {
    editor.model.change((writer) => writer.setSelection(editor.model.createPositionFromPath(root(editor), path)));
    editor.execute("insertText", { text });
}

const RANDOM_COMMANDS: [ string, Record<string, unknown>? ][] = [
    [ "insertText", { text: "x" } ], [ "insertText", { text: "yy" } ], [ "insertText", { text: " " } ],
    [ "enter" ], [ "delete" ], [ "deleteForward" ],
    [ "bold" ], [ "italic" ], [ "heading", { value: "heading2" } ], [ "paragraph" ],
    [ "bulletedList" ], [ "numberedList" ], [ "indentList" ], [ "outdentList" ],
    [ "insertTableRowBelow" ], [ "insertTableColumnRight" ], [ "removeTableRow" ], [ "undo" ], [ "undo" ], [ "redo" ]
];

/** Runs a random command at a random place, half of the time over a range. */
function makeRandomEdit(editor: ClassicEditor, random: () => number) {
    const first = randomRange(editor, random);
    const second = random() < 0.5 ? randomRange(editor, random) : first;
    if (!first || !second) {
        return false;
    }
    const start = first.start.isBefore(second.start) ? first.start : second.start;
    const end = first.end.isAfter(second.end) ? first.end : second.end;
    editor.model.change((writer) => writer.setSelection(writer.createRange(start, end)));

    const [ name, options ] = pick(random, RANDOM_COMMANDS);
    if (!editor.commands.get(name)?.isEnabled) {
        return false;
    }
    try {
        editor.execute(name, ...(options ? [ options ] : []));
    } catch {
        // A command can fail on a model that has diverged, which the reset then replaces.
    }
    return true;
}

function randomRange(editor: ClassicEditor, random: () => number): ModelRange | null {
    const model = editor.model;
    const positions = [ ...model.createRangeIn(root(editor)).getPositions({ singleCharacters: true }) ];
    const position = positions.length ? pick(random, positions) : model.createPositionAt(root(editor), 0);
    return model.schema.getNearestSelectionRange(position);
}

function pick<T>(random: () => number, items: T[]): T {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
        throw new Error("Cannot pick from an empty list.");
    }
    return item;
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

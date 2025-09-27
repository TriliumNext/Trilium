import server from "../../services/server.js";
import linkService from "../../services/link.js";
import contextMenu from "../../menus/context_menu.js";
import toastService from "../../services/toast.js";
import attributeAutocompleteService from "../../services/attribute_autocomplete.js";
import TypeWidget from "./type_widget.js";
import appContext, { type EventData } from "../../components/app_context.js";
import utils from "../../services/utils.js";
import froca from "../../services/froca.js";
import dialogService from "../../services/dialog.js";
import { t } from "../../services/i18n.js";
import type FNote from "../../entities/fnote.js";
import type { ConnectionMadeEventInfo, jsPlumbInstance, OverlaySpec } from "jsplumb";
import "../../stylesheets/relation_map.css";

declare module "jsplumb" {

    interface Connection {
        canvas: HTMLCanvasElement;
        getType(): string;
        bind(event: string, callback: (obj: unknown, event: MouseEvent) => void): void;
    }

    interface Overlay {
        setLabel(label: string): void;
    }

    interface ConnectParams {
        type: RelationType;
    }
}

const uniDirectionalOverlays: OverlaySpec[] = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ],
    ["Label", { label: "", id: "label", cssClass: "connection-label" }]
];

const biDirectionalOverlays = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ],
    ["Label", { label: "", id: "label", cssClass: "connection-label" }],
    [
        "Arrow",
        {
            location: 0,
            id: "arrow2",
            length: 14,
            direction: -1,
            foldback: 0.8
        }
    ]
];

const inverseRelationsOverlays = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ],
    ["Label", { label: "", location: 0.2, id: "label-source", cssClass: "connection-label" }],
    ["Label", { label: "", location: 0.8, id: "label-target", cssClass: "connection-label" }],
    [
        "Arrow",
        {
            location: 0,
            id: "arrow2",
            length: 14,
            direction: -1,
            foldback: 0.8
        }
    ]
];

const linkOverlays = [
    [
        "Arrow",
        {
            location: 1,
            id: "arrow",
            length: 14,
            foldback: 0.8
        }
    ]
];

const TPL = /*html*/`
<div class="note-detail-relation-map note-detail-printable">
    <div class="relation-map-wrapper">
       <div class="relation-map-container"></div>
    </div>
</div>`;

let containerCounter = 1;

interface Clipboard {
    noteId: string;
    title: string;
}

interface MapData {
    notes: {
        noteId: string;
        x: number;
        y: number;
    }[];
    transform: {
        x: number,
        y: number,
        scale: number
    }
}

export type RelationType = "uniDirectional" | "biDirectional" | "inverse";

interface Relation {
    name: string;
    attributeId: string;
    sourceNoteId: string;
    targetNoteId: string;
    type: RelationType;
    render: boolean;
}

// TODO: Deduplicate.
interface PostNoteResponse {
    note: {
        noteId: string;
    };
}

// TODO: Deduplicate.
interface RelationMapPostResponse {
    relations: Relation[];
    inverseRelations: Record<string, string>;
    noteTitles: Record<string, string>;
}

type MenuCommands = "openInNewTab" | "remove" | "editTitle";

export default class RelationMapTypeWidget extends TypeWidget {

    private clipboard?: Clipboard | null;
    private jsPlumbInstance?: import("jsplumb").jsPlumbInstance | null;
    private pzInstance?: PanZoom | null;
    private mapData?: MapData | null;
    private relations?: Relation[] | null;

    private $relationMapContainer!: JQuery<HTMLElement>;
    private $relationMapWrapper!: JQuery<HTMLElement>;

    static getType() {
        return "relationMap";
    }

    doRender() {
        this.$widget = $(TPL);
        this.$relationMapContainer = this.$widget.find(".relation-map-container");

        this.mapData = null;
        this.jsPlumbInstance = null;
        // outside of mapData because they are not persisted in the note content
        this.relations = null;
        this.pzInstance = null;

        this.$relationMapWrapper = this.$widget.find(".relation-map-wrapper");
        this.$relationMapWrapper.on("click", (event) => {
            if (this.clipboard && this.mapData) {
                let { x, y } = this.getMousePosition(event);

                // modifying position so that the cursor is on the top-center of the box
                x -= 80;
                y -= 15;

                this.createNoteBox(this.clipboard.noteId, this.clipboard.title, x, y);

                this.mapData.notes.push({ noteId: this.clipboard.noteId, x, y });

                this.saveData();

                this.clipboard = null;
            }

            return true;
        });

        this.$relationMapContainer.attr("id", "relation-map-container-" + containerCounter++);
        this.$relationMapContainer.on("contextmenu", ".note-box", (e) => {
            contextMenu.show<MenuCommands>({
                x: e.pageX,
                y: e.pageY,
                items: [
                    { title: t("relation_map.open_in_new_tab"), command: "openInNewTab", uiIcon: "bx bx-empty" },
                    { title: t("relation_map.remove_note"), command: "remove", uiIcon: "bx bx-trash" },
                    { title: t("relation_map.edit_title"), command: "editTitle", uiIcon: "bx bx-pencil" }
                ],
                selectMenuItemHandler: ({ command }) => this.contextMenuHandler(command, e.target)
            });

            return false; // blocks default browser right click menu
        });

        this.clipboard = null;

        this.$widget.on("drop", (ev) => this.dropNoteOntoRelationMapHandler(ev));
        this.$widget.on("dragover", (ev) => ev.preventDefault());

        this.initialized = new Promise(async (res) => {
            // Weird typecast is needed probably due to bad typings in the module itself.
            const jsPlumb = (await import("jsplumb")).default.jsPlumb as unknown as jsPlumbInstance;
            jsPlumb.ready(res);
        });

        super.doRender();
    }

    async contextMenuHandler(command: MenuCommands | undefined, originalTarget: HTMLElement) {
        const $noteBox = $(originalTarget).closest(".note-box");
        const $title = $noteBox.find(".title a");
        const noteId = this.idToNoteId($noteBox.prop("id"));

        if (command === "openInNewTab") {
            appContext.tabManager.openTabWithNoteWithHoisting(noteId);
        } else if (command === "remove") {
            const result = await dialogService.confirmDeleteNoteBoxWithNote($title.text());

            if (typeof result !== "object" || !result.confirmed) {
                return;
            }

            this.jsPlumbInstance?.remove(this.noteIdToId(noteId));

            if (result.isDeleteNoteChecked) {
                const taskId = utils.randomString(10);

                await server.remove(`notes/${noteId}?taskId=${taskId}&last=true`);
            }

            if (this.mapData) {
                this.mapData.notes = this.mapData.notes.filter((note) => note.noteId !== noteId);
            }

            if (this.relations) {
                this.relations = this.relations.filter((relation) => relation.sourceNoteId !== noteId && relation.targetNoteId !== noteId);
            }

            this.saveData();
        } else if (command === "editTitle") {
            const title = await dialogService.prompt({
                title: t("relation_map.rename_note"),
                message: t("relation_map.enter_new_title"),
                defaultValue: $title.text()
            });

            if (!title) {
                return;
            }

            await server.put(`notes/${noteId}/title`, { title });

            $title.text(title);
        }
    }

    async loadMapData() {
        this.mapData = {
            notes: [],
            // it is important to have this exact value here so that initial transform is the same as this
            // which will guarantee note won't be saved on first conversion to the relation map note type
            // this keeps the principle that note type change doesn't destroy note content unless user
            // does some actual change
            transform: {
                x: 0,
                y: 0,
                scale: 1
            }
        };

        const blob = await this.note?.getBlob();

        if (blob?.content) {
            try {
                this.mapData = JSON.parse(blob.content);
            } catch (e) {
                console.log("Could not parse content: ", e);
            }
        }
    }

    noteIdToId(noteId: string) {
        return `rel-map-note-${noteId}`;
    }

    idToNoteId(id: string) {
        return id.substr(13);
    }

    async doRefresh(note: FNote) {
        await this.loadMapData();

        await this.initJsPlumbInstance();

        await this.initPanZoom();

        this.loadNotesAndRelations();
    }

    clearMap() {
        // delete all endpoints and connections
        // this is done at this point (after async operations) to reduce flicker to the minimum
        this.jsPlumbInstance?.deleteEveryEndpoint();

        // without this, we still end up with note boxes remaining in the canvas
        this.$relationMapContainer.empty();
    }

    async loadNotesAndRelations() {
        if (!this.mapData || !this.jsPlumbInstance) {
            return;
        }

        const noteIds = this.mapData.notes.map((note) => note.noteId);
        const data = await server.post<RelationMapPostResponse>("relation-map", { noteIds, relationMapNoteId: this.noteId });

        this.relations = [];

        for (const relation of data.relations) {
            const match = this.relations.find(
                (rel) =>
                    rel.name === data.inverseRelations[relation.name] &&
                    ((rel.sourceNoteId === relation.sourceNoteId && rel.targetNoteId === relation.targetNoteId) ||
                        (rel.sourceNoteId === relation.targetNoteId && rel.targetNoteId === relation.sourceNoteId))
            );

            if (match) {
                match.type = relation.type = relation.name === data.inverseRelations[relation.name] ? "biDirectional" : "inverse";
                relation.render = false; // don't render second relation
            } else {
                relation.type = "uniDirectional";
                relation.render = true;
            }

            this.relations.push(relation);
        }

        this.mapData.notes = this.mapData.notes.filter((note) => note.noteId in data.noteTitles);

        this.jsPlumbInstance.batch(async () => {
            if (!this.jsPlumbInstance || !this.mapData || !this.relations) {
                return;
            }

            this.clearMap();

            for (const note of this.mapData.notes) {
                const title = data.noteTitles[note.noteId];

                await this.createNoteBox(note.noteId, title, note.x, note.y);
            }

            for (const relation of this.relations) {
                if (!relation.render) {
                    continue;
                }

                const connection = this.jsPlumbInstance.connect({
                    source: this.noteIdToId(relation.sourceNoteId),
                    target: this.noteIdToId(relation.targetNoteId),
                    type: relation.type
                });

                // TODO: Does this actually do anything.
                //@ts-expect-error
                connection.id = relation.attributeId;

                if (relation.type === "inverse") {
                    connection.getOverlay("label-source").setLabel(relation.name);
                    connection.getOverlay("label-target").setLabel(data.inverseRelations[relation.name]);
                } else {
                    connection.getOverlay("label").setLabel(relation.name);
                }

                connection.canvas.setAttribute("data-connection-id", connection.id);
            }
        });
    }

    async initPanZoom() {
        if (this.pzInstance) {
            return;
        }

        const panzoom = (await import("panzoom")).default;
        this.pzInstance = panzoom(this.$relationMapContainer[0], {
            maxZoom: 2,
            minZoom: 0.3,
            smoothScroll: false,

            //@ts-expect-error Upstream incorrectly mentions no arguments.
            filterKey: function (e: KeyboardEvent) {
                // if ALT is pressed, then panzoom should bubble the event up
                // this is to preserve ALT-LEFT, ALT-RIGHT navigation working
                return e.altKey;
            }
        });

        if (!this.pzInstance) {
            return;
        }

        this.pzInstance.on("transform", () => {
            // gets triggered on any transform change
            this.jsPlumbInstance?.setZoom(this.getZoom());

            this.saveCurrentTransform();
        });

        if (this.mapData?.transform) {
            this.pzInstance.zoomTo(0, 0, this.mapData.transform.scale);

            this.pzInstance.moveTo(this.mapData.transform.x, this.mapData.transform.y);
        } else {
            // set to initial coordinates
            this.pzInstance.moveTo(0, 0);
        }
    }

    saveCurrentTransform() {
        if (!this.pzInstance) {
            return;
        }

        const newTransform = this.pzInstance.getTransform();

        if (this.mapData && JSON.stringify(newTransform) !== JSON.stringify(this.mapData.transform)) {
            // clone transform object
            this.mapData.transform = JSON.parse(JSON.stringify(newTransform));

            this.saveData();
        }
    }

    cleanup() {
        if (this.jsPlumbInstance) {
            this.clearMap();
        }

        if (this.pzInstance) {
            this.pzInstance.dispose();
            this.pzInstance = null;
        }
    }

    async initJsPlumbInstance() {
        if (this.jsPlumbInstance) {
            this.cleanup();

            return;
        }

        const jsPlumb = (await import("jsplumb")).default.jsPlumb;
        this.jsPlumbInstance = jsPlumb.getInstance({
            Endpoint: ["Dot", { radius: 2 }],
            Connector: "StateMachine",
            ConnectionOverlays: uniDirectionalOverlays,
            HoverPaintStyle: { stroke: "#777", strokeWidth: 1 },
            Container: this.$relationMapContainer.attr("id")
        });

        if (!this.jsPlumbInstance) {
            return;
        }

        this.jsPlumbInstance.registerConnectionType("uniDirectional", { anchor: "Continuous", connector: "StateMachine", overlays: uniDirectionalOverlays });

        this.jsPlumbInstance.registerConnectionType("biDirectional", { anchor: "Continuous", connector: "StateMachine", overlays: biDirectionalOverlays });

        this.jsPlumbInstance.registerConnectionType("inverse", { anchor: "Continuous", connector: "StateMachine", overlays: inverseRelationsOverlays });

        this.jsPlumbInstance.registerConnectionType("link", { anchor: "Continuous", connector: "StateMachine", overlays: linkOverlays });

        this.jsPlumbInstance.bind("connection", (info, originalEvent) => this.connectionCreatedHandler(info, originalEvent));
    }

    async connectionCreatedHandler(info: ConnectionMadeEventInfo, originalEvent: Event) {
        const connection = info.connection;

        connection.bind("contextmenu", (obj: unknown, event: MouseEvent) => {
            if (connection.getType().includes("link")) {
                // don't create context menu if it's a link since there's nothing to do with link from relation map
                // (don't open browser menu either)
                event.preventDefault();
            } else {
                event.preventDefault();
                event.stopPropagation();

                contextMenu.show({
                    x: event.pageX,
                    y: event.pageY,
                    items: [{ title: t("relation_map.remove_relation"), command: "remove", uiIcon: "bx bx-trash" }],
                    selectMenuItemHandler: async ({ command }) => {
                        if (command === "remove") {
                            if (!(await dialogService.confirm(t("relation_map.confirm_remove_relation"))) || !this.relations) {
                                return;
                            }

                            const relation = this.relations.find((rel) => rel.attributeId === connection.id);

                            if (relation) {
                                await server.remove(`notes/${relation.sourceNoteId}/relations/${relation.name}/to/${relation.targetNoteId}`);
                            }

                            this.jsPlumbInstance?.deleteConnection(connection);

                            this.relations = this.relations.filter((relation) => relation.attributeId !== connection.id);
                        }
                    }
                });
            }
        });

        // if there's no event, then this has been triggered programmatically
        if (!originalEvent || !this.jsPlumbInstance) {
            return;
        }

        let name = await dialogService.prompt({
            message: t("relation_map.specify_new_relation_name"),
            shown: ({ $answer }) => {
                if (!$answer) {
                    return;
                }

                $answer.on("keyup", () => {
                    // invalid characters are simply ignored (from user perspective they are not even entered)
                    const attrName = utils.filterAttributeName($answer.val() as string);

                    $answer.val(attrName);
                });

                attributeAutocompleteService.initAttributeNameAutocomplete({
                    $el: $answer,
                    attributeType: "relation",
                    open: true
                });
            }
        });

        if (!name || !name.trim()) {
            this.jsPlumbInstance.deleteConnection(connection);

            return;
        }

        name = utils.filterAttributeName(name);

        const targetNoteId = this.idToNoteId(connection.target.id);
        const sourceNoteId = this.idToNoteId(connection.source.id);

        const relationExists = this.relations?.some((rel) => rel.targetNoteId === targetNoteId && rel.sourceNoteId === sourceNoteId && rel.name === name);

        if (relationExists) {
            await dialogService.info(t("relation_map.connection_exists", { name }));

            this.jsPlumbInstance.deleteConnection(connection);

            return;
        }

        await server.put(`notes/${sourceNoteId}/relations/${name}/to/${targetNoteId}`);

        this.loadNotesAndRelations();
    }

    saveData() {
        this.spacedUpdate.scheduleUpdate();
    }

    async createNoteBox(noteId: string, title: string, x: number, y: number) {
        if (!this.jsPlumbInstance) {
            return;
        }

        const $link = await linkService.createLink(noteId, { title });
        $link.mousedown((e) => linkService.goToLink(e));

        const note = await froca.getNote(noteId);
        if (!note) {
            return;
        }

        const $noteBox = $("<div>")
            .addClass("note-box")
            .addClass(note.getCssClass())
            .prop("id", this.noteIdToId(noteId))
            .append($("<span>").addClass("title").append($link))
            .append($("<div>").addClass("endpoint").attr("title", t("relation_map.start_dragging_relations")))
            .css("left", `${x}px`)
            .css("top", `${y}px`);

        this.jsPlumbInstance.getContainer().appendChild($noteBox[0]);

        this.jsPlumbInstance.draggable($noteBox[0], {
            start: (params) => {},
            drag: (params) => {},
            stop: (params) => {
                const noteId = this.idToNoteId(params.el.id);

                const note = this.mapData?.notes.find((note) => note.noteId === noteId);

                if (!note) {
                    logError(t("relation_map.note_not_found", { noteId }));
                    return;
                }

                //@ts-expect-error TODO: Check if this is still valid.
                [note.x, note.y] = params.finalPos;

                this.saveData();
            }
        });

        this.jsPlumbInstance.makeSource($noteBox[0], {
            filter: ".endpoint",
            anchor: "Continuous",
            connectorStyle: { stroke: "#000", strokeWidth: 1 },
            connectionType: "basic",
            extract: {
                action: "the-action"
            }
        });

        this.jsPlumbInstance.makeTarget($noteBox[0], {
            dropOptions: { hoverClass: "dragHover" },
            anchor: "Continuous",
            allowLoopback: true
        });
    }

    getZoom() {
        const matrixRegex = /matrix\((-?\d*\.?\d+),\s*0,\s*0,\s*-?\d*\.?\d+,\s*-?\d*\.?\d+,\s*-?\d*\.?\d+\)/;

        const transform = this.$relationMapContainer.css("transform");

        if (transform === "none") {
            return 1;
        }

        const matches = transform.match(matrixRegex);

        if (!matches) {
            throw new Error(t("relation_map.cannot_match_transform", { transform }));
        }

        return parseFloat(matches[1]);
    }

    async dropNoteOntoRelationMapHandler(ev: JQuery.DropEvent) {
        ev.preventDefault();

        const dragData = ev.originalEvent?.dataTransfer?.getData("text");
        if (!dragData) {
            return;
        }
        const notes = JSON.parse(dragData);

        let { x, y } = this.getMousePosition(ev);

        for (const note of notes) {
            const exists = this.mapData?.notes.some((n) => n.noteId === note.noteId);

            if (exists) {
                toastService.showError(t("relation_map.note_already_in_diagram", { title: note.title }));
                continue;
            }

            this.mapData?.notes.push({ noteId: note.noteId, x, y });

            if (x > 1000) {
                y += 100;
                x = 0;
            } else {
                x += 200;
            }
        }

        this.saveData();

        this.loadNotesAndRelations();
    }

    getMousePosition(evt: JQuery.ClickEvent | JQuery.DropEvent) {
        const rect = this.$relationMapContainer[0].getBoundingClientRect();

        const zoom = this.getZoom();

        return {
            x: ((evt.clientX ?? 0) - rect.left) / zoom,
            y: ((evt.clientY ?? 0) - rect.top) / zoom
        };
    }

    getData() {
        return {
            content: JSON.stringify(this.mapData)
        };
    }

    async relationMapCreateChildNoteEvent({ ntxId }: EventData<"relationMapCreateChildNote">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        const title = await dialogService.prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });

        if (!title?.trim()) {
            return;
        }

        const { note } = await server.post<PostNoteResponse>(`notes/${this.noteId}/children?target=into`, {
            title,
            content: "",
            type: "text"
        });

        toastService.showMessage(t("relation_map.click_on_canvas_to_place_new_note"));

        this.clipboard = { noteId: note.noteId, title };
    }

    relationMapResetPanZoomEvent({ ntxId }: EventData<"relationMapResetPanZoom">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        // reset to initial pan & zoom state
        this.pzInstance?.zoomTo(0, 0, 1 / this.getZoom());
        this.pzInstance?.moveTo(0, 0);
    }

    relationMapResetZoomInEvent({ ntxId }: EventData<"relationMapResetZoomIn">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        this.pzInstance?.zoomTo(0, 0, 1.2);
    }

    relationMapResetZoomOutEvent({ ntxId }: EventData<"relationMapResetZoomOut">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        this.pzInstance?.zoomTo(0, 0, 0.8);
    }
}

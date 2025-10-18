import TypeWidget from "./type_widget.js";
import utils from "../../services/utils.js";
import type { MindElixirInstance } from "mind-elixir";
import nodeMenu from "@mind-elixir/node-menu";
import type FNote from "../../entities/fnote.js";
import type { EventData } from "../../components/app_context.js";

// allow node-menu plugin css to be bundled by webpack
import "mind-elixir/style";
import "@mind-elixir/node-menu/dist/style.css";

const NEW_TOPIC_NAME = "";

const TPL = /*html*/`
<div class="note-detail-mind-map note-detail-printable">
    <div class="mind-map-container">
    </div>

    <style>
        .note-detail-mind-map {
            height: 100%;
            overflow: hidden !important;
        }

        .note-detail-mind-map .mind-map-container {
            height: 100%;
        }

        .map-container .node-menu {
            position: absolute;
            top: 60px;
            inset-inline-end: 20px;
            bottom: 80px;
            overflow: auto;
            background: var(--panel-bgcolor);
            color: var(--main-color);
            border-radius: 5px;
            box-shadow: 0 1px 2px #0003;
            width: 240px;
            box-sizing: border-box;
            padding: 0 15px 15px;
            transition: .3s all
        }

        .map-container .node-menu.close {
            height: 29px;
            width: 46px;
            overflow: hidden
        }

        .map-container .node-menu .button-container {
            padding: 3px 0;
            direction: rtl
        }

        .map-container .node-menu #nm-tag {
            margin-top: 20px
        }

        .map-container .node-menu .nm-fontsize-container {
            display: flex;
            justify-content: space-around;
            margin-bottom: 20px
        }

        .map-container .node-menu .nm-fontsize-container div {
            height: 36px;
            width: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 1px 2px #0003;
            background-color: #fff;
            color: tomato;
            border-radius: 100%
        }

        .map-container .node-menu .nm-fontcolor-container {
            margin-bottom: 10px
        }

        .map-container .node-menu input,
        .map-container .node-menu textarea {
            background: var(--input-background-color);
            border: 1px solid var(--panel-border-color);
            border-radius: var(--bs-border-radius);
            color: var(--main-color);
            padding: 5px;
            margin: 10px 0;
            width: 100%;
            box-sizing: border-box;
        }

        .map-container .node-menu textarea {
            resize: none
        }

        .map-container .node-menu .split6 {
            display: inline-block;
            width: 16.66%;
            margin-bottom: 5px
        }

        .map-container .node-menu .palette {
            border-radius: 100%;
            width: 21px;
            height: 21px;
            border: 1px solid #edf1f2;
            margin: auto
        }

        .map-container .node-menu .nmenu-selected,
        .map-container .node-menu .palette:hover {
            box-shadow: tomato 0 0 0 2px;
            background-color: #c7e9fa
        }

        .map-container .node-menu .size-selected {
            background-color: tomato !important;
            border-color: tomato;
            fill: #fff;
            color: #fff
        }

        .map-container .node-menu .size-selected svg {
            color: #fff
        }

        .map-container .node-menu .bof {
            text-align: center
        }

        .map-container .node-menu .bof span {
            display: inline-block;
            font-size: 14px;
            border-radius: 4px;
            padding: 2px 5px
        }

        .map-container .node-menu .bof .selected {
            background-color: tomato;
            color: #fff
        }
</style>
</div>
`;

interface MindmapModel {
    direction: number;
}

export default class MindMapWidget extends TypeWidget {

    private $content!: JQuery<HTMLElement>;
    private triggeredByUserOperation?: boolean;
    private mind?: MindElixirInstance;
    private MindElixir: any; // TODO: Fix type

    static getType() {
        return "mindMap";
    }

    doRender() {
        this.$widget = $(TPL);
        this.$content = this.$widget.find(".mind-map-container");
        this.$content.on("keydown", (e) => {
            /*
             * Some global shortcuts interfere with the default shortcuts of the mind map,
             * as defined here: https://mind-elixir.com/docs/guides/shortcuts
             */
            if (e.key === "F1") {
                e.stopPropagation();
            }

            // Zoom controls
            const isCtrl = e.ctrlKey && !e.altKey && !e.metaKey;
            if (isCtrl && (e.key == "-" || e.key == "=" || e.key == "0")) {
                e.stopPropagation();
            }
        });

        // Save the mind map if the user changes the layout direction.
        this.$content.on("click", ".mind-elixir-toolbar.lt", () => {
            this.spacedUpdate.scheduleUpdate();
        });

        super.doRender();
    }

    async doRefresh(note: FNote) {
        if (this.triggeredByUserOperation) {
            this.triggeredByUserOperation = false;
            return;
        }

        await this.#loadData(note);
    }

    cleanup() {
        this.triggeredByUserOperation = false;
    }

    async #loadData(note: FNote) {
        const blob = await note.getBlob();
        const content = blob?.getJsonContent<MindmapModel>();

        if (!this.mind) {
            await this.#initLibrary(content?.direction);
        }

        this.mind!.refresh(content ?? this.MindElixir.new(NEW_TOPIC_NAME));
        this.mind!.toCenter();
    }

    async #initLibrary(direction?: number) {
        this.MindElixir = (await import("mind-elixir")).default;

        const mind = new this.MindElixir({
            el: this.$content[0],
            direction: direction ?? this.MindElixir.LEFT
        });
        mind.install(nodeMenu);

        this.mind = mind;
        mind.init(this.MindElixir.new(NEW_TOPIC_NAME));
        // TODO: See why the typeof mindmap is not correct.
        mind.bus.addListener("operation", (operation: { name: string }) => {
            this.triggeredByUserOperation = true;
            if (operation.name !== "beginEdit") {
                this.spacedUpdate.scheduleUpdate();
            }
        });

        // If the note is displayed directly after a refresh, the scroll ends up at (0,0), making it difficult for the user to see.
        // Adding an arbitrary wait until the element is attached to the DOM seems to do the trick for now.
        setTimeout(() => {
            mind.toCenter();
        }, 200);
    }

    async getData() {
        const mind = this.mind;
        if (!mind) {
            return;
        }

        const svgContent = await this.renderSvg();
        return {
            content: mind.getDataString(),
            attachments: [
                {
                    role: "image",
                    title: "mindmap-export.svg",
                    mime: "image/svg+xml",
                    content: svgContent,
                    position: 0
                }
            ]
        };
    }

    async renderSvg() {
        return await this.mind!.exportSvg().text();
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.noteId && loadResults.isNoteReloaded(this.noteId)) {
            this.refresh();
        }
    }

    async exportSvgEvent({ ntxId }: EventData<"exportSvg">) {
        if (!this.isNoteContext(ntxId) || this.note?.type !== "mindMap") {
            return;
        }

        const svg = await this.renderSvg();
        utils.downloadSvg(this.note.title, svg);
    }

    async exportPngEvent({ ntxId }: EventData<"exportPng">) {
        if (!this.isNoteContext(ntxId) || this.note?.type !== "mindMap") {
            return;
        }

        const svg = await this.renderSvg();
        utils.downloadSvgAsPng(this.note.title, svg);
    }

    async executeWithContentElementEvent({ resolve, ntxId }: EventData<"executeWithContentElement">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        await this.initialized;

        resolve(this.$content.find('.main-node-container'));
    }
}

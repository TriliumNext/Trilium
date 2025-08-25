import { t } from "../services/i18n.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import attributeService from "../services/attributes.js";
import server from "../services/server.js";
import type FNote from "../entities/fnote.js";
import type { EventData } from "../components/app_context.js";
import type { Icon } from "./icon_list.js";
import { Dropdown } from "bootstrap";

const TPL = /*html*/`
<div class="note-icon-widget dropdown">
    <style>
    .note-icon-widget {
        padding-top: 3px;
        padding-left: 7px;
        margin-right: 0;
        width: 50px;
        height: 50px;
    }

    .note-icon-widget button.note-icon {
        font-size: 180%;
        background-color: transparent;
        border: 1px solid transparent;
        padding: 6px;
        cursor: pointer;
        color: var(--muted-text-color);
    }
        
    .note-icon-widget button.note-icon:disabled {
        cursor: default;
        opacity: .75;
    }

    .note-icon-widget button.note-icon:hover {
        border: 1px solid var(--main-border-color);
    }

    .note-icon-widget .dropdown-menu {
        border-radius: 10px;
        border-width: 2px;
        box-shadow: 10px 10px 93px -25px black;
        padding: 10px 15px 10px 15px !important;
    }

    .note-icon-widget .filter-row {
        padding-top: 10px;
        padding-bottom: 10px;
        padding-right: 20px;
        display: flex;
        align-items: baseline;
    }

    .note-icon-widget .filter-row span {
        display: block;
        padding-left: 15px;
        padding-right: 15px;
        font-weight: bold;
    }

    .note-icon-widget .icon-list {
        height: 500px;
        overflow: auto;
    }

    .note-icon-widget .icon-list span {
        display: inline-block;
        padding: 10px;
        cursor: pointer;
        border: 1px solid transparent;
        font-size: 180%;
    }

    .note-icon-widget .icon-list span:hover {
        border: 1px solid var(--main-border-color);
    }
    </style>

    <button class="btn dropdown-toggle note-icon" type="button" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false" title="${t("note_icon.change_note_icon")}"></button>
    <div class="dropdown-menu" aria-labelledby="note-path-list-button" style="width: 610px;">
        <div class="filter-row">
            <span>${t("note_icon.category")}</span> <select name="icon-category" class="form-select"></select>

            <span>${t("note_icon.search")}</span> <input type="text" name="icon-search" class="form-control" />
        </div>

        <div class="icon-list"></div>
    </div>
</div>`;

interface IconToCountCache {
    iconClassToCountMap: Record<string, number>;
}

export default class NoteIconWidget extends NoteContextAwareWidget {

    private dropdown!: bootstrap.Dropdown;
    private $icon!: JQuery<HTMLElement>;
    private $iconList!: JQuery<HTMLElement>;
    private $iconCategory!: JQuery<HTMLElement>;
    private $iconSearch!: JQuery<HTMLElement>;
    private iconToCountCache!: Promise<IconToCountCache | null> | null;

    doRender() {
        this.$widget = $(TPL);
        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0]);

        this.$icon = this.$widget.find("button.note-icon");
        this.$iconList = this.$widget.find(".icon-list");
        this.$iconList.on("click", "span", async (e) => {
            const clazz = $(e.target).attr("class");

            if (this.noteId && this.note) {
                await attributeService.setLabel(this.noteId, this.note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass", clazz);
            }
        });

        this.$iconCategory = this.$widget.find("select[name='icon-category']");
        this.$iconCategory.on("change", () => this.renderDropdown());
        this.$iconCategory.on("click", (e) => e.stopPropagation());

        this.$iconSearch = this.$widget.find("input[name='icon-search']");
        this.$iconSearch.on("input", () => this.renderDropdown());

        this.$widget.on("show.bs.dropdown", async () => {
            const { categories } = (await import("./icon_list.js")).default;

            this.$iconCategory.empty();

            for (const category of categories) {
                this.$iconCategory.append($("<option>").text(category.name).attr("value", category.id));
            }

            this.$iconSearch.val("");

            this.renderDropdown();
        });
    }

    async refreshWithNote(note: FNote) {
        this.$icon.removeClass().addClass(`${note.getIcon()} note-icon`);
        this.$icon.prop("disabled", !!(this.noteContext?.viewScope?.viewMode !== "default"));
        this.dropdown.hide();
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.noteId && loadResults.isNoteReloaded(this.noteId)) {
            this.refresh();
            return;
        }

        for (const attr of loadResults.getAttributeRows()) {
            if (attr.type === "label" && ["iconClass", "workspaceIconClass"].includes(attr.name ?? "") && attributeService.isAffecting(attr, this.note)) {
                this.refresh();
                break;
            }
        }
    }

    async renderDropdown() {
        const iconToCount = await this.getIconToCountMap();
        const { icons } = (await import("./icon_list.js")).default;

        this.$iconList.empty();

        if (this.getIconLabels().length > 0) {
            this.$iconList.append(
                $(`<div style="text-align: center">`).append(
                    $(`<button class="btn btn-sm">${t("note_icon.reset-default")}</button>`).on("click", () =>
                        this.getIconLabels().forEach((label) => {
                            if (this.noteId) {
                                attributeService.removeAttributeById(this.noteId, label.attributeId);
                            }
                        })
                    )
                )
            );
        }

        const categoryId = parseInt(String(this.$iconCategory.find("option:selected")?.val()));
        const search = String(this.$iconSearch.val())?.trim()?.toLowerCase();

        const filteredIcons = icons.filter((icon) => {
            if (categoryId && icon.category_id !== categoryId) {
                return false;
            }

            if (search) {
                if (!icon.name.includes(search) && !icon.term?.find((t) => t.includes(search))) {
                    return false;
                }
            }

            return true;
        });

        if (iconToCount) {
            filteredIcons.sort((a, b) => {
                const countA = iconToCount[a.className ?? ""] || 0;
                const countB = iconToCount[b.className ?? ""] || 0;

                return countB - countA;
            });
        }

        for (const icon of filteredIcons) {
            this.$iconList.append(this.renderIcon(icon));
        }

        this.$iconSearch.focus();
    }

    async getIconToCountMap() {
        if (!this.iconToCountCache) {
            this.iconToCountCache = server.get<IconToCountCache>("other/icon-usage");
            setTimeout(() => (this.iconToCountCache = null), 20000); // invalidate cache after 20 seconds
        }

        return (await this.iconToCountCache)?.iconClassToCountMap;
    }

    renderIcon(icon: Icon) {
        return $("<span>")
            .addClass("bx " + icon.className)
            .attr("title", icon.name);
    }

    getIconLabels() {
        if (!this.note) {
            return [];
        }
        return this.note.getOwnedLabels().filter((label) => ["workspaceIconClass", "iconClass"].includes(label.name));
    }
}

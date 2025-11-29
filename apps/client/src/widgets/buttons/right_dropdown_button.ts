import { handleRightToLeftPlacement } from "../../services/utils.js";
import BasicWidget from "../basic_widget.js";
import { Tooltip, Dropdown } from "bootstrap";
type PopoverPlacement = Tooltip.PopoverPlacement;

const TPL = /*html*/`
<div class="dropdown right-dropdown-widget">
    <button type="button" data-bs-toggle="dropdown"
            aria-haspopup="true" aria-expanded="false"
            class="bx right-dropdown-button launcher-button">
        <div class="tooltip-trigger"></div>
    </button>

    <div class="dropdown-menu"></div>
</div>
`;

export default class RightDropdownButtonWidget extends BasicWidget {
    protected iconClass: string;
    protected title: string;
    protected dropdownTpl: string;
    protected settings: { titlePlacement: PopoverPlacement };
    protected $dropdownMenu!: JQuery<HTMLElement>;
    protected dropdown!: Dropdown;
    protected $tooltip!: JQuery<HTMLElement>;
    protected tooltip!: Tooltip;
    private dropdownClass?: string;
    public $dropdownContent!: JQuery<HTMLElement>;

    constructor(title: string, iconClass: string, dropdownTpl: string, dropdownClass?: string) {
        super();

        this.iconClass = iconClass;
        this.title = title;
        this.dropdownTpl = dropdownTpl;
        this.dropdownClass = dropdownClass;

        this.settings = {
            titlePlacement: "right"
        };
    }

    doRender() {
        this.$widget = $(TPL);
        this.$dropdownMenu = this.$widget.find(".dropdown-menu");
        if (this.dropdownClass) {
            this.$dropdownMenu.addClass(this.dropdownClass);
        }
        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            popperConfig: {
                placement: this.settings.titlePlacement,
            }
        });

        this.$tooltip = this.$widget.find(".tooltip-trigger").attr("title", this.title);
        this.tooltip = new Tooltip(this.$tooltip[0], {
            placement: handleRightToLeftPlacement(this.settings.titlePlacement),
            fallbackPlacements: [ handleRightToLeftPlacement(this.settings.titlePlacement) ]
        });

        this.$widget
            .find(".right-dropdown-button")
            .addClass(this.iconClass)
            .on("click", () => this.tooltip.hide())
            .on("mouseenter", () => this.tooltip.show())
            .on("mouseleave", () => this.tooltip.hide());

        this.$widget.on("show.bs.dropdown", async () => {
            await this.dropdownShown();

            const rect = this.$dropdownMenu[0].getBoundingClientRect();
            const windowHeight = $(window).height() || 0;
            const pixelsToBottom = windowHeight - rect.bottom;

            if (pixelsToBottom < 0) {
                this.$dropdownMenu.css("top", pixelsToBottom);
            }
        });

        this.$dropdownContent = $(this.dropdownTpl);
        this.$widget.find(".dropdown-menu").append(this.$dropdownContent);
    }

    // to be overridden
    async dropdownShown(): Promise<void> {}
}

import { handleRightToLeftPlacement } from "../../services/utils.js";
import BasicWidget from "../basic_widget.js";
import { Tooltip, Dropdown } from "bootstrap";
type PopoverPlacement = Tooltip.PopoverPlacement;

const TPL = /*html*/`
<div class="dropdown right-dropdown-widget">
    <button type="button" data-bs-toggle="dropdown"
            aria-haspopup="true" aria-expanded="false"
            class="bx right-dropdown-button launcher-button"></button>

    <div class="tooltip-trigger"></div>

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
    public $dropdownContent!: JQuery<HTMLElement>;

    constructor(title: string, iconClass: string, dropdownTpl: string) {
        super();

        this.iconClass = iconClass;
        this.title = title;
        this.dropdownTpl = dropdownTpl;

        this.settings = {
            titlePlacement: "right"
        };
    }

    doRender() {
        this.$widget = $(TPL);
        this.$dropdownMenu = this.$widget.find(".dropdown-menu");
        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            popperConfig: {
                placement: this.settings.titlePlacement,
            }
        });

        this.$widget.attr("title", this.title);
        this.tooltip = Tooltip.getOrCreateInstance(this.$widget[0], {
            trigger: "hover",
            placement: handleRightToLeftPlacement(this.settings.titlePlacement),
            fallbackPlacements: [ handleRightToLeftPlacement(this.settings.titlePlacement) ]
        });

        this.$widget
            .find(".right-dropdown-button")
            .addClass(this.iconClass)
            .on("click", () => this.tooltip.hide());

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

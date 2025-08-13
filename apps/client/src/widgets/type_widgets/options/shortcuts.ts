import server from "../../../services/server.js";
import utils from "../../../services/utils.js";
import dialogService from "../../../services/dialog.js";
import OptionsWidget from "./options_widget.js";
import { t } from "../../../services/i18n.js";
import type { OptionNames, KeyboardShortcut, KeyboardShortcutWithRequiredActionName } from "@triliumnext/commons";

const TPL = /*html*/`
<div class="options-section shortcuts-options-section tn-no-card">
    <style>
        .shortcuts-options-section {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .shortcuts-table-container {
            overflow: auto;
            flex-grow: 1;
            flex-shrink: 1;
        }

        .shortcuts-options-buttons {
            display: flex;
            justify-content: space-between;
            margin: 15px 15px 0 15px;
        }
    </style>

    <h4>${t("shortcuts.keyboard_shortcuts")}</h4>

    <p class="form-text use-tn-links">
      ${t("shortcuts.multiple_shortcuts")}
      ${t("shortcuts.electron_documentation")}
    </p>

    <div class="form-group">
        <input type="text" class="keyboard-shortcut-filter form-control" placeholder="${t("shortcuts.type_text_to_filter")}">
    </div>

    <div class="shortcuts-table-container">
        <table class="keyboard-shortcut-table" cellpadding="10">
        <thead>
            <tr class="text-nowrap">
                <th>${t("shortcuts.action_name")}</th>
                <th>${t("shortcuts.shortcuts")}</th>
                <th>${t("shortcuts.default_shortcuts")}</th>
                <th>${t("shortcuts.description")}</th>
            </tr>
        </thead>
        <tbody></tbody>
        </table>
    </div>

    <div class="shortcuts-options-buttons">
        <button class="options-keyboard-shortcuts-reload-app btn btn-primary">${t("shortcuts.reload_app")}</button>

        <button class="options-keyboard-shortcuts-set-all-to-default btn btn-secondary">${t("shortcuts.set_all_to_default")}</button>
    </div>
</div>`;

let globActions: KeyboardShortcut[];

export default class KeyboardShortcutsOptions extends OptionsWidget {
    doRender() {
        this.$widget = $(TPL);

        this.$widget.find(".options-keyboard-shortcuts-reload-app").on("click", () => utils.reloadFrontendApp());

        const $table = this.$widget.find(".keyboard-shortcut-table tbody");

        server.get<KeyboardShortcut[]>("keyboard-actions").then((actions) => {
            globActions = actions;

            for (const action of actions) {
                const $tr = $("<tr>");

                if ("separator" in action) {
                    $tr.append($('<td class="separator" colspan="4">').attr("style", "background-color: var(--accented-background-color); font-weight: bold;").text(action.separator));
                } else if (action.defaultShortcuts && action.actionName) {
                    $tr.append($("<td>").text(action.friendlyName))
                        .append(
                            $("<td>").append(
                                $(`<input type="text" class="form-control">`)
                                    .val((action.effectiveShortcuts ?? []).join(", "))
                                    .attr("data-keyboard-action-name", action.actionName)
                                    .attr("data-default-keyboard-shortcuts", action.defaultShortcuts.join(", "))
                            )
                        )
                        .append($("<td>").text(action.defaultShortcuts.join(", ")))
                        .append($("<td>").text(action.description ?? ""));
                }

                $table.append($tr);
            }
        });

        $table.on("change", "input.form-control", (e) => {
            const $input = this.$widget.find(e.target);
            const actionName = $input.attr("data-keyboard-action-name");
            if (!actionName) {
                return;
            }

            const shortcuts = ($input.val() as String)
                .replace("+,", "+Comma")
                .split(",")
                .map((shortcut) => shortcut.replace("+Comma", "+,"))
                .filter((shortcut) => !!shortcut);

            const optionName = `keyboardShortcuts${actionName.substr(0, 1).toUpperCase()}${actionName.substr(1)}`;

            this.updateOption(optionName as OptionNames, JSON.stringify(shortcuts));
        });

        this.$widget.find(".options-keyboard-shortcuts-set-all-to-default").on("click", async () => {
            if (!(await dialogService.confirm(t("shortcuts.confirm_reset")))) {
                return;
            }

            $table.find("input.form-control").each((_index, el) => {
                const defaultShortcuts = this.$widget.find(el).attr("data-default-keyboard-shortcuts");

                if (defaultShortcuts && this.$widget.find(el).val() !== defaultShortcuts) {
                    this.$widget.find(el).val(defaultShortcuts).trigger("change");
                }
            });
        });

        const $filter = this.$widget.find(".keyboard-shortcut-filter");

        $filter.on("keyup", () => {
            const filter = String($filter.val()).trim().toLowerCase();

            $table.find("tr").each((i, el) => {
                if (!filter) {
                    this.$widget.find(el).show();
                    return;
                }

                const actionName = this.$widget.find(el).find("input").attr("data-keyboard-action-name");

                if (!actionName) {
                    this.$widget.find(el).hide();
                    return;
                }

                const action = globActions.find((act) => "actionName" in act && act.actionName === actionName) as KeyboardShortcutWithRequiredActionName;

                if (!action) {
                    this.$widget.find(el).hide();
                    return;
                }

                this.$widget
                    .find(el)
                    .toggle(
                        !!(
                            action.actionName.toLowerCase().includes(filter) ||
                            (action.friendlyName && action.friendlyName.toLowerCase().includes(filter)) ||
                            (action.defaultShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
                            (action.effectiveShortcuts ?? []).some((shortcut) => shortcut.toLowerCase().includes(filter)) ||
                            (action.description && action.description.toLowerCase().includes(filter))
                        )
                    );
            });
        });
    }
}

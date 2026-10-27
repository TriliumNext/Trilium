import "./ListExpandControls.css";

import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import Dropdown from "../../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../../react/FormList";
import { useNoteLabel } from "../../react/hooks";

const MAX_DEPTH = 5;

export default function ListExpandControls({ note }: { note: FNote }) {
    const [ expanded ] = useNoteLabel(note, "expanded");

    async function collapseAll() {
        // Removing only owned labels keeps an `expanded` inherited from a parent in force.
        for (const attribute of note.getOwnedLabels("expanded")) {
            await attributes.removeAttributeById(note.noteId, attribute.attributeId);
        }
    }

    async function expandTo(depth: number | "all") {
        // Depth 1 is the label's empty value; an absent label and 0 both mean fully collapsed.
        const value = depth === 1 ? "" : String(depth);
        if (value === note.getLabelValue("expanded")) return;
        await attributes.setLabel(note.noteId, "expanded", value);
    }

    return (
        <div className="list-expand-controls">
            <ActionButton
                icon="bx bx-layer-minus"
                text={t("book_properties.collapse_all_notes")}
                onClick={() => void collapseAll()}
            />
            <div className="list-expand-split">
                <ActionButton
                    icon="bx bx-move-vertical"
                    text={t("book_properties.expand_tooltip")}
                    onClick={() => void expandTo(1)}
                />
                <Dropdown
                    buttonClassName="bx bx-chevron-down"
                    buttonProps={{ "aria-label": t("split_button.more_actions") }}
                    iconAction
                    hideToggleArrow
                    noSelectButtonStyle
                    title={t("split_button.more_actions")}
                    placement="bottom-end"
                    mobileBottomSheet
                >
                    <FormListItem
                        onClick={() => void expandTo(1)}
                        checked={expanded === ""}
                        checkable
                    >{t("book_properties.expand_first_level")}</FormListItem>
                    <FormDropdownDivider />
                    {Array.from({ length: MAX_DEPTH - 1 }, (_, index) => index + 2).map((depth) => (
                        <FormListItem
                            key={depth}
                            onClick={() => void expandTo(depth)}
                            checked={expanded === String(depth)}
                            checkable
                        >{t("book_properties.expand_nth_level", { depth })}</FormListItem>
                    ))}
                    <FormDropdownDivider />
                    <FormListItem
                        onClick={() => void expandTo("all")}
                        checked={expanded === "all"}
                        checkable
                    >{t("book_properties.expand_all_levels")}</FormListItem>
                </Dropdown>
            </div>
        </div>
    );
}

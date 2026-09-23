import { useMemo, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { type NoteTypeOption } from "../../../services/note_types";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import Icon from "../../react/Icon";

/**
 * What a new card will be made from, standing inside the editor it is named in.
 *
 * The pill is a dropdown of what the board offers, and a way to the dialog that decides what that
 * is. It reports a pick rather than storing one: the board writes what it last used, so that the
 * editor opens on it again.
 */
export default function CardTemplatePill({ offered, current, onSelect, onMore, onOpened, onClosed }: {
    offered: NoteTypeOption[];
    /** The one a card would be made from now, absent while the board is still reading them. */
    current?: NoteTypeOption;
    onSelect: (template: NoteTypeOption) => void;
    /** Opens the dialog that decides which templates the board offers. */
    onMore: () => void;
    /**
     * Said as the dropdown opens and closes. The editor closes on losing focus, and the menu takes
     * focus with it, so it has to be held open for as long as the reader is in it.
     */
    onOpened?: () => void;
    onClosed?: () => void;
}) {
    const [ isShown, setIsShown ] = useState(false);

    // Rebuilt only as the list changes, since a dropdown is torn down and put back up with it.
    const items = useMemo(() => offered.map((template) => (
        <FormListItem
            key={template.id}
            icon={template.icon}
            onClick={() => onSelect(template)}
        >
            {template.title}
            {/* Ticked rather than highlighted: a highlighted row reads as the one under the
                pointer. The icon each template carries stays where it is. */}
            {template.id === current?.id && (
                <Icon className="card-template-current" icon="bx bx-check" />
            )}
        </FormListItem>
    )), [ offered, current, onSelect ]);

    // The name alone stands in the pill: the field already carries the icon the card itself will
    // wear, and a second icon beside it reads as a second thing to pick.
    return (
        <Dropdown
            className="card-template-pill"
            buttonClassName="card-template-pill-button"
            text={<span className="card-template-name">{current?.title ?? ""}</span>}
            title={t("board_view.card-template")}
            noSelectButtonStyle
            noDropdownListStyle
            portalToBody
            onShown={() => {
                setIsShown(true);
                onOpened?.();
            }}
            onHidden={() => {
                setIsShown(false);
                onClosed?.();
            }}
        >
            {isShown && <>
                {items}
                <li><hr className="dropdown-divider" /></li>
                <FormListItem icon="bx bx-list-ul" onClick={onMore}>
                    {t("board_view.more-templates")}
                </FormListItem>
            </>}
        </Dropdown>
    );
}

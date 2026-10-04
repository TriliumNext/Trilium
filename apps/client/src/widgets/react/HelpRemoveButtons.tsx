import type { ComponentChildren } from "preact";
import ActionButton from "./ActionButton";
import { DropdownPanel } from "./Dropdown";

interface HelpRemoveButtonsProps {
    help?: ComponentChildren;
    removeText?: string;
    onRemove?: () => void;
}

export default function HelpRemoveButtons({ help, removeText, onRemove }: HelpRemoveButtonsProps) {
    return (
        <td className="button-column">
            {help && <>
                <DropdownPanel
                    className="help-dropdown"
                    buttonClassName="bx bx-help-circle icon-action"
                    hideToggleArrow
                >{help}</DropdownPanel>
                {" "}
            </>}
            <ActionButton
                icon="bx bx-x"
                className="search-option-del"
                text={removeText ?? ""}
                onClick={(e) => {
                    e.preventDefault();
                    onRemove?.();
                }}
            />
        </td>
    );
}

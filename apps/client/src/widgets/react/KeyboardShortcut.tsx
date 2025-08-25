import { ActionKeyboardShortcut, KeyboardActionNames } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";
import keyboard_actions from "../../services/keyboard_actions";
import { joinElements } from "./react_utils";

interface KeyboardShortcutProps {
    actionName: KeyboardActionNames;
}

export default function KeyboardShortcut({ actionName }: KeyboardShortcutProps) {

    const [ action, setAction ] = useState<ActionKeyboardShortcut>();
    useEffect(() => {
        keyboard_actions.getAction(actionName).then(setAction);
    }, []);

    if (!action) {
        return <></>;
    }

    return (
        <>
            {action.effectiveShortcuts?.map((shortcut) => {
                const keys = shortcut.split("+");
                return joinElements(keys
                    .map((key, i) => (
                        <>
                            <kbd>{key}</kbd> {i + 1 < keys.length && "+ "}
                        </>
                    )))
            })}
        </>
    );
}
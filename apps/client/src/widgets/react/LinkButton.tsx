import { ComponentChild } from "preact";
import { CommandNames } from "../../components/app_context";

interface LinkButtonProps {
    onClick?: () => void;
    text: ComponentChild;
    triggerCommand?: CommandNames;
}

export default function LinkButton({ onClick, text, triggerCommand }: LinkButtonProps) {
    return (
        <a class="tn-link" href="#"
           data-trigger-command={triggerCommand}
           role="button"
           onKeyDown={(e)=> {
                if (e.code === "Space") {
                    onClick?.();
                }
           }}
           onClick={(e) => {
                e.preventDefault();
                onClick?.();
           }}>
            {text}
        </a>
    )
}
import { ComponentChild } from "preact";

interface LinkButtonProps {
    onClick: () => void;
    text: ComponentChild;
}

export default function LinkButton({ onClick, text }: LinkButtonProps) {
    return (
        <a class="tn-link" href="javascript:" onClick={(e) => {
            e.preventDefault();
            onClick();
        }}>
            {text}
        </a>
    )
}
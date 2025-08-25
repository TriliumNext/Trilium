import { CommandNames } from "../../components/app_context";

interface ActionButtonProps {
    text: string;
    titlePosition?: "bottom"; // TODO: Use it
    icon: string;
    className?: string;
    onClick?: (e: MouseEvent) => void;
    triggerCommand?: CommandNames;
}

export default function ActionButton({ text, icon, className, onClick, triggerCommand }: ActionButtonProps) {
    return <button
        class={`icon-action ${icon} ${className ?? ""}`}
        title={text}
        onClick={onClick}        
        data-trigger-command={triggerCommand}
    />;
}
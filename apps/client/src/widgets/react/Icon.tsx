interface IconProps {
    icon?: string;
    className?: string;
}

export default function Icon({ icon, className }: IconProps) {
    return <span class={`${icon ?? "bx bx-empty"} ${className ?? ""}`}></span>
}
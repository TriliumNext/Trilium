interface IconProps {
    svg: string;
    className?: string;
}

export default function Icon({ svg, className }: IconProps) {
    return (
        <span className={`bx ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: svg }} />
    )
}

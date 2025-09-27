interface IconProps {
    svg: string;
}

export default function Icon({ svg }: IconProps) {
    return (
        <span className="bx" dangerouslySetInnerHTML={{ __html: svg }} />
    )
}

import clsx from "clsx";
import { HTMLAttributes } from "preact";

interface IconProps extends Pick<HTMLAttributes<HTMLSpanElement>, "className" | "onClick"> {
    icon?: string;
    className?: string;
}

export default function Icon({ icon, className, ...restProps }: IconProps) {
    return (
        <span
            class={clsx(icon ?? "bx bx-empty", className, "tn-icon")}
            {...restProps}
        />
    );
}

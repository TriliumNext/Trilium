import { ComponentChildren } from "preact";

import { isMobile } from "../../services/utils";

interface ResponsiveContainerProps {
    mobile?: ComponentChildren;
    desktop?: ComponentChildren;
}

export default function ResponsiveContainer({ mobile, desktop }: ResponsiveContainerProps) {
    return (isMobile() ? mobile : desktop);
}

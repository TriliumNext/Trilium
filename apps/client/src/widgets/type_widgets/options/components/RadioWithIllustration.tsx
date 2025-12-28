import "./RadioWithIllustration.css";

import clsx from "clsx";
import { ComponentChild } from "preact";

interface RadioWithIllustrationProps {
    values: {
        key: string;
        text: string;
        illustration: ComponentChild;
    }[];
    currentValue: string;
    onChange(newValue: string): void;
}

export default function RadioWithIllustration({ currentValue, onChange, values }: RadioWithIllustrationProps) {
    return (
        <ul className="radio-with-illustration">
            {values.map(value => (
                <li
                    key={value.key}
                    className={clsx(value.key === currentValue && "selected")}
                >
                    <figure>
                        <div
                            className="illustration"
                            role="button"
                            onClick={() => onChange(value.key)}
                        >
                            {value.illustration}
                        </div>
                        <figcaption>{value.text}</figcaption>
                    </figure>
                </li>
            ))}
        </ul>
    );
}

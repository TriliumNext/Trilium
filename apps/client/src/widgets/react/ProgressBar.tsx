import "./ProgressBar.css";

import clsx from "clsx";

interface ProgressBarProps {
    value: number;
    max: number;
    className?: string;
}

/**
 * A thin bar showing how far a task has come. Use it instead of a `<progress>`, which each browser
 * draws in a style of its own.
 */
export default function ProgressBar({ value, max, className }: ProgressBarProps) {
    const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

    return (
        <div
            className={clsx("tn-progress-bar", className)}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
            style={{ "--tn-progress": `${fraction * 100}%` }}
        />
    );
}

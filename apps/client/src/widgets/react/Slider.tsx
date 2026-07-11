interface SliderProps {
    value: number;
    onChange(newValue: number);
    min?: number;
    max?: number;
    step?: number;
    title?: string;
}

export default function Slider({ onChange, value, min = 0, max = 100, ...restProps }: SliderProps) {
    // Percentage of the track that is filled, used by the theme to paint the
    // filled portion on WebKit/Blink (which lacks a native progress element).
    const range = max - min;
    const fillPercent = range > 0 ? Math.max(0, Math.min(100, ((value - min) / range) * 100)) : 0;

    return (
        <input
            type="range"
            className="slider"
            value={value}
            min={min}
            max={max}
            style={{ "--slider-fill-percent": `${fillPercent}%` }}
            onChange={(e) => {
                onChange(e.currentTarget.valueAsNumber);
            }}
            {...restProps}
        />
    );
}

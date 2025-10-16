interface SliderProps {
    value: number;
    onChange(newValue: number);
    min?: number;
    max?: number;
    title?: string;
}

export default function Slider({ onChange, ...restProps }: SliderProps) {
    return (
        <input
            type="range"
            className="slider"
            onChange={(e) => {
                onChange(e.currentTarget.valueAsNumber);
            }}
            {...restProps}
        />
    );
}

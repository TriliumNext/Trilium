import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { ParentComponent } from "./react_utils";
import { ComponentChildren, createContext } from "preact";
import { TouchBarItem } from "../../components/touch_bar";
import { dynamicRequire, isElectron, isMac } from "../../services/utils";

interface TouchBarProps {
    children: ComponentChildren;
}

interface LabelProps {
    label: string;
}

interface SliderProps {
    label: string;
    value: number;
    minValue: number;
    maxValue: number;
    onChange: (newValue: number) => void;
}

interface ButtonProps {
    label?: string;
    icon?: string;
    click: () => void;
    enabled?: boolean;
    backgroundColor?: string;
}

interface SpacerProps {
    size: "flexible" | "large" | "small";
}

interface SegmentedControlProps {
    mode: "single" | "buttons";
    segments: {
        label?: string;
        icon?: string;
        onClick?: () => void;
    }[];
    selectedIndex?: number;
    onChange?: (selectedIndex: number, isSelected: boolean) => void;
}

interface TouchBarContextApi {
    addItem(item: TouchBarItem): void;
    TouchBar: typeof Electron.TouchBar;
    nativeImage: typeof Electron.nativeImage;
}

const TouchBarContext = createContext<TouchBarContextApi | null>(null);

export default function TouchBar({ children }: TouchBarProps) {
    if (!isElectron() || !isMac()) {
        return;
    }

    const [ isFocused, setIsFocused ] = useState(false);
    const parentComponent = useContext(ParentComponent);
    const remote = dynamicRequire("@electron/remote") as typeof import("@electron/remote");
    const items: TouchBarItem[] = [];

    const api: TouchBarContextApi = {
        TouchBar: remote.TouchBar,
        nativeImage: remote.nativeImage,
        addItem: (item) => {
            items.push(item);
        }
    };

    useEffect(() => {
        const el = parentComponent?.$widget[0];
        if (!el) return;

        function onFocusGained() {
            setIsFocused(true);
        }

        function onFocusLost() {
            setIsFocused(false);
        }

        el.addEventListener("focusin", onFocusGained);
        el.addEventListener("focusout", onFocusLost);
        return () => {
            el.removeEventListener("focusin", onFocusGained);
            el.removeEventListener("focusout", onFocusLost);
        }
    }, []);

    useEffect(() => {
        if (isFocused) {
            remote.getCurrentWindow().setTouchBar(new remote.TouchBar({ items }));
        }
    });

    return (
        <TouchBarContext.Provider value={api}>
            {children}
        </TouchBarContext.Provider>
    );
}

export function TouchBarLabel({ label }: LabelProps) {
    const api = useContext(TouchBarContext);

    if (api) {
        const item = new api.TouchBar.TouchBarLabel({
            label
        });
        api.addItem(item);
    }

    return <></>;
}

export function TouchBarSlider({ label, value, minValue, maxValue, onChange }: SliderProps) {
    const api = useContext(TouchBarContext);

    if (api) {
        const item = new api.TouchBar.TouchBarSlider({
            label,
            value, minValue, maxValue,
            change: onChange
        });
        api.addItem(item);
    }

    return <></>;
}

export function TouchBarButton({ label, icon, click, enabled, backgroundColor }: ButtonProps) {
    const api = useContext(TouchBarContext);
    const item = useMemo(() => {
        if (!api) return null;
        return new api.TouchBar.TouchBarButton({
            label, click, enabled,
            icon: icon ? buildIcon(api.nativeImage, icon) : undefined,
            backgroundColor
        });
    }, [ label, icon ]);

    if (item && api) {
        api.addItem(item);
    }

    return <></>;
}

export function TouchBarSegmentedControl({ mode, segments, selectedIndex, onChange }: SegmentedControlProps) {
    const api = useContext(TouchBarContext);

    if (api) {
        const processedSegments: Electron.SegmentedControlSegment[] = segments.map(({icon, ...restProps}) => ({
            ...restProps,
            icon: icon ? buildIcon(api.nativeImage, icon) : undefined
        }));
        const item = new api.TouchBar.TouchBarSegmentedControl({
            mode, selectedIndex,
            segments: processedSegments,
            change: (selectedIndex, isSelected) => {
                if (segments[selectedIndex].onClick) {
                    segments[selectedIndex].onClick();
                } else if (onChange) {
                    onChange(selectedIndex, isSelected);
                }
            }
        });
        api.addItem(item);
    }

    return <></>;
}

export function TouchBarGroup({ children }: { children: ComponentChildren }) {
    const remote = dynamicRequire("@electron/remote") as typeof import("@electron/remote");
    const items: TouchBarItem[] = [];

    const api: TouchBarContextApi = {
        TouchBar: remote.TouchBar,
        nativeImage: remote.nativeImage,
        addItem: (item) => {
            items.push(item);
        }
    };

    if (api) {
        const item = new api.TouchBar.TouchBarGroup({
            items: new api.TouchBar({ items })
        });
        api.addItem(item);
    }

    return <>
        <TouchBarContext.Provider value={api}>
            {children}
        </TouchBarContext.Provider>
    </>;
}

export function TouchBarSpacer({ size }: SpacerProps) {
    const api = useContext(TouchBarContext);

    if (api) {
        const item = new api.TouchBar.TouchBarSpacer({
            size
        });
        api.addItem(item);
    }

    return <></>;
}

function buildIcon(nativeImage: typeof Electron.nativeImage, name: string) {
    const sourceImage = nativeImage.createFromNamedImage(name, [-1, 0, 1]);
    const { width, height } = sourceImage.getSize();
    const newImage = nativeImage.createEmpty();
    newImage.addRepresentation({
        scaleFactor: 1,
        width: width / 2,
        height: height / 2,
        buffer: sourceImage.resize({ height: height / 2 }).toBitmap()
    });
    newImage.addRepresentation({
        scaleFactor: 2,
        width: width,
        height: height,
        buffer: sourceImage.toBitmap()
    });
    return newImage;
}

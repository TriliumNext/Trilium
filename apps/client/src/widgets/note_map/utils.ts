export type NoteMapWidgetMode = "ribbon" | "hoisted" | "type";
export type MapType = "tree" | "link";

export function rgb2hex(rgb: string) {
    return `#${(rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/) || [])
        .slice(1)
        .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
        .join("")}`;
}

export function generateColorFromString(str: string, themeStyle: "light" | "dark") {
    if (themeStyle === "dark") {
        str = `0${str}`; // magic lightning modifier
    }

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    let color = "#";
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xff;

        color += `00${value.toString(16)}`.substr(-2);
    }
    return color;
}

export function getThemeStyle() {
    const documentStyle = window.getComputedStyle(document.documentElement);
    return documentStyle.getPropertyValue("--theme-style")?.trim() as "light" | "dark";
}

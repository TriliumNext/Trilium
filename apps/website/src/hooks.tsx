import { useEffect, useState } from "preact/hooks";

export function usePageTitle(title: string) {
    useEffect(() => {
        if (title.length) {
            document.title = `${title} - Trilium Notes`;
        } else {
            document.title = "Trilium Notes";
        }
    }, [ title ]);
}

export function useColorScheme() {
    const defaultValue = (typeof window !== "undefined" && (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
    const [ prefersDark, setPrefersDark ] = useState(defaultValue);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
        const listener = () => setPrefersDark((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));

        mediaQueryList.addEventListener("change", listener);
        return () => mediaQueryList.removeEventListener("change", listener);
    }, []);

    return prefersDark ? "dark" : "light";
}

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
    if (typeof window === "undefined") return;

    const [ prefersDark, setPrefersDark ] = useState((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));

    useEffect(() => {
        const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
        const listener = () => setPrefersDark((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));

        mediaQueryList.addEventListener("change", listener);
        return () => mediaQueryList.removeEventListener("change", listener);
    }, []);

    return prefersDark ? "dark" : "light";
}

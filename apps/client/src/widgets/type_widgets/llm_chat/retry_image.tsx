import { type ImgHTMLAttributes } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/**
 * `<SafeImage>` — retries a failed image load up to three times with exponential
 * backoff and a cache-busting query parameter.
 *
 * Why this exists: when the user uploads an image to a chat note, the server's
 * upload endpoint returns the attachment URL *before* the async image-
 * processing pipeline has written the actual bytes (see `saveImageToAttachment`
 * in `packages/trilium-core/src/services/image.ts`). The first `<img>` fetch
 * 404s for a few hundred milliseconds, the browser caches that 404, and the
 * preview stays broken even after the image becomes available. Re-requesting
 * with a fresh query string sidesteps the cached 404.
 *
 * Why a component (not an onError handler that pokes at `img.src`): chat
 * re-renders frequently during streaming. If the handler mutates the DOM
 * directly, Preact's next diff sees the live `src` (with `?_retry=N`) differs
 * from the VDOM `src` (the original URL) and reverts it, aborting the retry.
 * Owning the URL in component state keeps the VDOM and DOM in agreement.
 */
type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
    src: string;
};

export function SafeImage({ src, ...rest }: SafeImageProps) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const retriesRef = useRef(0);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        retriesRef.current = 0;
        setCurrentSrc(src);
        return () => {
            if (timeoutRef.current !== null) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [src]);

    const handleError = useCallback(() => {
        if (retriesRef.current >= 3) return;
        const next = retriesRef.current + 1;
        retriesRef.current = next;
        const separator = src.includes("?") ? "&" : "?";
        timeoutRef.current = setTimeout(() => {
            timeoutRef.current = null;
            setCurrentSrc(`${src}${separator}_retry=${next}`);
        }, 300 * next);
    }, [src]);

    return <img {...rest} src={currentSrc} onError={handleError} />;
}

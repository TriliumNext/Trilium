// Ensure sharePath always starts with a single slash and does not end with (one or multiple) trailing slashes
export function normalizeSharePathInput(sharePathInput: string) {
    const REGEXP_STARTING_SLASH = /^\/+/g;
    const REGEXP_TRAILING_SLASH = /\b\/+$/g;

    const normalizedSharePath = (!sharePathInput.startsWith("/")
        ? `/${sharePathInput}`
        : sharePathInput)
        .replaceAll(REGEXP_TRAILING_SLASH, "")
        .replaceAll(REGEXP_STARTING_SLASH, "/");

    return normalizedSharePath;
}

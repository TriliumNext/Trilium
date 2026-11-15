/**
 * Fetches the translation catalogues. `index.ts` starts the requests as soon as `/bootstrap` names
 * the language, so the download overlaps the loading of the entry, and `i18n.ts` takes them over
 * once i18next initializes.
 *
 * Kept free of imports, as `index.ts` loads it before `setupGlob()`.
 */

export type CatalogueScope = "app" | "entry";

type Catalogue = Record<string, unknown>;

/**
 * The catalogues each page reads: the app reads both, since shared widgets such as the credentials
 * form use keys of the entry catalogue; the setup, login and password pages read only `entry`.
 */
const NAMESPACES: Record<CatalogueScope, string[]> = {
    app: [ "translation", "entry" ],
    entry: [ "entry" ]
};

const pendingRequests = new Map<string, Promise<Catalogue>>();

export function getNamespaces(scope: CatalogueScope) {
    return NAMESPACES[scope];
}

/** Starts fetching the catalogues `scope` reads in `locale`, for {@link takeCatalogue} to collect. */
export function requestCatalogues(locale: string, scope: CatalogueScope) {
    for (const ns of NAMESPACES[scope]) {
        const request = fetchCatalogue(locale, ns);
        // A failure is reported to whoever takes the request, not as an unhandled rejection.
        request.catch(() => {});
        pendingRequests.set(`${locale}/${ns}`, request);
    }
}

/** Returns the catalogue requested earlier, or fetches it now. */
export function takeCatalogue(lng: string, ns: string): Promise<Catalogue> {
    const key = `${lng}/${ns}`;
    const request = pendingRequests.get(key) ?? fetchCatalogue(lng, ns);
    pendingRequests.delete(key);
    return request;
}

/** The locales that read another locale's catalogues, as they have no folder of their own. */
const CATALOGUE_LOCALES: Record<string, string> = {
    en_rtl: "en"
};

async function fetchCatalogue(lng: string, ns: string): Promise<Catalogue> {
    const url = `${window.glob.assetPath}/translations/${CATALOGUE_LOCALES[lng] ?? lng}/${ns}.json`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status} ${response.statusText}`.trim());
    }
    return await response.json();
}

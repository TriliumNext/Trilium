import './style.css';

import { changeLanguage } from 'i18next';
import { createContext } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { hydrate, LocationProvider, prerender as ssr, Route, Router, useLocation } from 'preact-iso';

import Footer from './components/Footer.js';
import { Header } from './components/Header.jsx';
import { FALLBACK_STARGAZERS_COUNT, getRepoStargazersCount } from './github-utils';
import { extractLocaleFromUrl, initTranslations, LOCALES, mapLocale } from './i18n';
import { NotFound } from './pages/_404.jsx';
import GetStarted from './pages/GetStarted/get-started.js';
import { Home } from './pages/Home/index.jsx';
import Resources from './pages/Resources/Resources';
import SupportUs from './pages/SupportUs/SupportUs.js';

export const LocaleContext = createContext('en');

export function App({ repoStargazersCount }) {
    return (
        <LocationProvider>
            <LocaleProvider>
                <Header repoStargazersCount={repoStargazersCount ?? FALLBACK_STARGAZERS_COUNT} />
                <main>
                    <Router>
                        <Route path="/" component={Home} />
                        <Route path="/get-started" component={GetStarted} />
                        <Route path="/support-us" component={SupportUs} />
                        <Route path="/resources" component={Resources} />

                        <Route path="/:locale:/" component={Home} />
                        <Route path="/:locale:/get-started" component={GetStarted} />
                        <Route path="/:locale:/support-us" component={SupportUs} />
                        <Route path="/:locale:/resources" component={Resources} />

                        <Route default component={NotFound} />
                    </Router>
                </main>
                <Footer />
            </LocaleProvider>
        </LocationProvider>
    );
}

export function LocaleProvider({ children }) {
    const { path } = useLocation();
    const localeId = getLocaleId(path);
    const loadedRef = useRef(false);

    if (!loadedRef.current) {
        initTranslations(localeId);
        loadedRef.current = true;
    } else {
        changeLanguage(localeId);
    }

    // Update html lang and dir attributes
    useLayoutEffect(() => {
        const correspondingLocale = LOCALES.find(l => l.id === localeId);
        document.documentElement.lang = localeId;
        document.documentElement.dir = correspondingLocale?.rtl ? "rtl" : "ltr";
    }, [localeId]);

    return (
        <LocaleContext.Provider value={localeId}>
            {children}
        </LocaleContext.Provider>
    );
}

if (typeof window !== 'undefined') {
    const el = document.getElementById("prerender-data");
    const data = JSON.parse(el?.innerText ?? "{}");
    hydrate(<App {...data} />, document.getElementById('app')!);
}

function getLocaleId(path: string) {
    const extractedLocale = extractLocaleFromUrl(path);
    if (extractedLocale) return mapLocale(extractedLocale);
    if (typeof window === "undefined") return 'en';
    return mapLocale(navigator.language);
}

export async function prerender(data) {
    // Fetch the stargazer count of the Trilium's GitHub repo on prerender to pass
    // it to the App component for SSR.
    // This ensures the GitHub API is not called on every page load in the client.
    data.repoStargazersCount = await getRepoStargazersCount();
    const { html, links } = await ssr(<App {...data} />);
    return {
        html,
        links,
        data,
        head: {
            lang: extractLocaleFromUrl(data.url) ?? "en"
        }
    };
}


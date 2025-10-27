import './style.css';
import { FALLBACK_STARGAZERS_COUNT, getRepoStargazersCount } from './github-utils.js';
import { Header } from './components/Header.jsx';
import { Home } from './pages/Home/index.jsx';
import { LocationProvider, Router, Route, hydrate, prerender as ssr, useLocation } from 'preact-iso';
import { NotFound } from './pages/_404.jsx';
import Footer from './components/Footer.js';
import GetStarted from './pages/GetStarted/get-started.js';
import SupportUs from './pages/SupportUs/SupportUs.js';
import { createContext } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { default as i18next, changeLanguage } from 'i18next';
import { extractLocaleFromUrl, initTranslations, LOCALES, mapLocale } from './i18n';
import HttpApi from 'i18next-http-backend';
import { initReactI18next } from "react-i18next";

export const LocaleContext = createContext('en');

export function App(props: {repoStargazersCount: number}) {
	return (
		<LocationProvider>
            <LocaleProvider>
                <Header repoStargazersCount={props.repoStargazersCount} />
                <main>
                    <Router>
                        <Route path="/" component={Home} />
                        <Route path="/get-started" component={GetStarted} />
                        <Route path="/support-us" component={SupportUs} />

                        <Route path="/:locale:/" component={Home} />
                        <Route path="/:locale:/get-started" component={GetStarted} />
                        <Route path="/:locale:/support-us" component={SupportUs} />

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
  const localeId = mapLocale(extractLocaleFromUrl(path) || navigator.language);
  const loadedRef = useRef(false);

  if (!loadedRef.current) {
    initTranslations(localeId);
    loadedRef.current = true;
  } else {
    changeLanguage(localeId);
  }

  return (
    <LocaleContext.Provider value={localeId}>
      {children}
    </LocaleContext.Provider>
  );
}

if (typeof window !== 'undefined') {
	hydrate(<App repoStargazersCount={FALLBACK_STARGAZERS_COUNT} />, document.getElementById('app')!);
}

export async function prerender(data) {
	// Fetch the stargazer count of the Trilium's GitHub repo on prerender to pass
	// it to the App component for SSR.
	// This ensures the GitHub API is not called on every page load in the client.
	const stargazersCount = await getRepoStargazersCount();

	const { html, links } = await ssr(<App repoStargazersCount={stargazersCount} {...data} />);
    const lang = extractLocaleFromUrl(data.url);
    return {
        html,
        links,
        head: {
            lang
        }
    }
}


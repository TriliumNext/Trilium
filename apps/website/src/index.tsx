import './style.css';
import { FALLBACK_STARGAZERS_COUNT, getRepoStargazersCount } from './github-utils.js';
import { Header } from './components/Header.jsx';
import { Home } from './pages/Home/index.jsx';
import { LocationProvider, Router, Route, hydrate, prerender as ssr } from 'preact-iso';
import { NotFound } from './pages/_404.jsx';
import Footer from './components/Footer.js';
import GetStarted from './pages/GetStarted/get-started.js';
import SupportUs from './pages/SupportUs/SupportUs.js';

export function App(props: {repoStargazersCount: number}) {
	return (
		<LocationProvider>
			<Header repoStargazersCount={props.repoStargazersCount} />
			<main>
				<Router>
					<Route path="/" component={Home} />
					<Route default component={NotFound} />
                    <Route path="/get-started" component={GetStarted} />
                    <Route path="/support-us" component={SupportUs} />
				</Router>
			</main>
            <Footer />
		</LocationProvider>
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

	return await ssr(<App repoStargazersCount={stargazersCount} {...data} />);
}


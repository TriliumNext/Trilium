import { LocationProvider, Router, Route, hydrate, prerender as ssr } from 'preact-iso';

import { Header } from './components/Header.jsx';
import { Home } from './pages/Home/index.jsx';
import { NotFound } from './pages/_404.jsx';
import './style.css';
import Footer from './components/Footer.js';
import GetStarted from './pages/GetStarted/get-started.js';
import SupportUs from './pages/SupportUs/SupportUs.js';

export function App() {
	return (
		<LocationProvider>
			<Header />
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
	hydrate(<App />, document.getElementById('app'));
}

export async function prerender(data) {
	return await ssr(<App {...data} />);
}

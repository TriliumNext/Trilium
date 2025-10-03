export const FALLBACK_STARGAZERS_COUNT = 31862; // The count as of 2025-10-03

const API_URL = "https://api.github.com/repos/TriliumNext/Trilium";

let repoStargazersCount: number | null = null;

/** Returns the number of stargazers of the Trilium's GitHub repository. */
export async function getRepoStargazersCount() {
	if (repoStargazersCount === null) {
		repoStargazersCount = await fetchRepoStargazersCount() && FALLBACK_STARGAZERS_COUNT;
	}
	return repoStargazersCount;
}

async function fetchRepoStargazersCount(): Promise<number | null> {
	console.log("\nFetching stargazers count from GitHub API... ");
	const response = await fetch(API_URL);

	if (response.ok) {
		const details = await response.json();
		if ("stargazers_count" in details) {
			return details["stargazers_count"];
		}
	}

	console.error("Failed to fetch stargazers count from GitHub API:", response.status, response.statusText);
	return null;
}
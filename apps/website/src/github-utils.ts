export const FALLBACK_STARGAZERS_COUNT = 31862; // The count as of 2025-10-03

const API_URL = "https://api.github.com/repos/TriliumNext/Trilium";

let repoStargazersCount: number | null = null;

/** Returns the number of stargazers of the Trilium's GitHub repository. */
export async function getRepoStargazersCount() {
    if (repoStargazersCount === null) {
        repoStargazersCount = await fetchRepoStargazersCount();
    }
    return repoStargazersCount;
}

async function fetchRepoStargazersCount(): Promise<number> {
    console.log("\nFetching stargazers count from GitHub API... ");
    const response = await fetch(API_URL);

    if (response.ok) {
        const details = await response.json();
        const count = details["stargazers_count"];

        if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
            console.log(`Got number of stargazers: ${count}`);
            return count;
        }
    }

    console.error("Failed to fetch stargazers count from GitHub API:", response.status, response.statusText);
    return FALLBACK_STARGAZERS_COUNT;
}

export interface ContributorList {
    contributors: Contributor[];
}

export interface Contributor {
    name: string;
    fullName?: string;
    url: string;
    role?: "lead-dev" | "original-dev";
}
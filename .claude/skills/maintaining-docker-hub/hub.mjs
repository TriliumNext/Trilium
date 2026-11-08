#!/usr/bin/env node
// Docker Hub maintenance for Trilium's image repositories.
//
//   stats     <repo...>                        pulls, stars, storage, tags, weekly pull series
//   tags      <repo> [--prefix p] [--delete]   list (or delete) tags matching a prefix
//   inventory <repo> [--json file]             every manifest in the repository, untagged included
//   purge     <repo> [--older-than days] [--delete] [--concurrency n]
//                                              delete untagged image indexes (and with them,
//                                              their per-platform images)
//
// Every destructive command is a dry run unless --delete is passed.
//
// Credentials come from `docker login` (~/.docker/config.json, or its credsStore helper), or from
// DOCKERHUB_USERNAME + DOCKERHUB_TOKEN. Deleting needs an account that owns the namespace.
//
// Examples:
//   node hub.mjs stats triliumnext/trilium triliumnext/notes zadam/trilium
//   node hub.mjs tags triliumnext/trilium --prefix sha-
//   node hub.mjs inventory triliumnext/trilium
//   node hub.mjs purge triliumnext/trilium --older-than 7
//   node hub.mjs purge triliumnext/trilium --older-than 7 --delete

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HUB = "https://hub.docker.com";
const REGISTRY = "https://registry-1.docker.io";

let hubToken;
const registryTokens = {};

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
        positional.push(arg);
    } else if (["--delete"].includes(arg)) {
        flags[arg.slice(2)] = true;
    } else {
        flags[arg.slice(2)] = rest[++i];
    }
}

const commands = { stats, tags, inventory, purge };
if (!commands[command]) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 24)
        .map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(command ? 1 : 0);
}
await commands[command]();

// --- Commands ---------------------------------------------------------------------------------

async function stats() {
    for (const repo of positional) {
        const info = await hubJson(`/v2/repositories/${repo}/`);
        const tagCount = (await hubJson(`/v2/repositories/${repo}/tags?page_size=1`)).count;
        console.log(`${repo}  [${info.status_description}]`);
        console.log(`  pulls ${info.pull_count.toLocaleString("en-US")}   stars ${info.star_count}`
            + `   storage ${gb(info.storage_size)}   tags ${tagCount}`
            + `   last push ${info.last_updated?.slice(0, 10)}`);
        console.log(`  categories: ${info.categories.map((c) => c.name).join(", ") || "-"}`);
        const weeks = await weeklyPulls(repo);
        if (weeks.length) {
            console.log("  weekly pulls: " + weeks.map(([w, n]) => `${w} ${n}`).join(", "));
        } else {
            console.log("  weekly pulls: not published for this repository");
        }
    }
}

async function tags() {
    const repo = requireRepo();
    const prefix = flags.prefix ?? "";
    if (flags.delete && !prefix) fail("--delete needs --prefix, so it cannot delete every tag.");
    const names = (await listTags(repo, prefix)).filter((n) => n.startsWith(prefix));
    console.log(`${names.length} tag(s) on ${repo} starting with "${prefix}"`
        + (names.length === 1000 ? " (listing capped at 1000; run again after deleting)" : ""));
    if (!flags.delete) {
        console.log(names.slice(0, 30).join(" ") + (names.length > 30 ? " …" : ""));
        return;
    }
    const counts = await pool(names, async (name) => {
        const status = await hubDelete(`/v2/repositories/${repo}/tags/${encodeURIComponent(name)}/`);
        return status === 204 ? "deleted" : status === 404 ? "absent" : `error ${status}`;
    }, "tags");
    console.log("done:", counts);
}

async function inventory() {
    const repo = requireRepo();
    const manifests = await listManifests(repo);
    const isIndex = (m) => /index|manifest\.list/.test(m.media_type);
    const groups = {
        "tagged indexes": manifests.filter((m) => isIndex(m) && m.tags.length),
        "untagged indexes": manifests.filter((m) => isIndex(m) && !m.tags.length),
        "untagged single manifests": manifests.filter((m) => !isIndex(m) && !m.tags.length),
        "tagged single manifests": manifests.filter((m) => !isIndex(m) && m.tags.length),
    };
    console.log(`${repo}: ${manifests.length} manifests`);
    for (const [label, list] of Object.entries(groups)) {
        if (!list.length) continue;
        const pushed = list.map((m) => m.last_pushed?.slice(0, 10)).sort();
        console.log(`  ${label.padEnd(26)} ${String(list.length).padStart(6)}`
            + `  ${gb(sum(list, "total_size")).padStart(9)} nominal`
            + `  pushed ${pushed[0]} → ${pushed.at(-1)}`);
    }
    console.log("  (nominal sizes count shared layers once per manifest; the per-platform images"
        + " of a tagged index are listed as untagged single manifests)");
    if (flags.json) {
        writeFileSync(flags.json, JSON.stringify(manifests));
        console.log(`wrote ${flags.json}`);
    }
}

async function purge() {
    const repo = requireRepo();
    const olderThan = Number(flags["older-than"] ?? 0);
    const cutoff = Date.now() - olderThan * 86_400_000;

    const keep = await keepList(repo);
    const manifests = await listManifests(repo);
    const candidates = manifests.filter((m) => /index|manifest\.list/.test(m.media_type)
        && !m.tags.length
        && !keep.has(m.manifest_digest)
        && Date.parse(m.last_pushed) < cutoff);
    console.log(`keep: ${keep.size} digests from the live tags`);
    console.log(`to delete: ${candidates.length} untagged image indexes`
        + (olderThan ? ` pushed more than ${olderThan} day(s) ago` : "")
        + `, ${gb(sum(candidates, "total_size"))} nominal`);
    if (!flags.delete || !candidates.length) return;

    const counts = await pool(candidates.map((m) => m.manifest_digest), async (digest) => {
        const status = await registryDelete(repo, digest);
        return { 202: "deleted", 404: "absent", 403: "referenced" }[status] ?? `error ${status}`;
    }, "indexes");
    console.log("done:", counts);
}

// --- Docker Hub API ---------------------------------------------------------------------------

function credentials() {
    if (process.env.DOCKERHUB_USERNAME && process.env.DOCKERHUB_TOKEN) {
        return { username: process.env.DOCKERHUB_USERNAME, secret: process.env.DOCKERHUB_TOKEN };
    }
    const config = JSON.parse(readFileSync(join(homedir(), ".docker", "config.json"), "utf8"));
    const auth = config.auths?.["https://index.docker.io/v1/"]?.auth;
    if (auth) {
        const [username, ...secret] = Buffer.from(auth, "base64").toString().split(":");
        return { username, secret: secret.join(":") };
    }
    if (config.credsStore) {
        const out = execFileSync(`docker-credential-${config.credsStore}`, ["get"],
            { input: "https://index.docker.io/v1/" }).toString();
        const { Username, Secret } = JSON.parse(out);
        return { username: Username, secret: Secret };
    }
    fail("No Docker Hub credentials: run `docker login` or set DOCKERHUB_USERNAME/DOCKERHUB_TOKEN.");
}

async function hubLogin() {
    const { username, secret } = credentials();
    const res = await request(`${HUB}/v2/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: username, secret }),
    });
    if (res.status !== 200) fail(`Docker Hub login failed: ${res.status}`);
    hubToken = (await res.json()).access_token;
}

async function registryToken(repo, refresh = false) {
    if (!registryTokens[repo] || refresh) {
        const { username, secret } = credentials();
        const basic = Buffer.from(`${username}:${secret}`).toString("base64");
        const res = await request("https://auth.docker.io/token?service=registry.docker.io"
            + `&scope=repository:${repo}:pull,push,delete`, { headers: { Authorization: `Basic ${basic}` } });
        registryTokens[repo] = (await res.json()).token;
    }
    return registryTokens[repo];
}

/** Calls the Docker Hub API with a bearer token, renewing it on 401. */
async function hub(path, options = {}) {
    if (!hubToken) await hubLogin();
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await request(HUB + path, {
            ...options,
            headers: { ...options.headers, Authorization: `Bearer ${hubToken}` },
        });
        if (res.status !== 401) return res;
        await hubLogin();
    }
    fail(`Docker Hub keeps answering 401 for ${path}`);
}

async function hubJson(path) {
    const res = await hub(path);
    if (!res.ok) fail(`GET ${path}: ${res.status}`);
    return res.json();
}

async function hubDelete(path) {
    return (await hub(path, { method: "DELETE" })).status;
}

async function registryDelete(repo, digest) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await request(`${REGISTRY}/v2/${repo}/manifests/${digest}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${await registryToken(repo, attempt > 0)}` },
        });
        if (res.status !== 401) return res.status;
    }
    return 401;
}

async function registryManifest(repo, reference) {
    const res = await request(`${REGISTRY}/v2/${repo}/manifests/${reference}`, {
        headers: {
            Authorization: `Bearer ${await registryToken(repo)}`,
            Accept: [
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.list.v2+json",
                "application/vnd.oci.image.manifest.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json",
            ].join(", "),
        },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return {
        digest: res.headers.get("docker-content-digest"),
        children: (body.manifests ?? []).map((m) => m.digest),
    };
}

/** Tags, newest first. The Hub API stops after 10 pages, so at most 1000 come back. */
async function listTags(repo, prefix = "") {
    const names = [];
    let path = `/v2/repositories/${repo}/tags?page_size=100` + (prefix ? `&name=${encodeURIComponent(prefix)}` : "");
    while (path) {
        const page = await hubJson(path);
        if (!page.results?.length) break;
        names.push(...page.results.map((t) => t.name));
        path = page.next ? page.next.replace(HUB, "") : null;
    }
    return names;
}

/** Every manifest in the repository, untagged ones included, from the Hub manifest inventory. */
async function listManifests(repo) {
    const [namespace, name] = repo.split("/");
    const manifests = [];
    let key;
    do {
        const page = await hubJson(`/v2/namespaces/${namespace}/repositories/${name}/manifests?page_size=100`
            + (key ? `&last_evaluated_key=${encodeURIComponent(key)}` : ""));
        manifests.push(...page.manifests);
        key = page.manifests.length && page.last_evaluated_key !== key ? page.last_evaluated_key : null;
    } while (key);
    return manifests;
}

/** Digests a live tag still needs: each tag's index and every manifest inside it. */
async function keepList(repo) {
    const keep = new Set();
    const live = await listTags(repo);
    if (live.length >= 1000) fail("More than 1000 tags: delete unwanted tags first, so the keep list is complete.");
    for (const tag of live) {
        const manifest = await registryManifest(repo, tag);
        if (!manifest) fail(`Cannot resolve ${repo}:${tag}; refusing to build an incomplete keep list.`);
        keep.add(manifest.digest);
        for (const child of manifest.children) keep.add(child);
    }
    return keep;
}

async function weeklyPulls(repo) {
    const res = await request(`${HUB}/r/${repo}`);
    const html = await res.text();
    const series = html.slice(html.indexOf("repoPullsData"));
    return [...series.matchAll(/(\d{4}-\d{2}-\d{2})T00:00:00Z\\",\\"(?:end\\",\\")?\d{4}-\d{2}-\d{2}T00:00:00Z\\",(?:\\"pullCount\\",)?(\d+)/g)]
        .map((m) => [m[1], Number(m[2])]);
}

// --- Helpers ----------------------------------------------------------------------------------

/** fetch() with backoff on 429, 5xx and network errors. */
async function request(url, options = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url, { ...options, headers: { "User-Agent": "trilium-hub-maintenance", ...options.headers } });
            if ((res.status !== 429 && res.status < 500) || attempt >= 8) return res;
        } catch (e) {
            if (attempt >= 8) throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
}

/** Runs `task` over `items` with a few requests in flight; stops after 10 errors. */
async function pool(items, task, label) {
    const concurrency = Number(flags.concurrency ?? 4);
    const counts = {};
    let next = 0;
    let done = 0;
    let errors = 0;
    const worker = async () => {
        while (next < items.length && errors <= 10) {
            const item = items[next++];
            const outcome = await task(item);
            counts[outcome] = (counts[outcome] ?? 0) + 1;
            if (outcome.startsWith("error")) {
                errors++;
                console.log(`ERROR ${item}: ${outcome}`);
            }
            if (++done % 200 === 0) {
                console.log(`${new Date().toTimeString().slice(0, 8)} ${label}: ${done}/${items.length}`, counts);
            }
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (errors > 10) fail(`Stopped after ${errors} errors: ${JSON.stringify(counts)}`);
    return counts;
}

function requireRepo() {
    if (!positional[0]?.includes("/")) fail("Pass the repository as <namespace>/<name>.");
    return positional[0];
}

function sum(list, field) {
    return list.reduce((total, item) => total + (item[field] ?? 0), 0);
}

function gb(bytes) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

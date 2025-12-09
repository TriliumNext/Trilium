// migrate-releases.js
const fetch = require('node-fetch').default;
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
const SOURCE_REPO = 'TriliumNext/Notes';
const DEST_REPO = 'TriliumNext/trilium';

if (!TOKEN) {
  console.error('Error: Please set your GITHUB_TOKEN environment variable');
  process.exit(1);
}

const headers = {
  Authorization: `token ${TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
};

async function getReleases(repo) {
  let releases = [];
  let page = 1;

  while (true) {
    console.log("Got fetch", fetch);
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Failed to get releases: ${res.status} ${res.statusText}`);

    const data = await res.json();
    if (data.length === 0) break;

    releases = releases.concat(data);
    page++;
  }
  return releases;
}

async function createRelease(repo, release) {
  // Strip id, url etc. fields to prepare payload
  const payload = {
    tag_name: release.tag_name,
    target_commitish: "main",
    name: release.name,
    body: release.body,
    draft: release.draft,
    prerelease: release.prerelease,
  };

  const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`POST to https://api.github.com/repos/${repo}/releases with payload:`, payload);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create release: ${res.status} ${res.statusText} - ${text}`);
  }

  return await res.json();
}

async function downloadAsset(assetUrl, filename) {
  const res = await fetch(assetUrl, { headers: { ...headers, Accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status} ${res.statusText}`);
  const buffer = await res.buffer();
  fs.writeFileSync(filename, buffer);
}

async function uploadAsset(uploadUrl, filepath) {
  const filename = path.basename(filepath);
  const stats = fs.statSync(filepath);
  const res = await fetch(`${uploadUrl}?name=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: {
      Authorization: `token ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': stats.size,
    },
    body: fs.createReadStream(filepath),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload asset: ${res.status} ${res.statusText} - ${text}`);
  }

  return await res.json();
}

async function migrate() {
  console.log(`Fetching releases from ${SOURCE_REPO}...`);
  const releases = await getReleases(SOURCE_REPO);
  console.log(`Found ${releases.length} releases.`);

  releases.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const release of releases) {
    console.log(`Migrating release: ${release.name} (${release.tag_name})`);
    const newRelease = await createRelease(DEST_REPO, release);

    // Download and upload assets if any
    for (const asset of release.assets) {
      const tempFile = path.join(__dirname, asset.name);
      console.log(`Downloading asset ${asset.name}...`);
      await downloadAsset(asset.url, tempFile);

      console.log(`Uploading asset ${asset.name}...`);
      await uploadAsset(newRelease.upload_url.replace('{?name,label}', ''), tempFile);

      fs.unlinkSync(tempFile); // Clean up temp file
    }
  }
  console.log('Migration complete!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

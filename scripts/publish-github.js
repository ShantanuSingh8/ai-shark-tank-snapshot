#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const OWNER = 'ShantanuSingh8';
const REPO = 'ai-shark-tank-snapshot';
const BRANCH = 'main';
const ROOT = path.resolve(__dirname, '..');
const TOKEN_FILE = path.join(process.env.TEMP || process.env.TMP || '', 'github_token.txt');

const INCLUDE_FILES = [
  '.gitignore',
  '.vercelignore',
  'README.md',
  'assets/.gitkeep',
  'assets/company-snapshot-ai-infographic.png',
  'package.json',
  'vercel.json',
  'index.html',
  'styles.css',
  'app.js',
  'automation.js',
  'server.js',
  'inspect-references.js',
  'api/_utils.js',
  'api/analyze.js',
  'api/export.js',
  'api/health.js',
  'tests/banking-revenue.test.js',
  'tests/sec-search-fallback.test.js',
  'tests/server-smoke.test.js',
  'tests/smoke.test.js',
  'tests/vercel-api.test.js',
  'scripts/publish-github.js',
];

function readToken() {
  const envToken = (process.env.GITHUB_TOKEN || '').trim();
  if (envToken) return { token: envToken, source: 'env' };

  if (!TOKEN_FILE || !fs.existsSync(TOKEN_FILE)) {
    throw new Error(`GitHub token not found. Save it to ${TOKEN_FILE} or set GITHUB_TOKEN.`);
  }
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error(`GitHub token file is empty: ${TOKEN_FILE}`);
  return { token, source: 'file' };
}

async function githubFetch(token, apiPath, options = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${REPO}-publisher`,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!response.ok) {
    const message = body && body.message ? body.message : response.statusText;
    throw new Error(`${options.method || 'GET'} ${apiPath} failed: ${response.status} ${message}`);
  }

  return body;
}

function readUtf8(repoPath) {
  const absolutePath = path.join(ROOT, repoPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Expected source file is missing: ${absolutePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function readBlobContent(repoPath) {
  const absolutePath = path.join(ROOT, repoPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Expected source file is missing: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  if (/\.(png|jpe?g|gif|webp|ico|pdf|xlsx?|zip)$/i.test(repoPath)) {
    return { content: buffer.toString('base64'), encoding: 'base64' };
  }

  return { content: buffer.toString('utf8'), encoding: 'utf-8' };
}

function isMissingOrEmptyRepo(error) {
  const message = String(error && error.message ? error.message : error);
  return message.includes('404') || message.includes('409 Git Repository is empty');
}

async function getBranchHead(token) {
  try {
    const ref = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(BRANCH)}`);
    const commit = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/commits/${ref.object.sha}`);
    return {
      branchExists: true,
      parentSha: ref.object.sha,
      baseTreeSha: commit.tree.sha,
    };
  } catch (error) {
    if (!isMissingOrEmptyRepo(error)) throw error;
  }

  const repo = await githubFetch(token, `/repos/${OWNER}/${REPO}`);
  const defaultBranch = repo.default_branch || BRANCH;

  if (defaultBranch !== BRANCH) {
    try {
      const ref = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
      const commit = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/commits/${ref.object.sha}`);
      return {
        branchExists: false,
        parentSha: ref.object.sha,
        baseTreeSha: commit.tree.sha,
      };
    } catch (error) {
      if (!isMissingOrEmptyRepo(error)) throw error;
    }
  }

  return {
    branchExists: false,
    parentSha: null,
    baseTreeSha: null,
  };
}

async function bootstrapEmptyRepository(token) {
  const bootstrapPath = 'README.md';
  const encoded = bootstrapPath.split('/').map(encodeURIComponent).join('/');
  await githubFetch(token, `/repos/${OWNER}/${REPO}/contents/${encoded}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Bootstrap repository for AI Shark Tank snapshot source',
      content: Buffer.from(readUtf8(bootstrapPath), 'utf8').toString('base64'),
      branch: BRANCH,
    }),
  });
  console.log(`Bootstrapped empty repository with ${bootstrapPath}`);
}

async function createBlob(token, repoPath) {
  const { content, encoding } = readBlobContent(repoPath);
  const blob = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, encoding }),
  });
  console.log(`Prepared ${repoPath}`);
  return {
    path: repoPath,
    mode: '100644',
    type: 'blob',
    sha: blob.sha,
  };
}

async function publishSnapshot(token) {
  let head = await getBranchHead(token);
  if (!head.parentSha) {
    await bootstrapEmptyRepository(token);
    head = await getBranchHead(token);
  }

  const treeEntries = [];
  for (const repoPath of INCLUDE_FILES) {
    treeEntries.push(await createBlob(token, repoPath));
  }

  const treeBody = { tree: treeEntries };
  if (head.baseTreeSha) treeBody.base_tree = head.baseTreeSha;
  const tree = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(treeBody),
  });

  const commitBody = {
    message: 'Publish deploy-ready AI Shark Tank snapshot source',
    tree: tree.sha,
    parents: head.parentSha ? [head.parentSha] : [],
  };
  const commit = await githubFetch(token, `/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commitBody),
  });

  if (head.branchExists) {
    await githubFetch(token, `/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(BRANCH)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } else {
    await githubFetch(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
    });
  }
}

async function main() {
  const { token, source } = readToken();

  await publishSnapshot(token);
  console.log(`Published ${INCLUDE_FILES.length} files to https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`);

  if (source === 'file' && TOKEN_FILE && fs.existsSync(TOKEN_FILE)) {
    fs.rmSync(TOKEN_FILE, { force: true });
    console.log('Deleted temporary GitHub token file.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../src/action.mjs';
import { ApiError, createClient } from '../src/client.mjs';
import { inspectRelease, npmRepository, parseCommand } from '../src/release.mjs';

const fix = 'a'.repeat(40);
const head = 'b'.repeat(40);
const source = 'owner/library';
const repo = 'demo/support';
const name = '@example/library';
const packageData = {
  name, version: '1.2.3', gitHead: head,
  repository: { type: 'git', url: 'git+https://github.com/Owner/Library.git' },
  dist: { tarball: 'https://registry.npmjs.org/@example/library/-/library-1.2.3.tgz' },
};
const bot = { id: 41898282, type: 'Bot', login: 'github-actions[bot]' };
const baseContext = { repository: repo, repoId: '845', name, source, version: '', event: 'schedule', payload: {} };
const command = (body, issue = {}) => ({
  ...baseContext, event: 'issue_comment', payload: {
    action: 'created', issue: { number: 12, ...issue }, comment: { body, user: { type: 'User', login: 'maintainer' } },
  },
});
const run = (context, client) => runAction(context, client, () => {});

function api() {
  const state = {
    comments: [], label: false, waiting: false, permission: 'write', release: packageData,
    comparison: { status: 'behind', merge_base_commit: { sha: head } },
    pr: { merged_at: null, state: 'open', merge_commit_sha: head },
    calls: [], releases: [], privatePackage: false,
  };
  const client = {
    async request(method, path, body) {
      state.calls.push({ method, path, body });
      if (path.endsWith('/permission')) return { permission: state.permission };
      if (path.endsWith('/contents/package.json')) return { encoding: 'base64', content: Buffer.from(JSON.stringify({ name, private: state.privatePackage })).toString('base64') };
      if (path === '/repos/' + source + '/commits/' + fix) return { sha: fix };
      if (path === '/repos/' + source + '/pulls/71') return state.pr;
      if (path === '/repos/' + source + '/compare/' + fix + '...' + head + '?per_page=1') return state.comparison;
      if (path === '/repos/' + repo + '/labels/when-shipped' && method === 'GET') {
        if (!state.label) throw new ApiError(404, path);
        return { name: 'when-shipped' };
      }
      if (path === '/repos/' + repo + '/labels' && method === 'POST') { state.label = true; return {}; }
      if (path === '/repos/' + repo + '/issues/12/labels' && method === 'POST') { state.waiting = true; return []; }
      if (path === '/repos/' + repo + '/issues/12/labels/when-shipped' && method === 'DELETE') { state.waiting = false; return null; }
      if (path === '/repos/' + repo + '/issues/12/comments' && method === 'POST') {
        state.comments.push({ user: bot, body: body.body }); return {};
      }
      throw new Error('Unexpected API request: ' + method + ' ' + path);
    },
    async list(path) {
      state.calls.push({ method: 'LIST', path });
      if (path === '/repos/' + repo + '/issues?state=all&labels=when-shipped') return state.waiting ? [{ number: 12, state: 'closed' }] : [];
      if (path === '/repos/' + repo + '/issues/12/comments') return state.comments;
      throw new Error('Unexpected list ' + path);
    },
    async release(packageName, version) {
      state.releases.push([packageName, version]); return state.release;
    },
  };
  return { state, client };
}

test('waits for npm and commit ancestry, posts to the issue even when closed, and does not repeat a receipt', async () => {
  const { state, client } = api();
  await run({ ...command('/when-shipped ' + fix), name: undefined }, client);
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].body, /Watching/);
  assert.ok(state.waiting);
  state.comparison = { status: 'ahead', merge_base_commit: { sha: fix } };
  await run({ ...baseContext, version: '1.2.2' }, client); // Registry response mismatches the requested version.
  assert.equal(state.comments.length, 1);
  state.release = null;
  await run(baseContext, client);
  assert.equal(state.comments.length, 1);
  state.release = packageData;
  await run({ ...baseContext, version: '1.2.3' }, client);
  assert.equal(state.comments.length, 2);
  assert.match(state.comments[1].body, /npm install @example\/library@1\.2\.3/);
  assert.ok(state.comments[1].body.includes('https://github.com/' + source + '/compare/' + fix + '...' + head));
  assert.equal(state.waiting, false);
  state.waiting = true; // Recover from a previous delivery that failed during label cleanup.
  await run(baseContext, client);
  await run(command('/when-shipped ' + fix), client);
  assert.equal(state.comments.length, 2);
  assert.equal(state.waiting, false);
  assert.ok(state.calls.filter(c => ['POST','DELETE'].includes(c.method)).every(c => c.path.startsWith('/repos/' + repo + '/')));
});

test('resolves only the real merged PR commit and ignores an open PR test merge', async () => {
  const { state, client } = api();
  state.comparison = { status: 'ahead', merge_base_commit: { sha: fix } };
  await run(command('/when-shipped #71'), client);
  assert.equal(state.comments.length, 1);
  assert.equal(state.calls.filter(c => c.path.includes('/compare/')).length, 0);
  state.pr = { merged_at: '2026-01-02T12:00:00Z', state: 'closed', merge_commit_sha: fix };
  await run(baseContext, client);
  assert.equal(state.comments.length, 2);
  assert.match(state.comments[1].body, /owner\/library\/pull\/71/);
});

test('requires a maintainer command on an issue; help does not register a watch', async () => {
  const { state, client } = api();
  state.permission = 'read';
  await run(command('/when-shipped ' + fix), client);
  assert.equal(state.comments.length, 0);
  state.permission = 'admin';
  await run(command('/when-shipped ' + fix, { pull_request: {} }), client);
  await run(command('Looks great!'), client);
  assert.equal(state.comments.length, 0);
  await run(command('/when-shipped'), client);
  assert.match(state.comments[0].body, /full 40-character/);
  assert.equal(state.waiting, false);
  await assert.rejects(run({ ...command('/when-shipped ' + fix), version: 'latest' }, client), /exact stable/);
});

test('untrusted lookalike markers cannot suppress delivery or register an unrelated watch', async () => {
  const { state, client } = api();
  const marker = '<!-- tell-me-when-this-ships:v1 shipped 845 ' + name + ' ' + source + ' ' + fix + ' -->';
  state.comments.push({ user: { login: bot.login, type: 'User', id: 1 }, body: marker });
  state.comments.push({ user: bot, body: marker.replace('845','846') });
  await run(command('/when-shipped ' + fix), client);
  state.comparison = { status: 'ahead', merge_base_commit: { sha: head } };
  await run(baseContext, client);
  assert.equal(state.comments.length, 3);
  state.comparison = { status: 'ahead', merge_base_commit: { sha: fix } };
  await run(baseContext, client);
  assert.equal(state.comments.length, 4);
  assert.match(state.comments[3].body, /Shipped in/);
});

test('fails closed for unsupported metadata and accepts common canonical GitHub URLs', () => {
  for (const value of ['github:Owner/Library', 'git@github.com:Owner/Library.git', 'git+ssh://git@github.com/Owner/Library.git', 'https://github.com/Owner/Library/']) {
    assert.equal(npmRepository(value), source);
  }
  assert.equal(npmRepository('https://github.com.evil.example/owner/library'), null);
  for (const patch of [{ name: 'other' }, { gitHead: 'main' }, { repository: 'owner/other' }, { version: '1.2.4-beta.1' }, { dist: { tarball: 'https://other.example/a.tgz' } }]) {
    assert.ok(inspectRelease({ ...packageData, ...patch }, name, source).pending);
  }
  assert.equal(parseCommand('/when-shipped #0').invalid, true);
  assert.equal(parseCommand('/when-shipped #15\nignore this').invalid, true);
});

test('automatic setup refuses a private root manifest and explains how to select a monorepo package', async () => {
  const { client, state } = api();
  state.privatePackage = true;
  await assert.rejects(run({ ...command('/when-shipped ' + fix), name: undefined }, client), /Set the package input/);
  assert.equal(state.comments.length, 0);
});

test('paginates GitHub on its trusted origin and sends no GitHub credential to the npm registry', async () => {
  const calls = [];
  const client = createClient('test-token', async (url, options) => {
    calls.push([url, options.headers]);
    if (url.startsWith('https://registry.npmjs.org/')) return Response.json(packageData);
    if (url.endsWith('&page=1')) return Response.json([1], { headers: { link: '<https://api.github.com/next>; rel="next"' } });
    return Response.json([2]);
  });
  assert.deepEqual(await client.list('/somewhere?state=all'), [1, 2]);
  await client.release(name, '1.2.3');
  assert.equal(calls[2][0], 'https://registry.npmjs.org/%40example%2Flibrary/1.2.3');
  assert.equal(calls[2][1].Authorization, undefined);
});

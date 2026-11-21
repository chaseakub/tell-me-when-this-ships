import { inspectRelease, parseCommand, SHA, validPackage, validRepository, validVersion } from './release.mjs';

const LABEL = 'when-shipped';
const BOT_ID = 41898282; // GitHub.com's github-actions[bot] account.
const markerPattern = /^<!-- tell-me-when-this-ships:v1 (watch|shipped) ([0-9]+) (\S+) (\S+) (\S+) -->$/;
const isFix = ref => SHA.test(ref) || /^#[1-9]\d{0,9}$/.test(ref);

function readMarker(comment, repoId) {
  if (comment.user?.id !== BOT_ID || comment.user.type !== 'Bot') return null;
  const match = markerPattern.exec(comment.body?.split('\n').pop());
  if (!match || match[2] !== String(repoId)) return null;
  const [, status, , name, source, ref] = match;
  if (!validPackage(name) || !validRepository(source) || !isFix(ref)) return null;
  return { status, name, source, ref, key: [name, source, ref].join(' ') };
}

function signature(status, config, ref) {
  return `<!-- tell-me-when-this-ships:v1 ${status} ${config.repoId} ${config.name} ${config.source} ${ref} -->`;
}

function referenceLink(source, ref) {
  if (ref.startsWith('#')) return `[${source}${ref}](https://github.com/${source}/pull/${ref.slice(1)})`;
  return `[\`${ref.slice(0, 8)}\`](https://github.com/${source}/commit/${ref})`;
}

async function resolveFix(client, source, ref) {
  const path = '/repos/' + source;
  try {
    if (ref.startsWith('#')) {
      const pr = await client.request('GET', path + '/pulls/' + ref.slice(1));
      if (!pr.merged_at) return { pending: pr.state === 'closed' ? 'pull request closed without a merge' : 'pull request is not merged yet' };
      if (!SHA.test(pr.merge_commit_sha || '')) return { pending: 'GitHub has no merge commit yet' };
      return { sha: pr.merge_commit_sha.toLowerCase() };
    }
    const commit = await client.request('GET', path + '/commits/' + ref);
    return commit.sha?.toLowerCase() === ref ? { sha: ref } : { missing: true };
  } catch (err) {
    if (err.status === 404) return { missing: true };
    throw err;
  }
}

async function ensureLabel(client, repository, issue) {
  const path = '/repos/' + repository;
  try {
    await client.request('GET', path + '/labels/' + LABEL);
  } catch (err) {
    if (err.status !== 404) throw err;
    try {
      await client.request('POST', path + '/labels', { name: LABEL, color: 'c8162b', description: 'Waiting for an npm release containing a linked fix' });
    } catch (creationError) {
      if (creationError.status !== 422) throw creationError;
      await client.request('GET', path + '/labels/' + LABEL);
    }
  }
  await client.request('POST', path + '/issues/' + issue + '/labels', { labels: [LABEL] });
}

async function inferPackage(client, source) {
  let file;
  try {
    file = await client.request('GET', '/repos/' + source + '/contents/package.json');
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (file?.encoding === 'base64' && typeof file.content === 'string') {
    try {
      const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      if (!manifest.private && validPackage(manifest.name)) return manifest.name;
    } catch { /* An explicit package also supports nonstandard layouts. */ }
  }
  throw new Error('Set the package input to a public npm package name. The source repository needs a public package named in its root package.json for automatic setup.');
}

function receipt(config, ref, fix, release) {
  const { name, source } = config;
  const npm = `https://www.npmjs.com/package/${name}/v/${release.version}`;
  const comparison = `https://github.com/${source}/compare/${fix}...${release.head}`;
  return [
    `**Shipped in [${name}@${release.version}](${npm}).**`,
    `The source commit recorded by npm [includes](${comparison}) the fix ${referenceLink(source, ref)}.`,
    `Install it with \`npm install ${name}@${release.version}\`.`,
    signature('shipped', config, ref),
  ].join('\n\n');
}

export async function runAction(context, client, log = console.log) {
  const { event, payload, repository, repoId } = context;
  const source = (context.source || repository).toLowerCase();
  if (!validRepository(repository) || !validRepository(source) || !/^\d+$/.test(String(repoId))) throw new Error('Invalid GitHub repository context.');
  if (context.version && !validVersion(context.version)) throw new Error('version must be an exact stable npm version, for example 1.2.3.');
  const api = '/repos/' + repository;
  const command = event === 'issue_comment' && payload.action === 'created' && !payload.issue?.pull_request && parseCommand(payload.comment?.body);
  if (!command && !['schedule', 'workflow_dispatch', 'release'].includes(event)) return;
  if (event === 'release' && payload.action !== 'published') return;
  if (command) {
    const user = payload.comment.user;
    if (!user?.login || user.type === 'Bot') return;
    const access = await client.request('GET', api + '/collaborators/' + encodeURIComponent(user.login) + '/permission');
    if (!['write', 'maintain', 'admin'].includes(access.permission)) return;
    if (command.invalid) {
      await client.request('POST', api + '/issues/' + payload.issue.number + '/comments', {
        body: 'Use `/when-shipped #123` with the fix’s pull request number, or `/when-shipped` followed by its full 40-character commit SHA.',
      });
      return;
    }
  }
  const ids = command ? [payload.issue.number] : (await client.list(api + '/issues?state=all&labels=' + LABEL)).filter(i => !i.pull_request).map(i => i.number);
  if (!ids.length) { log('No issues are waiting.'); return; }
  const name = context.name || await inferPackage(client, source);
  if (!validPackage(name)) throw new Error('package must be a public npm package name, for example lodash or @scope/name.');
  const config = { name, source, repoId };
  let release;
  const fixes = new Map();
  const comparisons = new Map();
  const fixOf = async ref => {
    if (!fixes.has(ref)) fixes.set(ref, await resolveFix(client, source, ref));
    return fixes.get(ref);
  };
  const shipped = async fix => {
    if (!comparisons.has(fix)) {
      try {
        const result = await client.request('GET', '/repos/' + source + '/compare/' + fix + '...' + release.head + '?per_page=1');
        comparisons.set(fix, ['ahead', 'identical'].includes(result.status) && result.merge_base_commit?.sha?.toLowerCase() === fix);
      } catch (err) {
        if (err.status !== 404) throw err;
        comparisons.set(fix, false);
      }
    }
    return comparisons.get(fix);
  };
  for (const issue of ids) {
    const base = api + '/issues/' + issue;
    const comments = await client.list(base + '/comments');
    const markers = comments.map(c => readMarker(c, repoId)).filter(Boolean);
    const watches = new Map(markers.filter(m => m.status === 'watch').map(m => [m.key, m]));
    const delivered = new Set(markers.filter(m => m.status === 'shipped').map(m => m.key));
    if (command) {
      const ref = command.ref;
      const key = [name, source, ref].join(' ');
      if (delivered.has(key)) { log('Already shipped for issue #' + issue); continue; }
      const fix = await fixOf(ref);
      if (fix.missing) {
        await client.request('POST', base + '/comments', { body: 'I could not find that fix in `' + source + '`. Check the pull request number or full commit SHA.' });
        continue;
      }
      // Set the label first. A failed registration can be retried without
      // creating a watch that a scheduled run could never discover.
      await ensureLabel(client, repository, issue);
      if (!watches.has(key)) {
        const body = `Watching ${referenceLink(source, ref)}. I’ll reply here when a stable release of **${name}** on npm includes its source commit.\n\n${signature('watch', config, ref)}`;
        await client.request('POST', base + '/comments', { body });
        watches.set(key, { name, source, ref, key });
      }
    }
    for (const watch of watches.values()) {
      if (watch.name !== name || watch.source !== source || delivered.has(watch.key)) continue;
      if (!release) release = inspectRelease(await client.release(name, context.version), name, source, context.version);
      if (release.pending) { log(`#${issue}: waiting; ${release.pending}.`); continue; }
      const fix = await fixOf(watch.ref);
      if (!fix.sha || !await shipped(fix.sha)) {
        log(`#${issue}: waiting; ${fix.pending || (fix.missing ? 'fix unavailable' : name + '@' + release.version + ' does not establish this fix')}.`);
        continue;
      }
      await client.request('POST', base + '/comments', { body: receipt(config, watch.ref, fix.sha, release) });
      delivered.add(watch.key);
      log(`#${issue}: confirmed ${name}@${release.version}.`);
    }
    if (watches.size && [...watches.keys()].every(key => delivered.has(key))) {
      try {
        await client.request('DELETE', base + '/labels/' + LABEL);
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
  }
}

export const SHA = /^[0-9a-f]{40}$/i;
const slug = /^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i;
const npmName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/;

export function validRepository(value) {
  return typeof value === 'string' && slug.test(value) && !['.', '..'].includes(value.split('/')[1]);
}

export function validPackage(value) {
  return typeof value === 'string' && value.length <= 214 && npmName.test(value);
}

export function npmRepository(repository) {
  const value = typeof repository === 'string' ? repository : repository?.url;
  if (typeof value !== 'string') return null;
  const path = value.trim()
    .replace(/^(?:git\+)?(?:https?:\/\/|git:\/\/|ssh:\/\/(?:git@)?)github\.com\//i, '')
    .replace(/^(?:git@github\.com:|github:)/i, '')
    .replace(/\/$/, '').replace(/\.git$/i, '');
  return validRepository(path) ? path.toLowerCase() : null;
}

export function validVersion(value) {
  return typeof value === 'string' && value.length <= 256 && stableVersion.test(value);
}

export function inspectRelease(metadata, name, source, version) {
  if (!metadata) return { pending: 'the requested release is not on the public npm registry' };
  if (metadata.name !== name) return { pending: 'npm returned a different package name' };
  if (version && metadata.version !== version) return { pending: 'npm returned a different version' };
  if (!validVersion(metadata.version)) {
    return { pending: 'the latest dist-tag does not point to a stable version' };
  }
  if (npmRepository(metadata.repository) !== source.toLowerCase()) {
    return { pending: 'the npm repository does not match the configured GitHub source' };
  }
  if (!SHA.test(metadata.gitHead || '')) return { pending: 'the published version has no full gitHead' };
  const tarball = URL.canParse(metadata.dist?.tarball) && new URL(metadata.dist.tarball);
  if (!tarball || tarball.origin !== 'https://registry.npmjs.org' || !tarball.pathname.endsWith('.tgz') ||
      tarball.username || tarball.password) {
    return { pending: 'npm metadata has no public registry tarball' };
  }
  return { version: metadata.version, head: metadata.gitHead.toLowerCase() };
}

export function parseCommand(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!/^\/when-shipped(?:\s|$)/i.test(text)) return null;
  const match = /^\/when-shipped[ \t]+(#([1-9]\d{0,9})|[0-9a-f]{40})$/i.exec(text);
  if (!match) return { invalid: true };
  return { ref: match[1].toLowerCase() };
}

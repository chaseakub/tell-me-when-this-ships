export class ApiError extends Error {
  constructor(status, requestPath) {
    super(`GitHub returned ${status} for ${requestPath}`);
    this.status = status;
  }
}

export function createClient(token, fetchImpl = fetch) {
  async function github(method, path, body) {
    const response = await fetchImpl('https://api.github.com' + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tell-me-when-this-ships',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new ApiError(response.status, path);
    return { data: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  return {
    async request(method, path, body) {
      return (await github(method, path, body)).data;
    },
    async list(path) {
      const values = [];
      for (let page = 1; ; page++) {
        const separator = path.includes('?') ? '&' : '?';
        const { data, headers } = await github('GET', path + separator + 'per_page=100&page=' + page);
        values.push(...data);
        if (!/<[^>]+>;\s*rel="next"/.test(headers.get('link') || '')) return values;
      }
    },
    async release(name, version) {
      const response = await fetchImpl('https://registry.npmjs.org/' + encodeURIComponent(name) + '/' + encodeURIComponent(version || 'latest'), {
        headers: { Accept: 'application/json', 'User-Agent': 'tell-me-when-this-ships' },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`npm returned ${response.status} for ${name}`);
      return response.json();
    },
  };
}

import { readFile } from 'node:fs/promises';
import { createClient } from './client.mjs';
import { runAction } from './action.mjs';

const env = process.env;
try {
  await runAction({
    event: env.GITHUB_EVENT_NAME,
    payload: JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')),
    repository: env.GITHUB_REPOSITORY,
    repoId: env.GITHUB_REPOSITORY_ID,
    name: env.INPUT_PACKAGE?.trim(),
    source: env['INPUT_SOURCE-REPOSITORY']?.trim(),
    version: env.INPUT_VERSION?.trim(),
  }, createClient(env.INPUT_TOKEN));
} catch (error) {
  console.error('Tell me when this ships: ' + error.message);
  process.exitCode = 1;
}

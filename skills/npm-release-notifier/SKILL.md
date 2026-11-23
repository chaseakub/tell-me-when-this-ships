---
name: npm-release-notifier
description: Check whether a GitHub pull request has shipped in a stable npm package. Set up a release notification when someone wants the original GitHub issue to get a reply when its fix is available to install.
license: MIT
---

# Notify an issue when its fix reaches npm

Identify the issue where the reply belongs, the pull request or full commit SHA that fixes it, and the public npm package. The issue and the package source can belong to different repositories.

## Answer “has it shipped?” once

For a merged pull request, get its `merge_commit_sha` from GitHub. Read the package’s `latest` metadata from the public npm registry. Check that the version is stable, that its tarball is on the public npm registry, and that its `repository` identifies the fix’s GitHub repository. Compare the fix SHA to the package’s full `gitHead` using GitHub’s compare endpoint with the fix as the base. An `identical` or `ahead` result with the fix as the merge base establishes that the published source contains the fix.

Link the exact npm version and the comparison in the answer. If the metadata or ancestry is inconclusive, say what is missing. A version found this way is a version containing the fix. Identifying the first version requires checking earlier releases too.

## Watch for a future release

1. Check whether the issue repository’s default branch already has a workflow that uses `chaseakub/tell-me-when-this-ships`. For a requested install, add the [published workflow](https://raw.githubusercontent.com/chaseakub/tell-me-when-this-ships/d2e21c913a9272be9ad6c0e98da785d2f1a7dac9/examples/when-shipped.yml) to `.github/workflows/when-shipped.yml`. If that path already belongs to another workflow, choose a free filename. GitHub supplies the token.
2. A public package named in the source repository’s root `package.json` works with the defaults. For a monorepo, set the Action’s `package` input to the affected published package. When the issue is downstream, set `source-repository` to the upstream GitHub repository.
3. Once the workflow is on the default branch, a maintainer with write access comments `/when-shipped #4200` on the **issue**, replacing `4200` with the fixing PR number. A full 40-character source commit SHA also works. The Action ignores bot-authored commands. An agent using a bot account can give the maintainer the exact comment to post.
4. The bot acknowledges the watch. When the stable npm release contains the fix, it replies on the same issue with the version, comparison, and install command. An issue can be closed while it waits.

For a one-time lookup, the registry and GitHub reads are sufficient. Install a workflow or post a watch only when the user wants that change. [See a real release reply](https://github.com/chaseakub/when-shipped-demo/issues/1#issuecomment-7053855864).

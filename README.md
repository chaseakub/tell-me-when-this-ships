# Tell me when this ships

A free GitHub Action that replies to an issue when its fix reaches npm. The reply includes the published package version, the comparison proving the fix is in its source history, and the exact install command.

[See the bot reply on a real issue](https://github.com/chaseakub/when-shipped-demo/issues/1) · [See the test against the published packages](https://github.com/chaseakub/when-shipped-demo/actions/workflows/proof.yml)

## Install

From the root of your npm package's GitHub repository, add the [workflow file](examples/when-shipped.yml) and commit it to your default branch.

```sh
mkdir -p .github/workflows
curl -fsSL https://raw.githubusercontent.com/chaseakub/tell-me-when-this-ships/v1/examples/when-shipped.yml -o .github/workflows/when-shipped.yml
```

That's the entire install for a public package named in your root `package.json`. GitHub supplies the token. The Action runs on GitHub's runner and needs no account, npm credentials, checkout, or dependencies from your project.

## Use it

On the issue where someone is waiting, a maintainer with write access comments:

```text
/when-shipped #4200
```

Use the number of the pull request fixing **that issue** in your source repository. You can also supply the full 40-character commit SHA. The Action acknowledges the watch and adds the `when-shipped` label. Open pull requests wait for a merge. The original issue can be closed and still receive the reply.

The installed workflow checks right away, when a GitHub release is published, and on a 30-minute schedule. GitHub may delay scheduled runs. To check immediately, open **Actions → Tell me when this ships → Run workflow**. Repeat checks skip fixes that already received a reply.

## What counts as shipped?

The default check reads the public npm registry's `latest` tag. It requires a stable version, a registry tarball, a matching GitHub source repository and a full `gitHead`. GitHub must confirm the fix is that commit or an ancestor of it. Missing metadata, an unmerged PR, or a release from a different branch leaves the issue waiting. A Git tag alone cannot establish an npm publication.

The comment identifies a verified version containing the fix. Some build processes omit or reuse `gitHead`, and a cherry-pick can change a fix's SHA. For a cherry-pick, watch the commit on the release branch. Package-specific tests can verify behavior inside the artifact, as in the [Marked demo](https://github.com/chaseakub/when-shipped-demo/blob/main/proof.test.mjs).

## Monorepos and downstream trackers

For a monorepo, set `package` to the published package name. For an issue in a downstream repository, also supply the upstream GitHub repository. Here's the actual demo configuration:

```yaml
- uses: chaseakub/tell-me-when-this-ships@v1
  with:
    package: marked
    source-repository: markedjs/marked
```

An optional `version` input checks an exact, stable, published version. This works after a publish job or when replaying an earlier release. Leave it out for ordinary live tracking.

## Permissions and licensing

The installer requests read access to contents and pull requests, and write access to issues for labels and replies. The queue serializes runs so a publish event and a scheduled check can safely overlap. State lives in bot-authored comments on the issue. This version supports GitHub.com and the public npm registry.

The Action is [MIT licensed](LICENSE). Run `npm test` with Node.js 24 to work on it locally.

# npm package release

XCS keeps `@xcs-protocol/core`, `@xcs-protocol/sdk`, and `@xcs-protocol/cli` on one coordinated
version. They are alpha release artifacts, not independent version streams. The packages are not
publicly available until the npm scope bootstrap below has been completed by an XRPL Commons npm
organization owner.

## Reproduce the artifacts locally

From a clean checkout with the locked toolchain installed, run:

```sh
pnpm install --frozen-lockfile
pnpm package:smoke
```

The gate builds the packages in dependency order, packs each package twice, rejects a byte-level
reproducibility mismatch, inspects the published manifests and file inventory, installs all three
tarballs into an isolated offline consumer, type-checks and imports the public ESM APIs, and executes
the packaged `xcs` binary plus an offline deterministic command. It rejects an unbuilt export, a
missing bin, mismatched versions, a remaining `workspace:` dependency, or unexpected package files.
Temporary artifacts are removed on success and failure.

To retain the three verified tarballs for release review, provide a new or empty output directory:

```sh
pnpm package:smoke -- --output-dir ./release-packages
```

Do not commit that directory. Hash and archive the exact tarballs with the release evidence.

## One-time npm scope bootstrap

Trusted publishing and staged publishing both require each package to exist already. Before the
first release, an XRPL Commons npm organization owner must:

1. confirm that the organization controls the `@xcs-protocol` scope and require 2FA for its
   maintainers;
2. create the protected GitHub environment `npm-release` with a required reviewer;
3. check out the signed release tag, run the artifact gate above, and review the three tarballs;
4. publish that first coordinated alpha interactively, in `core`, `sdk`, `cli` order, with public
   access and the `alpha` dist-tag; do not put an OTP or a reusable npm token in a command, file,
   workflow, or shell history;
5. record that this bootstrap version cannot have OIDC provenance, then configure a Trusted
   Publisher for each package and do not use the bootstrap path again.

The Trusted Publisher settings for all three packages must be exact and case-sensitive:

| Setting        | Value                  |
| -------------- | ---------------------- |
| GitHub owner   | `XRPL-Commons`         |
| Repository     | `XCS`                  |
| Workflow       | `release-packages.yml` |
| Environment    | `npm-release`          |
| Allowed action | staged publishing only |

The one-time interactive commands use the already reviewed tarballs. Disable provenance only for
this bootstrap because npm provenance requires a supported CI identity; let npm prompt for 2FA
instead of passing an OTP argument:

```sh
VERSION=0.1.0-alpha.1
NPM_CONFIG_PROVENANCE=false npm publish "./release-packages/xcs-protocol-core-$VERSION.tgz" --access public --tag alpha
NPM_CONFIG_PROVENANCE=false npm publish "./release-packages/xcs-protocol-sdk-$VERSION.tgz" --access public --tag alpha
NPM_CONFIG_PROVENANCE=false npm publish "./release-packages/xcs-protocol-cli-$VERSION.tgz" --access public --tag alpha
```

Replace the example version with the exact signed tag version. Stop immediately if npm resolves a
different scope, owner, registry, package name, version, or file inventory.

After verifying the first OIDC staging run, disallow token-based publishing for each package. A
long-lived `NPM_TOKEN` is neither required nor accepted by the committed workflow.

The release workflow is safe to run for the bootstrap tag after all three interactive publishes:
it computes each local tarball's SHA-512 integrity, compares it with npm's `dist.integrity`, and skips
only an already-published byte-identical version. An existing version with different bytes fails the
release instead of being treated as complete.

## Routine alpha release

1. Update the root, core, SDK, and CLI manifests to the same `x.y.z-alpha.n` version and update the
   lockfile.
2. Run `pnpm verify`, `pnpm package:smoke`, the Go verifier gates, and the relevant browser/database
   integration tiers.
3. Create a signed annotated tag named exactly `v<x.y.z-alpha.n>` on the reviewed commit. The
   workflow rejects lightweight tags, unverified signatures, and tags targeting a different commit.
4. Publish a GitHub Release for that tag. The `Stage npm packages` workflow rebuilds and rechecks the
   tarballs on a GitHub-hosted runner, obtains a short-lived npm credential through OIDC, and stages
   every not-yet-published package under the `alpha` dist-tag. A byte-identical bootstrap package is
   verified and skipped; no version is overwritten. The three reviewed tarballs are retained as one
   workflow artifact for 30 days.
5. Review the staged manifests, contents, hashes, provenance, dependencies, and CLI behavior on
   npm. Approve with 2FA strictly in dependency order: `core`, then `sdk`, then `cli`, and only after
   all three stages are present and consistent.
6. Install the public versions into a new consumer and repeat the smoke commands before updating the
   Developers page from monorepo-alpha instructions to registry installation instructions.

The workflow deliberately refuses stable, beta, or uncoordinated versions. Changing the release
channel requires a reviewed workflow change rather than silently assigning a prerelease to
`latest`.

## Failure and rollback

- If staging stops before approval, do not approve any package. Reject the partial stages with 2FA,
  fix the cause, and rerun the same reviewed tag only after npm releases the staged reservation.
- If approval is interrupted after `core` or `sdk` became public, do not unpublish or republish that
  prefix. Recheck its public integrity against the retained tarball, resume the remaining stages from
  the same signed tag in `core` → `sdk` → `cli` order, and approve only the unpublished suffix. If
  any tarball must change, stop and issue a new coordinated prerelease version instead.
- If a published artifact is faulty, do not overwrite or silently unpublish it. Deprecate that exact
  version with a concise reason and issue a new coordinated patch/prerelease from a reviewed commit.
- If the repository, workflow filename, environment, or GitHub organization changes, update all
  three npm Trusted Publisher records before the next release.

The release controls follow npm's current documentation for
[Trusted Publishers](https://docs.npmjs.com/trusted-publishers/),
[staged publishing](https://docs.npmjs.com/staged-publishing/), and
[provenance statements](https://docs.npmjs.com/generating-provenance-statements/). Recheck those
requirements before changing the pinned npm CLI or release workflow.

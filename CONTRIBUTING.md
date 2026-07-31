# Contributing

This repository is a fork of
[weedpump/timeline-card](https://github.com/weedpump/timeline-card). The fork's
`main` branch is the release branch used by ControlaIT. It can contain fork
branding, HACS configuration, and several validated improvements at once.

## Work In The Fork

1. Start a short-lived branch from the fork's `main` branch.
2. Make and verify the change.
3. Open a pull request from that branch to `ControlaIT/timeline-card:main`.
4. Merge it after review and checks pass.
5. Delete the merged feature branch.

This keeps the fork current without changing the original project.

## Propose A Change Upstream

Do not open an upstream pull request from `ControlaIT/timeline-card:main`. It
would include every fork-specific change and unrelated improvement.

Instead, create a clean branch from the original project's current `main`:

```sh
git fetch upstream
git switch -c feature/<small-change> upstream/main
```

Move or recreate only one focused change on that branch. It should contain:

- One user-visible feature or focused fix.
- Tests for its behavior.
- Documentation and screenshots when the visual result changes.

It must not contain:

- ControlaIT URLs, HACS configuration, branding, or installation instructions.
- Fork-only changelog entries.
- Unrelated features or formatting changes.

Push the branch to the fork:

```sh
git push -u origin feature/<small-change>
```

Then create a cross-repository pull request on GitHub:

- Base repository and branch: `weedpump/timeline-card:main`
- Head repository and branch: `ControlaIT/timeline-card:feature/<small-change>`

The upstream maintainer reviews and merges that pull request. Keep the fork's
`main` branch unchanged while the upstream review is in progress.

## Suggested Upstream Scope

Prefer separate pull requests for independent changes. Examples from this fork:

- Fixed event widths and mirrored sides.
- Timeline grouping by day.
- Configurable tap actions.
- Restart availability-artifact filtering.
- A `default` catch-all label in `state_map`.

Start with the smallest visual improvement that has a clear before/after
example. A large combined pull request is harder for an upstream maintainer to
review and less likely to be merged.

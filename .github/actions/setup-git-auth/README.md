# Setup Git Authentication Action

Simple GitHub Action to configure Git authentication for GitHub repositories and submodules.

## Usage

```yaml
- name: Setup Git authentication
  uses: taxdown/.github/.github/actions/setup-git-auth@main
  with:
    token: ${{ steps.app-token.outputs.token }}
```

## Inputs

- `token`: GitHub token for authentication (required)

## What it does

- Configures `GIT_ASKPASS` to automatically provide the token
- Sets up URL rewriting for GitHub repositories
- Enables authentication for both HTTPS and SSH URLs
- Works with submodules and nested repositories

## Requirements

- Must be run before any Git operations that require authentication
- Requires a valid GitHub token with appropriate permissions

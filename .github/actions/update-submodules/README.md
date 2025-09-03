# Update Submodules Action

Simple GitHub Action to update git submodules to their latest commits or tags.

## Usage

```yaml
- name: Update submodules
  uses: ./.github/actions/update-submodules
  with:
    strategy: commit  # or 'tag'
    token: ${{ steps.app-token.outputs.token }}
```

## Inputs

- `strategy`: Strategy to use (commit or tag). Default: 'commit'
- `token`: GitHub token for authentication (required)

## How it works

- **commit**: Uses `git submodule update --init --recursive --remote` to update to latest commits
- **tag**: Uses `git submodule foreach` to fetch tags and checkout the latest tag

## Requirements

- Must be run after `actions/checkout` with `submodules: recursive`
- Requires GitHub token for authentication

# Update Submodules Action

GitHub Action to update git submodules with authentication support and flexible strategies.

## Usage

```yaml
- name: Update submodules
  uses: taxdown/.github/.github/actions/update-submodules@main
  with:
    strategy: commit
    token: ${{ steps.app-token.outputs.token }}
```

## Inputs

- `strategy`: Strategy to use (commit or tag), defaults to 'commit'
- `token`: GitHub token for authentication (required)

## Strategies

### Commit Strategy (default)
Updates submodules to the latest commit on their configured branch:
```yaml
strategy: commit
```

### Tag Strategy
Updates submodules to their latest tag:
```yaml
strategy: tag
```

## What it does

- Configures Git authentication for submodule operations
- Supports both commit and tag-based updates
- Handles recursive submodule updates
- Uses Git's native submodule configuration
- Works with private repositories

## Requirements

- Requires a valid GitHub token with appropriate permissions
- Must be run after checkout with submodules

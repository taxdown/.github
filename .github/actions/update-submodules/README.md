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

## Technical Design Decisions

### Why `--global` instead of `--local`?

This action uses `git config --global` for URL rewriting instead of `--local` for the following technical reasons:

#### **1. Submodule Inheritance Limitation**
- Git submodules maintain their own separate `.git/config` files
- Local configuration from the parent repository is **not inherited** by submodules
- Each submodule would need individual configuration, making the action complex and error-prone

#### **2. Cross-Repository Access**
- Submodules often reside in different repositories or organizations
- Local configuration is repository-specific and won't apply to external submodules
- Global configuration ensures consistent authentication across all submodules

#### **3. Recursive Submodule Support**
- Nested submodules (submodules within submodules) require consistent configuration
- Local configuration would require complex recursive setup for each level
- Global configuration applies uniformly to all levels

#### **4. Security and Cleanup**
- **Automatic cleanup**: `trap cleanup EXIT` ensures global config is restored
- **Isolation**: Each action run gets a unique process ID (`$$`) for temporary files
- **No persistence**: Configuration is removed after action completion
- **No interference**: Cleanup prevents conflicts between concurrent runs

#### **5. Performance and Reliability**
- Single configuration operation vs. multiple recursive operations
- Reduced complexity and potential failure points
- Consistent behavior across different repository structures

### Security Considerations

The action implements multiple security measures:

- **Secure file permissions**: `umask 077` and `chmod 700` for temporary files
- **Automatic cleanup**: All global configurations are removed on exit
- **Process isolation**: Unique temporary files per execution
- **Token protection**: No token exposure in logs or output

## What it does

- Configures Git authentication for submodule operations
- Supports both commit and tag-based updates
- Handles recursive submodule updates
- Uses Git's native submodule configuration
- Works with private repositories

## Requirements

- Requires a valid GitHub token with appropriate permissions
- Must be run after checkout with submodules

# .github

Shared GitHub Actions workflows for the organisation.

## `gcp-terraform.yml`

Applies a repository's GCP Terraform. `check` — format, validate and
`terraform test` — runs on any branch with no credentials, because the tests use
mocked providers. Everything else authenticates by Workload Identity Federation,
so there is no key anywhere in the workflow.

| Trigger | What happens |
|---|---|
| Any other branch | `plan`, against `dev` |
| Default branch | `apply`, over the `stages` input |
| Tag matching `prod-tag-prefix` | `apply`, against `prod` |
| Manual dispatch | `apply`, against `dev` |

```yaml
jobs:
  terraform:
    uses: taxdown/.github/.github/workflows/gcp-terraform.yml@main
    with:
      service: cintra
      countries: '["es", "mx"]'
      stages: '["dev"]'
```

### What the caller provides

One GitHub Environment named `<stage>-<country>` per deployment, holding three
**variables** — not secrets, because they are resource identifiers that each
repository's bootstrap script prints on screen:

| Variable | Example |
|---|---|
| `GCP_PROJECT` | `data-es-development` |
| `GCP_WIF_PROVIDER` | `projects/794676034112/locations/global/workloadIdentityPools/cintra-es-dev/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `cintra-es-dev-deploy@data-es-development.iam.gserviceaccount.com` |

The Terraform configuration is expected to take three variables: `gcp_project`,
`env` and `country`. That is the data platform's shape — one GCP project per
country and stage, named `data-<country>-<stage>`.

### The backend is a convention

The workflow builds it; the caller does not repeat it.

```
bucket  <service>-<country>-<stage>-tfstate-<gcp_project>
prefix  <service>/<stage>/<country>
```

A bucket per deployment is what lets the deployments apply in parallel. Sharing
one `terraform.tfstate` between concurrent applies is a race, and the last one
to finish overwrites what the other wrote.

### Two things worth knowing

1. **`stages` defaults to `dev` and `staging`.** A repository whose staging
   deployment has not been bootstrapped yet must pass `'["dev"]'`, or every
   staging apply fails on the first merge — the configuration's `import` blocks
   cannot adopt resources that do not exist.
2. **`prod-tag-prefix` is empty by default**, which disables applying to
   production from a tag. Set it only when you mean it: `gaunter-v` makes every
   matching tag apply to prod.
3. **A service whose name starts with `the-` passes it stripped.** The bootstrap
   script of `taxdown/jaskier` drops the article when it builds the bucket name,
   so `the-continent` bootstraps as `continent`. Pass the stripped name, or the
   workflow reads an empty state.
4. **`credentials-ready: false`** leaves only the `check` job. It is for a
   repository whose bootstrap is not done: without the Environment variables,
   `plan` fails while authenticating, before reaching Terraform, and the red
   pipeline says nothing about the code.

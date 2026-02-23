import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export interface PullRequestContext {
  owner: string;
  repo: string;
  prNumber: number;
  author: string;
  headSha: string;
  baseSha: string;
  installationId: number;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface ReviewerCandidate {
  username: string;
  commits: number;
}

const getInstallationOctokit = async (installationId: number): Promise<Octokit> => {
  const auth = createAppAuth({
    appId: process.env.APP_ID!,
    privateKey: process.env.APP_PRIVATE_KEY!,
  });

  const { token } = await auth({ type: 'installation', installationId });

  return new Octokit({ auth: token });
};

export const getChangedFiles = async (ctx: PullRequestContext): Promise<ChangedFile[]> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  const { data } = await octokit.pulls.listFiles({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    per_page: 100,
  });

  return data.map(f => ({ path: f.filename, additions: f.additions, deletions: f.deletions }));
};

export const getDiff = async (ctx: PullRequestContext): Promise<string> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  const { data } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    mediaType: { format: 'diff' },
  });

  return data as unknown as string;
};

export const getCommitHistoryForFiles = async (
  ctx: PullRequestContext,
  files: string[]
): Promise<ReviewerCandidate[]> => {
  const octokit = await getInstallationOctokit(ctx.installationId);
  const usernameCount: Record<string, number> = {};

  await Promise.all(
    files.map(async path => {
      const { data } = await octokit.repos.listCommits({
        owner: ctx.owner,
        repo: ctx.repo,
        path,
        since: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(), // 6 months
        per_page: 50,
      });

      for (const commit of data) {
        const username = commit.author?.login;
        if (username && username !== ctx.author) {
          usernameCount[username] = (usernameCount[username] ?? 0) + 1;
        }
      }
    })
  );

  return Object.entries(usernameCount)
    .map(([username, commits]) => ({ username, commits }))
    .sort((a, b) => b.commits - a.commits);
};

export const getRiskCriteria = async (ctx: PullRequestContext): Promise<string> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  try {
    const { data } = await octokit.repos.getContent({
      owner: ctx.owner,
      repo: ctx.repo,
      path: 'CODEOWNERS-RISK.md',
    });

    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
  } catch {
    console.warn(`CODEOWNERS-RISK.md not found in ${ctx.owner}/${ctx.repo}`);
  }

  return '';
};

export const getCodeowners = async (ctx: PullRequestContext): Promise<string> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  try {
    const { data } = await octokit.repos.getContent({
      owner: ctx.owner,
      repo: ctx.repo,
      path: '.github/CODEOWNERS',
    });

    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
  } catch {
    console.warn(`CODEOWNERS not found in ${ctx.owner}/${ctx.repo}`);
  }

  return '';
};

export const getPullRequestState = async (ctx: PullRequestContext) => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  const [reviews, reviewRequests] = await Promise.all([
    octokit.pulls.listReviews({ owner: ctx.owner, repo: ctx.repo, pull_number: ctx.prNumber }),
    octokit.pulls.listRequestedReviewers({ owner: ctx.owner, repo: ctx.repo, pull_number: ctx.prNumber }),
  ]);

  const approvals = reviews.data.filter(r => r.state === 'APPROVED');
  const requestedReviewers = reviewRequests.data.users.map(u => u.login);

  return { approvals, requestedReviewers };
};

export const createCheckInProgress = async (ctx: PullRequestContext): Promise<number> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  const { data } = await octokit.checks.create({
    owner: ctx.owner,
    repo: ctx.repo,
    name: 'Agentic CODEOWNERS',
    head_sha: ctx.headSha,
    status: 'in_progress',
  });

  return data.id;
};

export const completeCheck = async (
  ctx: PullRequestContext,
  checkRunId: number,
  riskLevel: string,
  summary: string
): Promise<void> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  await octokit.checks.update({
    owner: ctx.owner,
    repo: ctx.repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion: 'success',
    output: {
      title: `Risk level: ${riskLevel}`,
      summary,
    },
  });
};

export const failCheck = async (ctx: PullRequestContext, checkRunId: number): Promise<void> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  await octokit.checks.update({
    owner: ctx.owner,
    repo: ctx.repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion: 'failure',
    output: {
      title: 'Assessment failed',
      summary: 'An error occurred during the risk assessment. Check the Lambda logs for details.',
    },
  });
};

export const approvePullRequest = async (ctx: PullRequestContext, riskLevel: string): Promise<void> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  await octokit.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    commit_id: ctx.headSha,
    event: 'APPROVE',
    body: `Auto-approved by Agentic CODEOWNERS - risk level: ${riskLevel}`,
  });
};

export const assignReviewers = async (ctx: PullRequestContext, reviewers: string[]): Promise<void> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  await octokit.pulls.requestReviewers({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    reviewers,
  });
};

export const postComment = async (ctx: PullRequestContext, body: string): Promise<void> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  const { data: comments } = await octokit.issues.listComments({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.prNumber,
    per_page: 100,
  });

  const existing = comments.find(c => c.body?.includes('## Agentic CODEOWNERS Assessment'));

  if (existing) {
    await octokit.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.prNumber,
      body,
    });
  }
};

export const dismissApprovals = async (ctx: PullRequestContext): Promise<void> => {
  const octokit = await getInstallationOctokit(ctx.installationId);

  const { data: reviews } = await octokit.pulls.listReviews({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
  });

  const approvals = reviews.filter(r => r.state === 'APPROVED');

  await Promise.all(
    approvals.map(review =>
      octokit.pulls.dismissReview({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.prNumber,
        review_id: review.id,
        message: 'Risk level increased after new commits. Re-evaluation required.',
      })
    )
  );
};

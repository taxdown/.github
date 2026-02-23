import Anthropic from '@anthropic-ai/sdk';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  PullRequestContext,
  ChangedFile,
  ReviewerCandidate,
  getChangedFiles,
  getDiff,
  getCommitHistoryForFiles,
  getRiskCriteria,
  getCodeowners,
  getPullRequestState,
  createCheckInProgress,
  completeCheck,
  failCheck,
  approvePullRequest,
  assignReviewers,
  postComment,
  dismissApprovals,
} from './github';

export type RiskLevel = 'Very Low' | 'Low' | 'Medium' | 'High';

const sm = new SecretsManagerClient({});
let secretsLoaded = false;

const loadSecrets = async (): Promise<void> => {
  if (secretsLoaded) return;
  const [appPrivateKey, anthropicApiKey] = await Promise.all([
    sm.send(new GetSecretValueCommand({ SecretId: process.env.APP_PRIVATE_KEY_NAME! })).then(r => r.SecretString ?? ''),
    sm.send(new GetSecretValueCommand({ SecretId: process.env.ANTHROPIC_API_KEY_NAME! })).then(r => r.SecretString ?? ''),
  ]);
  process.env.APP_PRIVATE_KEY = appPrivateKey;
  process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  secretsLoaded = true;
};

interface AssessmentResult {
  riskLevel: RiskLevel;
  reasoning: string;
  keyFiles: string[];
  reviewers: string[];
  action: string;
}


const buildPrompt = (
  ctx: PullRequestContext,
  riskCriteria: string,
  codeowners: string,
  files: ChangedFile[],
  diff: string,
  candidates: ReviewerCandidate[]
): string => `
You are the Agentic CODEOWNERS agent. Assess the risk of this PR and return a JSON response.

## PR Context
- Repository: ${ctx.owner}/${ctx.repo}
- PR Number: ${ctx.prNumber}
- Author: ${ctx.author}
- Head SHA: ${ctx.headSha}

## Risk Criteria (source of truth)
${riskCriteria || 'No CODEOWNERS-RISK.md found. Use your best judgement based on the files changed.'}

## CODEOWNERS
${codeowners || 'No CODEOWNERS file found.'}

## Changed Files (${files.length} total)
${files.map(f => `- ${f.path} (+${f.additions} -${f.deletions})`).join('\n')}

## Diff
\`\`\`
${diff.slice(0, 8000)}${diff.length > 8000 ? '\n... (diff truncated)' : ''}
\`\`\`

## Reviewer Candidates (by git history, last 6 months)
${candidates.length > 0
  ? candidates.map(c => `- @${c.username} (${c.commits} commits)`).join('\n')
  : 'No git history found for changed files. Use CODEOWNERS owners for affected paths.'}

## Instructions
Based on the risk criteria and changed files, determine the risk level and respond with a JSON object:

{
  "riskLevel": "Very Low" | "Low" | "Medium" | "High",
  "reasoning": "2-3 sentences explaining the risk level and which files drove the decision",
  "keyFiles": ["list", "of", "most", "relevant", "files"],
  "reviewers": ["github_username1", "github_username2"]
}

Rules:
- Very Low or Low: no reviewers needed (empty array)
- Medium: 1 reviewer
- High: 2 reviewers
- Never include the PR author (${ctx.author}) as a reviewer
- Choose reviewers from the candidates list mapped to GitHub usernames
- If no candidates available, use CODEOWNERS owners for the affected paths
- Return ONLY valid JSON, no markdown, no explanation outside the JSON
`.trim();

const parseAssessment = (response: string, candidates: ReviewerCandidate[], ctx: PullRequestContext): AssessmentResult => {
  const json = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(json);
  const riskLevel = parsed.riskLevel as RiskLevel;

  const reviewersNeeded = riskLevel === 'Medium' ? 1 : riskLevel === 'High' ? 2 : 0;
  const reviewers = parsed.reviewers?.length
    ? parsed.reviewers.filter((r: string) => r !== ctx.author).slice(0, reviewersNeeded)
    : candidates.map(c => c.username).filter(u => u !== ctx.author).slice(0, reviewersNeeded);

  const isAutoApproved = reviewersNeeded === 0;
  const action = isAutoApproved
    ? 'Auto-approved'
    : `${reviewersNeeded} reviewer(s) assigned: ${reviewers.map((r: string) => `@${r}`).join(', ')}`;

  return { riskLevel, reasoning: parsed.reasoning, keyFiles: parsed.keyFiles ?? [], reviewers, action };
};

const buildComment = (assessment: AssessmentResult): string => `
## Agentic CODEOWNERS Assessment

**Risk level:** ${assessment.riskLevel}
**Action:** ${assessment.action}

### Reasoning
${assessment.reasoning}

### Key files
${assessment.keyFiles.map(f => `- \`${f}\``).join('\n')}

### Reviewers
${assessment.reviewers.length > 0
  ? assessment.reviewers.map(r => `- @${r}`).join('\n')
  : 'none — PR auto-approved'}
`.trim();

// Lambda entry point — invoked async by the webhook handler
export const handler = async (event: { ctx: PullRequestContext; action: string }): Promise<void> => {
  await loadSecrets();
  await assess(event.ctx, event.action);
};

const assess = async (ctx: PullRequestContext, action: string): Promise<void> => {
  const checkRunId = await createCheckInProgress(ctx);

  try {
    await assessInner(ctx, action, checkRunId);
  } catch (err) {
    console.error('Assessment failed', err);
    await failCheck(ctx, checkRunId);
    throw err;
  }
};

const assessInner = async (ctx: PullRequestContext, action: string, checkRunId: number): Promise<void> => {
  const [files, riskCriteria, codeowners, { approvals, requestedReviewers }] = await Promise.all([
    getChangedFiles(ctx),
    getRiskCriteria(ctx),
    getCodeowners(ctx),
    getPullRequestState(ctx),
  ]);

  const [diff, candidates] = await Promise.all([
    getDiff(ctx),
    getCommitHistoryForFiles(ctx, files.map(f => f.path)),
  ]);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = buildPrompt(ctx, riskCriteria, codeowners, files, diff, candidates);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const assessment = parseAssessment(responseText, candidates, ctx);

  console.log(JSON.stringify({ ctx, assessment }));

  const isAutoApproved = assessment.reviewers.length === 0;
  const wasApproved = approvals.length > 0;

  if (action === 'synchronize' && wasApproved && !isAutoApproved) {
    await dismissApprovals(ctx);
  }

  const alreadyHasReviewers = requestedReviewers.length >= 2;

  const comment = buildComment(assessment);

  await Promise.all([
    completeCheck(ctx, checkRunId, assessment.riskLevel, comment),
    postComment(ctx, comment),
    alreadyHasReviewers
      ? Promise.resolve()
      : isAutoApproved && !wasApproved
        ? approvePullRequest(ctx, assessment.riskLevel)
        : assessment.reviewers.length > 0
          ? assignReviewers(ctx, assessment.reviewers)
          : Promise.resolve(),
  ]);
};

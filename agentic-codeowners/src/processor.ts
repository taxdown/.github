import Anthropic from '@anthropic-ai/sdk';
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
  createCheck,
  approvePullRequest,
  assignReviewers,
  postComment,
  dismissApprovals,
} from './github';

export type RiskLevel = 'Very Low' | 'Low' | 'Medium' | 'High';

interface AssessmentResult {
  riskLevel: RiskLevel;
  reasoning: string;
  keyFiles: string[];
  reviewers: string[];
  action: string;
}

const EMAIL_TO_GITHUB: Record<string, string> = {
  'fer@taxdown.es': 'Fernan-Ramos',
  'uriel@taxdown.es': 'UrielJavier',
  'raul@taxdown.es': 'rahernande96',
};

const resolveReviewers = (candidates: ReviewerCandidate[], author: string): string[] =>
  candidates
    .map(c => EMAIL_TO_GITHUB[c.email])
    .filter((username): username is string => Boolean(username) && username !== author);

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
  ? candidates.map(c => `- ${c.email} (${c.commits} commits)`).join('\n')
  : 'No git history found for changed files.'}

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
  const parsed = JSON.parse(response);
  const riskLevel = parsed.riskLevel as RiskLevel;

  const resolvedCandidates = resolveReviewers(candidates, ctx.author);
  const reviewersNeeded = riskLevel === 'Medium' ? 1 : riskLevel === 'High' ? 2 : 0;
  const reviewers = parsed.reviewers?.length
    ? parsed.reviewers.filter((r: string) => r !== ctx.author).slice(0, reviewersNeeded)
    : resolvedCandidates.slice(0, reviewersNeeded);

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

export const process = async (ctx: PullRequestContext, action: string): Promise<void> => {
  const [files, riskCriteria, codeowners, { approvals, requestedReviewers }] = await Promise.all([
    getChangedFiles(ctx),
    getRiskCriteria(ctx),
    getCodeowners(ctx),
    getPullRequestState(ctx),
  ]);

  if (requestedReviewers.length >= 2) {
    console.log('PR already has 2+ reviewers, skipping');
    return;
  }

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

  await Promise.all([
    createCheck(ctx, assessment.riskLevel, buildComment(assessment)),
    postComment(ctx, buildComment(assessment)),
    isAutoApproved && !wasApproved
      ? approvePullRequest(ctx, assessment.riskLevel)
      : assessment.reviewers.length > 0
        ? assignReviewers(ctx, assessment.reviewers)
        : Promise.resolve(),
  ]);
};

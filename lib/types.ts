export type Verdict =
  | 'Strongly test-ready'
  | 'Moderately test-ready'
  | 'Needs setup before contribution';

export type ContributorRecommendation =
  | 'Good first contribution candidate'
  | 'Active but requires onboarding effort'
  | 'Low contributor readiness'
  | 'Strong testing foundation'
  | 'Good candidate for TestSprite onboarding';

export type TestingMode =
  | 'Full codebase onboarding'
  | 'Diff-based validation candidate'
  | 'Frontend-focused testing'
  | 'Backend / API-focused testing'
  | 'General scripting / utility testing';

export type PRFocusType =
  | 'frontend-focused'
  | 'backend/API-focused'
  | 'mixed'
  | 'config/docs only';

export type TestSpriteScope =
  | 'Full codebase onboarding'
  | 'Diff-based validation';

// ── TestSprite workflow guidance ──────────────────────────────────────
export interface TestSpriteWorkflow {
  scope: TestSpriteScope;
  focusAreas: string[];
  reason: string;
  suggestedPrompt: string;
}

export interface TestspriteCompatibility {
  compatible: boolean;
  projectType: string | null;
}

// ── Core test/build signals (unchanged) ──────────────────────────────
export interface RepoSignals {
  readme: boolean;
  license: string | null;
  buildFile: string | null;
  projectType: string | null;
  testsFound: boolean;
  testDir: string | null;
  testFramework: string | null;
  recentActivity: boolean;
  daysSinceLastPush: number;
  testspriteCompatibility: TestspriteCompatibility;
  suggestedTestTargets: string[];
  testingMode: TestingMode;
}

// ── Repo health signals ───────────────────────────────────────────────
export interface RepoHealth {
  openIssues: number;
  openPullRequests: number;
  recentlyMergedPRs: number;       // merged in last 30 days
  contributorsCount: number;
  latestRelease: { tag: string; publishedAt: string } | null;
  defaultBranch: string;
}

// ── Contributor readiness signals ─────────────────────────────────────
export interface ContributorReadiness {
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasIssueTemplates: boolean;
  hasPRTemplate: boolean;
  goodFirstIssues: number;
  helpWantedIssues: number;
}

// ── Repo metadata ─────────────────────────────────────────────────────
export interface RepoMeta {
  name: string;
  owner: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  avatarUrl: string;
  pushedAt: string;
}

// ── PR analysis ───────────────────────────────────────────────────────
export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface PRMeta {
  number: number;
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PRAnalysis {
  meta: PRMeta;
  repoMeta: { fullName: string; avatarUrl: string };
  focusType: PRFocusType;
  changedAreas: string[];
  files: PRFile[];
  workflow: TestSpriteWorkflow;
  description: string;
  preflightHints: string[];
}

// ── Issue analysis ────────────────────────────────────────────────────
export type IssueWorkStatus =
  | 'Likely still open for contribution'
  | 'Someone is likely already working on this'
  | 'Probably already fixed / addressed'
  | 'Closed issue';

export type IssueRecommendation =
  | 'Good first contribution candidate'
  | 'Open but likely in progress'
  | 'Needs clarification before contributing'
  | 'Probably already addressed';

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueMeta {
  number: number;
  title: string;
  state: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
  labels: IssueLabel[];
  assignees: string[];
  milestone: string | null;
  body: string | null;
}

export interface IssueWorkStatusDetail {
  status: IssueWorkStatus;
  signals: string[];
}

export interface IssueQuality {
  isGoodFirstIssue: boolean;
  isHelpWanted: boolean;
  isBug: boolean;
  isEnhancement: boolean;
  hasReproductionSteps: boolean;
  hasExpectedVsActual: boolean;
  hasScreenshotsOrLogs: boolean;
  hasEnvironmentDetails: boolean;
  qualityScore: number;     // 0-5
  qualityLabel: string;     // 'Excellent' | 'Good' | 'Fair' | 'Poor'
}

export interface IssueAnalysis {
  meta: IssueMeta;
  repoMeta: { fullName: string; avatarUrl: string };
  workStatus: IssueWorkStatusDetail;
  quality: IssueQuality;
  recommendation: IssueRecommendation;
}

// ── Recent issue (for repo analysis) ─────────────────────────────────
export interface RecentIssue {
  number: number;
  title: string;
  state: string;
  labels: IssueLabel[];
  createdAt: string;
  url: string;
}

// ── Top-level repo result ─────────────────────────────────────────────
export interface AnalysisResult {
  meta: RepoMeta;
  signals: RepoSignals;
  health: RepoHealth;
  contributorReadiness: ContributorReadiness;
  score: number;
  maxScore: number;
  verdict: Verdict;
  recommendation: ContributorRecommendation;
  workflow: TestSpriteWorkflow;
  recentIssues: RecentIssue[];
}


export interface TestspriteCompatibility {
  compatible: boolean;
  projectType: string | null;
}

// ── Core test/build signals (unchanged) ──────────────────────────────
export interface RepoSignals {
  readme: boolean;
  license: string | null;
  buildFile: string | null;
  projectType: string | null;
  testsFound: boolean;
  testDir: string | null;
  testFramework: string | null;
  recentActivity: boolean;
  daysSinceLastPush: number;
  testspriteCompatibility: TestspriteCompatibility;
  suggestedTestTargets: string[];
  testingMode: TestingMode;
}

// ── Repo health signals ───────────────────────────────────────────────
export interface RepoHealth {
  openIssues: number;
  openPullRequests: number;
  recentlyMergedPRs: number;       // merged in last 30 days
  contributorsCount: number;
  latestRelease: { tag: string; publishedAt: string } | null;
  defaultBranch: string;
}

// ── Contributor readiness signals ─────────────────────────────────────
export interface ContributorReadiness {
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasIssueTemplates: boolean;
  hasPRTemplate: boolean;
  goodFirstIssues: number;
  helpWantedIssues: number;
}

// ── Repo metadata ─────────────────────────────────────────────────────
export interface RepoMeta {
  name: string;
  owner: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  avatarUrl: string;
  pushedAt: string;
}

// ── Top-level result ─────────────────────────────────────────────────
export interface AnalysisResult {
  meta: RepoMeta;
  signals: RepoSignals;
  health: RepoHealth;
  contributorReadiness: ContributorReadiness;
  score: number;
  maxScore: number;
  verdict: Verdict;
  recommendation: ContributorRecommendation;
}

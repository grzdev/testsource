import type { GithubContent, GithubPRFile, GithubIssueDetail, GithubIssueComment, GithubTimelineEvent } from './github';
import type {
  RepoSignals,
  RepoHealth,
  ContributorReadiness,
  Verdict,
  ContributorRecommendation,
  TestingMode,
  PRFocusType,
  TestSpriteWorkflow,
  TestSpriteScope,
  IssueWorkStatusDetail,
  IssueWorkStatus,
  IssueQuality,
  IssueRecommendation,
} from './types';

// -------------------------------------------------------------------
// Build file → project type mapping
// -------------------------------------------------------------------
const BUILD_FILES: Record<string, string> = {
  'package.json': 'Node',
  'pyproject.toml': 'Python',
  'setup.py': 'Python',
  'requirements.txt': 'Python',
  'go.mod': 'Go',
  'Cargo.toml': 'Rust',
  'pom.xml': 'Java',
  'build.gradle': 'Java',
  'build.gradle.kts': 'Java',
  'Gemfile': 'Ruby',
  'Makefile': 'C/C++',
  'CMakeLists.txt': 'C/C++',
  'mix.exs': 'Elixir',
  'composer.json': 'PHP',
  'pubspec.yaml': 'Dart',
};

// Project types confirmed compatible with TestSprite workflows
const TESTSPRITE_COMPATIBLE = new Set(['Node', 'Python', 'Go', 'Rust', 'Java', 'Ruby', 'PHP']);

// -------------------------------------------------------------------
// Test directory names
// -------------------------------------------------------------------
const TEST_DIRS = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs',
  'e2e', '__test__', 'testing',
]);

// -------------------------------------------------------------------
// Test framework config files (exact name or prefix match via *)
// -------------------------------------------------------------------
const TEST_FRAMEWORK_EXACT: Record<string, string> = {
  'pytest.ini': 'Pytest',
  'conftest.py': 'Pytest',
  'setup.cfg': 'Pytest',
  '.rspec': 'RSpec',
  'karma.conf.js': 'Karma',
  'mocha.opts': 'Mocha',
  '.mocharc.js': 'Mocha',
  '.mocharc.yml': 'Mocha',
  '.mocharc.json': 'Mocha',
};

// Prefix-based matches (file starts with prefix)
const TEST_FRAMEWORK_PREFIX: [string, string][] = [
  ['jest.config.', 'Jest'],
  ['vitest.config.', 'Vitest'],
  ['playwright.config.', 'Playwright'],
  ['cypress.config.', 'Cypress'],
];

// -------------------------------------------------------------------
// Folder name → suggested test target label
// -------------------------------------------------------------------
const TESTABLE_DIRS: Record<string, string> = {
  api: 'API routes',
  routes: 'API routes',
  handlers: 'API routes',
  controllers: 'Controllers',
  auth: 'Authentication flows',
  authentication: 'Authentication flows',
  middleware: 'Middleware',
  utils: 'Utility functions',
  helpers: 'Utility functions',
  lib: 'Library utilities',
  services: 'Service layer',
  models: 'Data models',
  validators: 'Input validation',
  validation: 'Input validation',
  db: 'Database interactions',
  database: 'Database interactions',
  hooks: 'React hooks',
  components: 'UI components',
  views: 'UI components',
  ui: 'UI components',
  store: 'State management',
  reducers: 'State management',
  actions: 'State management',
};

// -------------------------------------------------------------------
// Dirs that indicate frontend focus
// -------------------------------------------------------------------
const FRONTEND_DIRS = new Set(['components', 'pages', 'views', 'ui', 'app', 'hooks', 'styles']);
const BACKEND_DIRS = new Set(['api', 'routes', 'handlers', 'controllers', 'services', 'db', 'database', 'middleware']);

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function detectFramework(fileNames: string[]): string | null {
  for (const name of fileNames) {
    if (TEST_FRAMEWORK_EXACT[name]) return TEST_FRAMEWORK_EXACT[name];
    for (const [prefix, framework] of TEST_FRAMEWORK_PREFIX) {
      if (name.startsWith(prefix)) return framework;
    }
  }
  return null;
}

function detectBuildFile(fileNames: string[]): { file: string; type: string } | null {
  for (const name of fileNames) {
    if (BUILD_FILES[name]) return { file: name, type: BUILD_FILES[name] };
  }
  return null;
}

function detectTestDir(dirNames: string[]): string | null {
  for (const d of dirNames) {
    if (TEST_DIRS.has(d)) return d + '/';
  }
  return null;
}

function collectTestTargets(dirNames: string[]): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const d of dirNames) {
    const label = TESTABLE_DIRS[d.toLowerCase()];
    if (label && !seen.has(label)) {
      seen.add(label);
      targets.push(label);
    }
  }
  return targets;
}

function inferTestingMode(
  allDirs: string[],
  projectType: string | null,
  testFramework: string | null,
): TestingMode {
  const hasFrontend = allDirs.some(d => FRONTEND_DIRS.has(d));
  const hasBackend = allDirs.some(d => BACKEND_DIRS.has(d));

  if (testFramework === 'Playwright' || testFramework === 'Cypress') {
    return 'Frontend-focused testing';
  }
  if (hasFrontend && !hasBackend) return 'Frontend-focused testing';
  if (hasBackend && !hasFrontend) return 'Backend / API-focused testing';
  if (hasFrontend && hasBackend) return 'Full codebase onboarding';

  // Script/utility type projects
  if (projectType === 'Python' || projectType === 'Ruby' || projectType === 'Go') {
    return 'General scripting / utility testing';
  }

  return 'Diff-based validation candidate';
}

// -------------------------------------------------------------------
// Contributor readiness analysis (from root directory listing)
// -------------------------------------------------------------------
export function analyzeContributorFiles(
  rootContents: GithubContent[],
  githubDirContents: GithubContent[],
): Pick<ContributorReadiness, 'hasContributing' | 'hasCodeOfConduct' | 'hasIssueTemplates' | 'hasPRTemplate'> {
  const rootFiles = rootContents.map(c => c.name.toUpperCase());
  const rootDirs = rootContents.filter(c => c.type === 'dir').map(c => c.name.toLowerCase());
  const githubFiles = githubDirContents.map(c => c.name.toUpperCase());

  const hasContributing =
    rootFiles.some(f => f.startsWith('CONTRIBUTING')) ||
    githubFiles.some(f => f.startsWith('CONTRIBUTING'));

  const hasCodeOfConduct =
    rootFiles.some(f => f.startsWith('CODE_OF_CONDUCT')) ||
    githubFiles.some(f => f.startsWith('CODE_OF_CONDUCT'));

  // Issue templates live in .github/ISSUE_TEMPLATE/
  const hasIssueTemplates =
    githubDirContents.some(c => c.name.toLowerCase() === 'issue_template') ||
    githubDirContents.some(c => c.name.toUpperCase().startsWith('ISSUE_TEMPLATE'));

  // PR template can be PULL_REQUEST_TEMPLATE.md in root or .github/
  const hasPRTemplate =
    rootFiles.some(f => f.startsWith('PULL_REQUEST_TEMPLATE')) ||
    githubFiles.some(f => f.startsWith('PULL_REQUEST_TEMPLATE'));

  return { hasContributing, hasCodeOfConduct, hasIssueTemplates, hasPRTemplate };
}

// -------------------------------------------------------------------
// Main content analysis
// -------------------------------------------------------------------
export function analyzeContents(
  rootContents: GithubContent[],
  srcContents: GithubContent[],
  daysSinceLastPush: number,
): Omit<RepoSignals, 'readme' | 'license'> {
  const fileNames = rootContents.filter(c => c.type === 'file').map(c => c.name);
  const dirNames = rootContents.filter(c => c.type === 'dir').map(c => c.name.toLowerCase());

  const srcFileNames = srcContents.filter(c => c.type === 'file').map(c => c.name);
  const srcDirNames = srcContents.filter(c => c.type === 'dir').map(c => c.name.toLowerCase());

  // Build file
  const buildMatch = detectBuildFile(fileNames);
  const buildFile = buildMatch?.file ?? null;
  const projectType = buildMatch?.type ?? null;

  // Test framework — check root and src
  const testFramework = detectFramework(fileNames) ?? detectFramework(srcFileNames);

  // Test directory — root first, then src/
  let testDir = detectTestDir(dirNames);
  if (!testDir) {
    const sub = detectTestDir(srcDirNames);
    if (sub) testDir = 'src/' + sub;
  }

  // Tests found if a test dir OR framework config is present
  const testsFound = testDir !== null || testFramework !== null;

  // Recent activity
  const recentActivity = daysSinceLastPush <= 90;

  // TestSprite compatibility
  const testspriteCompatibility = {
    compatible: projectType !== null && TESTSPRITE_COMPATIBLE.has(projectType),
    projectType,
  };

  // Suggested test targets — combine root + src dirs
  const allDirs = [...dirNames, ...srcDirNames];
  const suggestedTestTargets = collectTestTargets(allDirs);

  // Testing mode
  const testingMode = inferTestingMode(allDirs, projectType, testFramework ?? null);

  return {
    buildFile,
    projectType,
    testsFound,
    testDir,
    testFramework,
    recentActivity,
    daysSinceLastPush,
    testspriteCompatibility,
    suggestedTestTargets,
    testingMode,
  };
}

// -------------------------------------------------------------------
// Scoring
// -------------------------------------------------------------------
export function computeScore(
  signals: RepoSignals,
): { score: number; maxScore: number; verdict: Verdict } {
  const MAX_SCORE = 10;
  let score = 0;

  if (signals.readme) score += 2;
  if (signals.license) score += 2;
  if (signals.buildFile) score += 2;
  if (signals.testsFound) score += 3;
  if (signals.recentActivity) score += 1;

  // Hard override: no tests AND no build file → always weakest verdict
  if (!signals.testsFound && !signals.buildFile) {
    return { score, maxScore: MAX_SCORE, verdict: 'Needs setup before contribution' };
  }

  let verdict: Verdict;
  if (score >= 8) verdict = 'Strongly test-ready';
  else if (score >= 5) verdict = 'Moderately test-ready';
  else verdict = 'Needs setup before contribution';

  return { score, maxScore: MAX_SCORE, verdict };
}

// -------------------------------------------------------------------
// Contributor recommendation
// -------------------------------------------------------------------
export function computeRecommendation(
  signals: RepoSignals,
  health: RepoHealth,
  contributor: ContributorReadiness,
): ContributorRecommendation {
  const { testsFound, recentActivity, testspriteCompatibility } = signals;
  const { hasContributing, hasCodeOfConduct, goodFirstIssues, hasIssueTemplates } = contributor;
  const { recentlyMergedPRs, contributorsCount } = health;

  const isWelcoming = hasContributing && (hasCodeOfConduct || hasIssueTemplates);
  const isActive = recentActivity && recentlyMergedPRs > 0;
  const hasGoodFirstIssues = goodFirstIssues > 0;

  if (testsFound && testspriteCompatibility.compatible && isActive) {
    return 'Good candidate for TestSprite onboarding';
  }
  if (testsFound && signals.testFramework) {
    return 'Strong testing foundation';
  }
  if (isWelcoming && isActive && hasGoodFirstIssues) {
    return 'Good first contribution candidate';
  }
  if (isActive && contributorsCount > 5) {
    return 'Active but requires onboarding effort';
  }
  return 'Low contributor readiness';
}

// -------------------------------------------------------------------
// File path classifiers for PR analysis
// -------------------------------------------------------------------
const FRONTEND_EXTS = new Set(['.tsx', '.jsx', '.css', '.scss', '.sass', '.less', '.html', '.vue', '.svelte']);
const BACKEND_EXTS = new Set(['.go', '.py', '.rb', '.java', '.rs', '.php', '.cs']);
const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.cfg']);
const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst']);

const FRONTEND_PATH_SEGMENTS = new Set([
  'components', 'pages', 'views', 'ui', 'styles', 'hooks', 'assets',
  'public', 'static', 'client', 'frontend',
]);
const BACKEND_PATH_SEGMENTS = new Set([
  'api', 'routes', 'handlers', 'controllers', 'services', 'db', 'database',
  'middleware', 'server', 'backend', 'workers', 'jobs', 'tasks',
]);

function fileExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function topSegment(filename: string): string {
  return filename.split('/')[0].toLowerCase();
}

function classifyFile(filename: string): 'frontend' | 'backend' | 'config' | 'doc' | 'test' | 'other' {
  const lower = filename.toLowerCase();
  const ext = fileExt(filename);
  const seg = topSegment(filename);

  if (lower.includes('/test') || lower.includes('/spec') || lower.includes('__tests__') ||
      lower.endsWith('.test.ts') || lower.endsWith('.test.js') || lower.endsWith('.spec.ts') ||
      lower.endsWith('.spec.js')) return 'test';
  if (DOC_EXTS.has(ext)) return 'doc';
  if (CONFIG_EXTS.has(ext) && !BACKEND_EXTS.has(ext)) return 'config';
  if (FRONTEND_EXTS.has(ext) || FRONTEND_PATH_SEGMENTS.has(seg)) return 'frontend';
  if (BACKEND_EXTS.has(ext) || BACKEND_PATH_SEGMENTS.has(seg)) return 'backend';
  // .ts/.js can be either — decide by path
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    if (BACKEND_PATH_SEGMENTS.has(seg)) return 'backend';
    if (FRONTEND_PATH_SEGMENTS.has(seg)) return 'frontend';
  }
  return 'other';
}

export function classifyPR(files: GithubPRFile[]): {
  focusType: PRFocusType;
  changedAreas: string[];
} {
  let fe = 0, be = 0, cfg = 0, doc = 0;
  const areaSet = new Set<string>();

  for (const f of files) {
    const kind = classifyFile(f.filename);
    if (kind === 'frontend') { fe++; }
    else if (kind === 'backend') { be++; }
    else if (kind === 'config') { cfg++; }
    else if (kind === 'doc') { doc++; }

    // Collect changed area labels
    const seg = topSegment(f.filename);
    const area = TESTABLE_DIRS[seg];
    if (area) areaSet.add(area);
  }

  const total = files.length || 1;
  const feRatio = fe / total;
  const beRatio = be / total;
  // 'config/docs only' ONLY when there are literally no frontend or backend source files
  // AND no 'other' typed files (which catches .ts/.js that didn't match a known segment).
  // Test files always count as real source work.
  const srcCount = files.filter(f => {
    const k = classifyFile(f.filename);
    return k === 'frontend' || k === 'backend' || k === 'test' || k === 'other';
  }).length;
  const onlyConfigDoc = srcCount === 0 && (cfg + doc) > 0;

  let focusType: PRFocusType;
  if (onlyConfigDoc) focusType = 'config/docs only';
  else if (feRatio >= 0.6 && beRatio < 0.2) focusType = 'frontend-focused';
  else if (beRatio >= 0.6 && feRatio < 0.2) focusType = 'backend/API-focused';
  else focusType = 'mixed';

  return { focusType, changedAreas: Array.from(areaSet) };
}

// -------------------------------------------------------------------
// TestSprite workflow builder — repo mode
// -------------------------------------------------------------------
export function buildRepoWorkflow(
  signals: RepoSignals,
  repoFullName: string,
): TestSpriteWorkflow {
  const { testingMode, suggestedTestTargets, testFramework, testspriteCompatibility } = signals;

  let scope: TestSpriteScope;
  if (testingMode === 'Diff-based validation candidate') {
    scope = 'Diff-based validation';
  } else {
    scope = 'Full codebase onboarding';
  }

  const focusAreas = suggestedTestTargets.length > 0
    ? suggestedTestTargets.slice(0, 5)
    : ['core application logic', 'critical paths'];

  const frameworkNote = testFramework ? `, targeting the existing ${testFramework} setup` : '';
  const projectNote = testspriteCompatibility.projectType
    ? ` for this ${testspriteCompatibility.projectType} project`
    : '';

  let reason: string;
  if (scope === 'Full codebase onboarding') {
    reason = `The repo has an identifiable project structure${projectNote}. Full codebase onboarding will give TestSprite the context it needs to generate meaningful tests${frameworkNote}.`;
  } else {
    reason = `No clear src structure was detected. Diff-based validation is recommended so TestSprite focuses on the actual changes rather than scanning the whole codebase.`;
  }

  const focusStr = focusAreas.length > 0
    ? focusAreas.join(', ')
    : 'core functionality';

  let suggestedPrompt: string;
  if (scope === 'Full codebase onboarding') {
    suggestedPrompt = `Can you test this project with TestSprite and focus on ${focusStr}?`;
  } else {
    suggestedPrompt = `Can you run diff-based validation for this project with TestSprite, focusing on ${focusStr} and error handling?`;
  }

  return { scope, focusAreas, reason, suggestedPrompt };
}

// -------------------------------------------------------------------
// TestSprite workflow builder — PR mode
// -------------------------------------------------------------------
export function buildPRWorkflow(
  focusType: PRFocusType,
  changedAreas: string[],
  prTitle: string,
): TestSpriteWorkflow {
  const scope: TestSpriteScope = 'Diff-based validation';

  const defaultAreas: Record<PRFocusType, string[]> = {
    'frontend-focused': ['UI components', 'user interactions', 'visual regressions'],
    'backend/API-focused': ['API routes', 'input validation', 'error handling'],
    'mixed': ['API routes', 'UI components', 'integration points'],
    'config/docs only': ['configuration correctness', 'documented behavior'],
  };

  const focusAreas = changedAreas.length > 0
    ? changedAreas.slice(0, 4)
    : defaultAreas[focusType];

  const reason = focusType === 'config/docs only'
    ? 'This PR only modifies configuration or documentation. Consider validating that documented behavior still holds.'
    : `This PR is ${focusType}. Diff-based validation lets TestSprite focus precisely on the changed code paths without rescanning the full codebase.`;

  const focusStr = focusAreas.join(', ');
  const suggestedPrompt = `Can you run diff-based validation using TestSprite on this PR and focus on ${focusStr}?`;

  return { scope, focusAreas, reason, suggestedPrompt };
}

// -------------------------------------------------------------------
// Preflight hints — detect package manager from build file + filenames
// -------------------------------------------------------------------
export function inferPreflightHints(
  buildFile: string | null,
  projectType: string | null,
  filenames: string[] = [],
): string[] {
  const bases = filenames.map(f => f.split('/').pop()?.toLowerCase() ?? '');
  const bf = (buildFile ?? '').toLowerCase();
  const pt = (projectType ?? '').toLowerCase();

  // Detect Node.js
  if (pt.includes('node') || bf === 'package.json') {
    let mgr = 'npm';
    if (bases.includes('pnpm-lock.yaml') || bf.includes('pnpm')) mgr = 'pnpm';
    else if (bases.includes('yarn.lock') || bf.includes('yarn')) mgr = 'yarn';
    return [
      'Node.js project detected',
      `Install dependencies: ${mgr} install`,
      `Run tests: ${mgr} test`,
      `Start dev server: ${mgr} dev`,
    ];
  }

  // Python
  if (pt.includes('python') || bases.includes('requirements.txt') || bases.includes('pyproject.toml')) {
    const installCmd = bases.includes('pyproject.toml') ? 'pip install -e .' : 'pip install -r requirements.txt';
    return [
      'Python project detected',
      `Install dependencies: ${installCmd}`,
      'Run tests: pytest',
      'Start the application before testing',
    ];
  }

  // Go
  if (pt.includes('go') || bases.includes('go.mod')) {
    return [
      'Go project detected',
      'Install dependencies: go mod download',
      'Run tests: go test ./...',
      'Build: go build',
    ];
  }

  // Ruby
  if (pt.includes('ruby') || bases.includes('gemfile') || bases.includes('gemfile.lock')) {
    return [
      'Ruby project detected',
      'Install dependencies: bundle install',
      'Run tests: bundle exec rspec',
      'Start server: rails s or similar',
    ];
  }

  // Rust
  if (pt.includes('rust') || bases.includes('cargo.toml')) {
    return [
      'Rust project detected',
      'Fetch and build: cargo build',
      'Run tests: cargo test',
    ];
  }

  // Java / Maven
  if (bf === 'pom.xml') {
    return [
      'Java/Maven project detected',
      'Install dependencies: mvn install',
      'Run tests: mvn test',
    ];
  }

  // Gradle
  if (bf === 'build.gradle' || bf === 'build.gradle.kts') {
    return [
      'Java/Kotlin Gradle project detected',
      'Build: ./gradlew build',
      'Run tests: ./gradlew test',
    ];
  }

  // Generic fallback
  return [
    'Clone the repository locally',
    'Install project dependencies',
    'Configure environment variables',
    'Start the application before testing',
  ];
}

// -------------------------------------------------------------------
// PR description generator — derives a plain-English summary
// -------------------------------------------------------------------
export function generatePRDescription(
  title: string,
  focusType: PRFocusType,
  filenames: string[],
): string {
  const cc = /^(feat|fix|chore|build|ci|docs|refactor|test|perf|style|revert)(\([\w/.-]+\))?(!)?:\s*/i;
  const m = title.match(cc);
  const ctype = m?.[1]?.toLowerCase() ?? '';
  const scope = m?.[2]?.replace(/[()]/g, '') ?? null;

  const verbMap: Record<string, string> = {
    feat: 'adds a new feature',
    fix: 'fixes a bug',
    chore: 'performs maintenance or cleanup work',
    build: 'updates build or dependency configuration',
    ci: 'updates CI/CD pipeline configuration',
    docs: 'updates documentation',
    refactor: 'refactors existing code without changing behavior',
    test: 'adds or updates test coverage',
    perf: 'improves performance',
    style: 'applies code formatting or style changes',
    revert: 'reverts a previous change',
  };

  const verb = ctype && verbMap[ctype] ? verbMap[ctype] : 'makes changes to the codebase';
  const scopePart = scope ? ` in the ${scope} area` : '';

  const focusSentence: Record<PRFocusType, string> = {
    'frontend-focused': ' affecting frontend code and UI components.',
    'backend/API-focused': ' affecting server-side logic and API endpoints.',
    'config/docs only': ' limited to configuration or documentation files.',
    'mixed': ' across both frontend and backend code.',
  };

  let impact = '';
  if (focusType === 'config/docs only') {
    impact = ' Low risk update.';
  } else if (filenames.some(f => f.includes('test') || f.includes('spec') || f.includes('__tests__'))) {
    impact = ' Includes test coverage for the changes.';
  } else if (focusType === 'frontend-focused') {
    impact = ' May affect UI rendering or user-facing behavior.';
  } else if (focusType === 'backend/API-focused') {
    impact = ' May affect API behavior or server-side logic.';
  } else {
    impact = ' Review for potential regressions across both layers.';
  }

  return `This pull request ${verb}${scopePart}${focusSentence[focusType]}${impact}`;
}

// -------------------------------------------------------------------
// Issue work-status analysis
// -------------------------------------------------------------------

// Patterns that indicate someone is claiming/working on the issue
const CLAIMING_PATTERNS = [
  /\b(i'?m?\s+working|i will\s+(work|fix|take|pick)|i'?ll?\s+(fix|take|pick|work)|taking this|i can\s+(fix|take|work|do)|can i\s+(take|work on|fix)|i'?d?\s+(like to|want to)\s+(fix|take|work|pick)|assigned to me|working on (a |this )?fix|started working|i've\s+(started|begun)|picking this up|got this|on it)\b/i,
  /\b(pr (is )?(inbound|coming|open)|submitted a pr|raised a pr|opened a pr|sent a pr|created a pr)\b/i,
];

// Patterns that suggest the issue is already resolved or addressed
const RESOLVED_PATTERNS = [
  /\b(fixed in|resolved in|addressed in|done in|merged in|closed (by|via|in)|this (should|is|was) (now )?fixed|should be fixed|this is fixed|no longer (an issue|repro)|can('t| not) repro(duce)? (now|anymore|this))\b/i,
  /\b(released in|available in|shipped in|part of)\s+v?\d/i,
];

// Patterns that suggest a linked fix PR through text
const LINKED_PR_TEXT_PATTERNS = [
  /\bfix(es|ed)?\s+#\d+/i,
  /\bclos(es|ed)?\s+#\d+/i,
  /\bresolv(es|ed)?\s+#\d+/i,
  /\baddress(es|ed)?\s+#\d+/i,
];

export function analyzeIssueWorkStatus(
  issue: GithubIssueDetail,
  comments: GithubIssueComment[],
  timeline: GithubTimelineEvent[],
): IssueWorkStatusDetail {
  const signals: string[] = [];

  // 1. Closed issue — definitive
  if (issue.state === 'closed') {
    signals.push('Issue is closed');
    if (issue.closed_at) {
      const daysAgo = Math.floor(
        (Date.now() - new Date(issue.closed_at).getTime()) / 86400000,
      );
      signals.push(`Closed ${daysAgo} days ago`);
    }
    return { status: 'Closed issue', signals };
  }

  let likelyWorking = false;
  let likelyFixed = false;

  // 2. Assignees
  if (issue.assignees && issue.assignees.length > 0) {
    const names = issue.assignees.map(a => a.login).join(', ');
    signals.push(`Assigned to: ${names}`);
    likelyWorking = true;
  }

  // 3. Linked PR via timeline (cross-reference or connected event)
  let linkedPRFound = false;
  for (const ev of timeline) {
    if (ev.event === 'cross-referenced' && ev.source?.issue?.pull_request) {
      const pr = ev.source.issue.pull_request;
      if (pr.merged_at) {
        signals.push('Referenced by a merged pull request');
        likelyFixed = true;
      } else {
        signals.push('Referenced by an open pull request');
        likelyWorking = true;
      }
      linkedPRFound = true;
    }
    if (ev.event === 'connected') {
      signals.push('Linked to a pull request via GitHub');
      likelyWorking = true;
      linkedPRFound = true;
    }
  }

  // 4. Comment body analysis
  let claimCount = 0;
  let resolvedCount = 0;
  for (const comment of comments) {
    const body = comment.body ?? '';
    if (CLAIMING_PATTERNS.some(p => p.test(body))) {
      claimCount++;
    }
    if (RESOLVED_PATTERNS.some(p => p.test(body))) {
      resolvedCount++;
    }
    if (LINKED_PR_TEXT_PATTERNS.some(p => p.test(body))) {
      if (!linkedPRFound) {
        signals.push('Comment references a linked PR');
        likelyFixed = true;
        linkedPRFound = true;
      }
    }
  }

  if (claimCount > 0) {
    signals.push(
      claimCount === 1
        ? 'A contributor mentioned they are working on this'
        : `${claimCount} contributors mentioned working on this`,
    );
    likelyWorking = true;
  }
  if (resolvedCount > 0) {
    signals.push('Comments suggest the issue may already be resolved');
    likelyFixed = true;
  }

  // 5. Issue body itself referencing a PR
  if (issue.body) {
    if (LINKED_PR_TEXT_PATTERNS.some(p => p.test(issue.body!))) {
      if (!linkedPRFound) {
        signals.push('Issue body references a linked PR');
        likelyFixed = true;
      }
    }
  }

  // 6. High comment count heuristic (active discussion → likely being worked on)
  if (issue.comments >= 10 && !likelyWorking && !likelyFixed) {
    signals.push(`${issue.comments} comments — active discussion`);
    likelyWorking = true;
  }

  if (signals.length === 0) {
    signals.push('No assignees or linked pull requests detected');
    signals.push('No comments indicating active work');
  }

  let status: IssueWorkStatus;
  if (likelyFixed) status = 'Probably already fixed / addressed';
  else if (likelyWorking) status = 'Someone is likely already working on this';
  else status = 'Likely still open for contribution';

  return { status, signals };
}

// -------------------------------------------------------------------
// Issue quality analysis
// -------------------------------------------------------------------
export function analyzeIssueQuality(issue: GithubIssueDetail): IssueQuality {
  const labelNames = issue.labels.map(l => l.name.toLowerCase());
  const body = (issue.body ?? '').toLowerCase();

  const isGoodFirstIssue = labelNames.some(l =>
    l.includes('good first issue') || l.includes('good-first-issue') || l.includes('beginner') || l.includes('starter'),
  );
  const isHelpWanted = labelNames.some(l =>
    l.includes('help wanted') || l.includes('help-wanted'),
  );
  const isBug = labelNames.some(l => l.includes('bug') || l.includes('defect') || l.includes('regression'));
  const isEnhancement = labelNames.some(l =>
    l.includes('enhancement') || l.includes('feature') || l.includes('feat') || l.includes('improvement'),
  );

  // Body signal detection
  const hasReproductionSteps =
    /\b(steps to repro(duce)?|reproduction steps|how to repro(duce)?|to reproduce|repro:)\b/.test(body) ||
    /\b(step\s+[1-9]|1\.|1\))\s/.test(body);

  const hasExpectedVsActual =
    /\b(expected\s+(behavior|result|output)|actual\s+(behavior|result|output)|expected vs\.?\s+actual)\b/.test(body) ||
    /\b(should\s+(be|do|show|return|work)|instead (it|the app)|but (it|the app|instead))\b/.test(body);

  const hasScreenshotsOrLogs =
    /\b(screenshot|screen shot|screencap|console (log|output)|error log|stack trace|traceback|```)\b/.test(body) ||
    /!\[.*\]\(/.test(body); // markdown image

  const hasEnvironmentDetails =
    /\b(os:|operating system:|version:|node version:|npm version:|chrome version:|browser:|platform:|environment:|runtime:|v\d+\.\d+)\b/.test(body);

  // Quality score 0-5
  let qualityScore = 0;
  if (hasReproductionSteps) qualityScore++;
  if (hasExpectedVsActual) qualityScore++;
  if (hasScreenshotsOrLogs) qualityScore++;
  if (hasEnvironmentDetails) qualityScore++;
  if (isGoodFirstIssue || isHelpWanted) qualityScore++;

  const qualityLabel =
    qualityScore >= 4 ? 'Excellent' :
    qualityScore >= 3 ? 'Good' :
    qualityScore >= 2 ? 'Fair' : 'Poor';

  return {
    isGoodFirstIssue,
    isHelpWanted,
    isBug,
    isEnhancement,
    hasReproductionSteps,
    hasExpectedVsActual,
    hasScreenshotsOrLogs,
    hasEnvironmentDetails,
    qualityScore,
    qualityLabel,
  };
}

// -------------------------------------------------------------------
// Issue final recommendation
// -------------------------------------------------------------------
export function computeIssueRecommendation(
  workStatus: IssueWorkStatusDetail,
  quality: IssueQuality,
  issue: GithubIssueDetail,
): IssueRecommendation {
  if (issue.state === 'closed') return 'Probably already addressed';
  if (workStatus.status === 'Probably already fixed / addressed') return 'Probably already addressed';
  if (workStatus.status === 'Someone is likely already working on this') return 'Open but likely in progress';
  // Open + nobody working
  if (quality.qualityScore <= 1 && !quality.isGoodFirstIssue && !quality.isHelpWanted) {
    return 'Needs clarification before contributing';
  }
  return 'Good first contribution candidate';
}


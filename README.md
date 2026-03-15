# TestSource 

**TestSource** is a GitHub intelligence tool that analyzes any public repository, pull request, or issue and instantly tells you whether it is ready to test — and exactly how to test it with [TestSprite](https://testsprite.com).

Paste a GitHub link. Get a structured, signal-driven report in seconds.

---

## Demo

🌐 **Live App:** https://testsource.netlify.app/

---

## Why TestSource

Open-source contributors often struggle to determine whether a repository is ready to test or contribute to. Important signals like contributor guidelines, project health, issue readiness, and testing setup are scattered across the repository.

TestSource solves this by analyzing a GitHub repository, pull request, or issue and generating a structured report that helps developers quickly decide:

- Is this project healthy and active?
- Is it ready for testing?
- What parts should be tested?
- What TestSprite workflow should I use?

This reduces the time required to evaluate a project from **minutes of manual exploration to seconds**.

---

## What It Does

TestSource accepts three types of GitHub URLs and returns a tailored report for each:

### Repository Analysis
Paste a repo URL (e.g. `github.com/vercel/next.js`) to receive:
- **Repo Health** — open issues, open PRs, recently merged PRs, contributor count, latest release
- **Contributor Readiness** — presence of `CONTRIBUTING.md`, issue/PR templates, Code of Conduct, good-first-issue labels
- **Pre-flight Checklist** — README, license, build file, test directory, test framework detection
- **TestSprite Readiness** — project type detection, compatibility score, suggested testing mode, target modules
- **Recommended TestSprite Workflow** — scope (full onboarding vs. diff-based), focus areas, and a ready-to-copy TestSprite prompt
- **Overall Verdict** — `Strongly test-ready`, `Moderately test-ready`, or `Needs setup before contribution`

### Pull Request Analysis
Paste a PR URL (e.g. `github.com/pnpm/pnpm/pull/10920`) to receive:
- PR metadata (author, branches, additions/deletions, changed files)
- Diff scope classification — frontend-focused, backend/API-focused, mixed, or config/docs only
- Changed areas and impacted modules
- Recommended TestSprite workflow scoped to the diff

### Issue Analysis
Paste an issue URL (e.g. `github.com/facebook/react/issues/28779`) to receive:
- Issue status and quality signals
- Work-status detection — whether someone is already working on it (assignment, recent comments, linked PRs)
- Contributor signals — complexity estimate, next recommended action
- Issue quality score and recommendation

---

## Key User Flow

1. Open the app and select a mode: **Repo**, **Pull Request**, or **Issue**
2. Paste a valid GitHub URL into the input field
3. The app detects the link type, validates it, and calls the appropriate analysis API
4. A structured report card renders with color-coded signals (pass / warn / fail)
5. Copy the generated TestSprite prompt and run it directly in TestSprite

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| API routes | Next.js Route Handlers (`/api/analyze`, `/api/analyze-pr`, `/api/analyze-issue`) |
| Data source | GitHub REST API (public, unauthenticated or token-authenticated) |
| Test runner | Node.js microservice (`runner-api/`) deployed on Railway |
| E2E tests | Playwright + TestSprite (generated test suite in `testsprite_tests/`) |

---

## Project Structure

```
app/
  page.tsx              # Landing page with mode selector and report rendering
  api/
    analyze/            # Repo analysis endpoint
    analyze-pr/         # Pull request analysis endpoint
    analyze-issue/      # Issue analysis endpoint
    testsprite/         # TestSprite job dispatch endpoint
components/
  ReportCard.tsx        # Repo report card
  PRReportCard.tsx      # PR report card
  IssueReportCard.tsx   # Issue report card
  RepoHealthSection.tsx # Health signals panel
  ContributorSection.tsx# Contributor readiness panel
  PreflightChecklist.tsx# Pre-flight checklist panel
  TestSpriteSection.tsx # TestSprite readiness panel
  WorkflowSection.tsx   # Recommended workflow + copy-prompt panel
  VerdictBadge.tsx      # Verdict label component
lib/
  github.ts             # GitHub API client helpers
  scoring.ts            # Signal detection and scoring logic
  types.ts              # Shared TypeScript types
  jobs.ts               # TestSprite job management
runner-api/             # Standalone Node.js runner for executing Playwright tests
testsprite_tests/       # Generated TestSprite/Playwright test cases
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A GitHub personal access token (optional, but avoids rate limits)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file in the project root:

```env
GITHUB_TOKEN=your_github_pat_here        # Optional — increases API rate limit
RUNNER_API_URL=http://localhost:4000     # URL of the runner-api service
```

### Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## TestSprite Tests

The `testsprite_tests/` folder contains the full Playwright test suite generated by TestSprite, covering:

- Successful repo analysis rendering all report card sections
- Workflow and pre-flight checklist section presence
- Invalid URL validation errors
- Non-existent repo / PR / issue 404 handling
- PR mode and Issue mode report rendering
- Tab switching and mode-state clearing behavior

Tests are written in Python using `playwright.async_api` and can be run directly with Playwright or through the TestSprite runner.

---

## License

MIT

---

## TestSprite Account

TestSprite email used for this project: **damilolaoyeniyi13@gmail.com**

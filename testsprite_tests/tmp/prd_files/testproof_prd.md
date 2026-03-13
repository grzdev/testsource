# TestProof Product Specification

## Overview
TestProof analyzes GitHub repositories, pull requests, and issues to help developers determine contributor readiness and testing priorities.

## Core Features

### Repository Analysis
Users can paste a GitHub repository URL.  
The system analyzes:

- repository health
- contributor readiness
- testing structure
- project activity

### Pull Request Analysis
Users can paste a PR link.  
The system analyzes:

- files changed
- PR focus (frontend/backend/config)
- potential testing areas

### Issue Analysis
Users can paste an issue link.  
The system analyzes:

- issue status
- contributor signals
- whether someone is already working on it
- issue quality

## Expected Behavior

The application should:

- accept valid GitHub URLs
- detect repo / PR / issue automatically
- fetch data from GitHub API
- render structured reports
- show error states for invalid URLs
- show loading states during analysis

## Key User Flow

1. User pastes a GitHub link
2. App detects link type
3. App calls internal API routes
4. Results render in report cards
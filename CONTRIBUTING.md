# Contributing to Deprompt

Thank you for your interest in contributing to **Deprompt**. This document outlines how to participate effectively and keep the project maintainable.

## Before You Start

1. **Check existing issues and PRs**  
   Look through open and closed pull requests to avoid duplicating work. If someone is already working on something similar, consider joining the discussion instead of opening a new PR.

2. **PRs must reference an existing issue**  
   Every pull request must be linked to a corresponding issue.  
   If no suitable issue exists, open one first and describe the problem or feature request clearly.

## Development Setup

1. Clone the repository

```sh
git clone https://github.com/timknappe/deprompt.git
cd deprompt
```

2. Install dependencies

```sh
npm install
```

3. Build extension for browser testing

```sh
npm run build
```

### Build Output

The build system produces a bundle:

```
/dist-v3
```

You can now load the extension in your browser of choice and start working and testing changes.

## Guidelines

Follow the existing code style and structure.

Keep PRs focused, single-purpose changes are easier to review.

Include tests or example scenarios when possible.

Document new functionality when it affects user behavior or configuration.

Avoid mixing unrelated refactors with feature work.

## Review

PRs without linked issues will be closed.

### Thanks!

Your contributions help make Deprompt better for everyone.
We appreciate your time, effort, and ideas!

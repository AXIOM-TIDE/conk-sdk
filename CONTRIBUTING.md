# Contributing to @axiomtide/conk-sdk

## Setup

```bash
git clone https://github.com/AXIOM-TIDE/conk-sdk
cd conk-sdk
npm install
npm test
```

## Branch naming

```
feat/your-feature
fix/what-you-fixed
chore/maintenance-task
```

## Before opening a PR

- `npm test` passes with no new failures
- New behaviour has test coverage
- Update CHANGELOG.md under `[Unreleased]`
- No `console.log` left in source files

## Versioning

We follow [Semantic Versioning](https://semver.org):

- **Patch** `0.1.x` — bug fixes, no API changes
- **Minor** `0.x.0` — new features, backwards compatible
- **Major** `x.0.0` — breaking API changes

## Reporting bugs

Open an issue at [github.com/AXIOM-TIDE/conk-sdk/issues](https://github.com/AXIOM-TIDE/conk-sdk/issues) with:
- SDK version (`npm list @axiomtide/conk-sdk`)
- Node version (`node -v`)
- Minimal reproduction
- Expected vs actual behaviour

## Questions

Reach out at jauert@axiomtide.com or open a discussion on GitHub.

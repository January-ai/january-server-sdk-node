# Maintainer release checklist

The package is distributed through npm as `@january-ai/server`, with typed ESM and
CommonJS entry points. Repository visibility is separate from npm distribution;
release tooling never changes GitHub visibility.

1. Review CI on Linux, macOS and Windows and the installed-package consumers.
2. Choose a semantic version and update `package.json` and the lockfile. Remove
   the package's `private` publishing guard only when publishing is approved.
3. Tag the approved commit `v<version>` and push the tag. The release workflow
   validates the version and explicit opt-in, tests and packs the package, and
   creates a **draft** GitHub release with the exact tarball for review.
4. Download that reviewed tarball and publish it with an authorized npm identity:
   `npm publish ./january-ai-server-<version>.tgz --access public`.
5. Verify installation from npm before publishing the GitHub release notes.

This workflow does not publish to npm automatically. No registry credentials belong
in the repository or example `.env` files. The optional `sharp` peer is needed only
by developers using the Node-only `/images` helper with local image inputs.

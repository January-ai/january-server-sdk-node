# Maintainer release checklist

The package is distributed through npm as `@januaryai/server`, with typed ESM and
CommonJS entry points. Repository visibility is separate from npm distribution;
release tooling never changes GitHub visibility.

1. Review CI on Linux, macOS and Windows and the installed-package consumers.
2. Choose a semantic version and update `package.json` and the lockfile.
3. Tag the approved commit `v<version>` and push the tag. The release workflow
   validates the version, tests and packs the package, publishes it to npm with
   provenance through npm trusted publishing (GitHub OIDC; no token is stored),
   waits for the public registry to serve the version, and creates the GitHub
   release with the exact tarball.
4. Verify installation: `npm install @januaryai/server@<version>` in a scratch
   project.

Trusted publishing is configured on npmjs.com for `@januaryai/server`: package
settings → Trusted publisher → GitHub Actions, repository
`January-ai/january-server-sdk-node`, workflow `release.yml`, environment
`npm`. The first version (0.1.0) was uploaded by hand because npm only allows a
trusted publisher on a package that already exists. The optional `sharp` peer
is needed only by developers using the Node-only `/images` helper with local
image inputs.

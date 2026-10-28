# Workflow review follow-up

2026-09-10. Supplements `workflow-production-readiness.md`; no deployment or remote database inspection.

## Dependency synchronization

Parent working installation now matches the updated lockfile (`npm install --ignore-scripts --no-fund`). All five Prisma merge/config compatibility tests pass in the working project. Full registry `npm audit --json` reports **zero vulnerabilities** at this point in time. Prisma remains 6.19.3; only its config dependency receives scoped deepmerge-ts 8.0.2. Typecheck and scoped lint pass.

## Independent scanner findings addressed

The workflow reviewer found two real omissions in `verify-standalone-artifact.mjs`: forbidden filenames were checked only after symlink/directory branches, and encrypted/DSA private-key markers were missed. Checks now apply before entry-type branching, and all uppercase PEM private-key prefixes are detected. Nine new subprocess tests pass, covering internal aliases, forbidden dotenv/test symlinks, forbidden empty directories, generic/RSA/EC/OpenSSH/encrypted/DSA markers, escaping links and broken links. Matching bytes are never printed.

## Conservative marker finding in native dependency

The corrected scanner finds one marker in the Darwin artifact's `node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.6.dylib`. It is a null-terminated `BEGIN ENCRYPTED PRIVATE KEY` parser string, not a complete PEM block; no complete private-key PEM block was detected in that file. The file is byte-identical to the clean installed dependency and has SHA-256 `bba7a98f1c4b10f4c31f92e12264e5d41a7ab484b864feae535ac8919c548d01`.

This is a manually investigated marker finding, **not an automated zero-finding scan** or proof the binary contains no secrets. The detector remains conservative; no broad binary exemption or suppression was added. The eventual Linux artifact must be scanned and its own findings reviewed independently. No real credentials were loaded into the isolated build.

## Remote verification status

Repository CI references `https://visionquest.onrender.com`, but this does not establish the authorized service ID, release identity, live environment settings or database-role parity. Render/Supabase CLIs and deployment API credentials were not available in the current process. No deployed DB connection was attempted, no credentials printed, and no production mutations were made. Deployment verification needs securely provisioned authorized access and confirmation of the service/project target. Local catalog/RLS tests cannot substitute for this.

# chore: prepare Cloudflare Pages deployment

## Summary

This PR prepares Pixelsoup for static hosting on Cloudflare Pages. Production deploys come from
`main`, and every pull request gets an isolated preview URL to test before merging. The repository
still builds as a plain Vite static site: there is no Wrangler configuration, Cloudflare adapter,
runtime service or new dependency.

It also standardises local development and preview on port 1619, removes the Windows-only launcher,
and adds the metadata and favicon needed for the hosted app. There are no application features or
editor behaviour changes.

## What's included

Commits are intended to be reviewed one at a time:

1. **Remove the Windows launcher**:
   - deletes `start-pixelsoup.cmd`;
   - removes the `*.cmd` CRLF exception from `.gitattributes`;
   - removes launcher and shortcut instructions from the README, `CLAUDE.md` and historical PR
     notes.
2. **Use port 1619 for Vite servers**:
   - configures both the development and preview servers for port 1619;
   - enables `strictPort` for both, so a conflict fails loudly rather than selecting another port;
   - updates every documented development URL.
3. **Add Cloudflare Pages build assets**:
   - adds `.nvmrc` with Node 22, matching a supported major in `package.json` engines;
   - makes Vite's root deployment base (`/`) and `dist/` output explicit;
   - adds `public/_headers` with `X-Content-Type-Options: nosniff`,
     `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY`;
   - adds a description, theme colour and original SVG favicon to `index.html`.
4. **Document deployment**:
   - adds `docs/deploy.md` with the Cloudflare dashboard settings, production and preview flow,
     rollback instructions, and the headers/CSP policy;
   - adds the placeholder live URL to the README and links to the deployment guide;
   - adds the deployment workflow to `CLAUDE.md`.
5. **Refresh lockfile metadata**:
   - removes stale npm peer markers written by a different npm version without changing package
     versions, resolved URLs or integrity hashes.

## Cloudflare Pages configuration

| Setting                | Value           |
| ---------------------- | --------------- |
| Production branch      | `main`          |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Node.js version        | `.nvmrc` (`22`) |

Cloudflare copies `public/_headers` into the built site. The Content Security Policy remains the
production-only meta tag injected by `vite.config.ts`, preserving one source of truth. It can move
to an HTTP header later if needed.

Pixelsoup has no client-side routes, so it does not need a `_redirects` file. The placeholder
`https://REPLACE-ME.pages.dev` in the README should be replaced after the first production
deployment.

## How to verify

Verification was run from a fresh temporary clone using Node 22:

```sh
npm ci
npm run lint
npm test
npm run build
npm run preview
```

Results:

- ESLint and Prettier passed.
- All 472 tests across 44 files passed.
- The production build completed and wrote the static site to `dist/`.
- `dist/_headers` contained all three configured hardening headers.
- The production app loaded at <http://localhost:1619> in Edge with its title, metadata and
  favicon.
- No application console errors or CSP violations were reported.
- Starting another Vite server while port 1619 was occupied failed with the expected strict-port
  error.
- `git grep -i launcher`, `git grep start-pixelsoup` and `git grep 5173` returned no matches.

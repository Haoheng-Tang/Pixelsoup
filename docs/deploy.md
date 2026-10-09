# Deployment

Pixelsoup is hosted on Cloudflare Pages, connected directly to the GitHub repository. Cloudflare
builds the static Vite site from a fresh checkout; the repository does not use Wrangler, a
Cloudflare adapter or any runtime service.

## Cloudflare Pages settings

Configure the Pages project in the Cloudflare dashboard with:

| Setting                | Value              |
| ---------------------- | ------------------ |
| Production branch      | `main`             |
| Build command          | `npm run build`    |
| Build output directory | `dist`             |
| Node.js version        | Read from `.nvmrc` |

Vite's `base` is `/`, because Pages serves the app at the domain root, and `npm run build` writes
the static site to `dist/`. Every pull request gets its own Cloudflare preview deployment and URL.
Test that preview before merging. Merges to `main` deploy automatically to production.

## Rollback

In the Cloudflare dashboard, open the Pages project and its deployment history, select the last
known-good production deployment, and choose **Rollback to this deployment**. This restores the
published site without changing Git history; follow up with a Git revert when the source change
also needs to be undone.

## Headers, CSP and redirects

Cloudflare copies `public/_headers` to `dist/_headers` and applies its hardening headers to every
path: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and
`X-Frame-Options: DENY`.

The Content Security Policy remains the production-only meta tag injected by `vite.config.ts`, so
there is one source of truth. It can move to `_headers` later if deployment requirements call for
an HTTP CSP header.

Pixelsoup is a single page with no client-side routes, so it does not need a `_redirects` file.

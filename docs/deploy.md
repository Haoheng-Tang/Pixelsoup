# Deployment

Pixelsoup is a static Vite site with two hosts, each building it from this repository:

- **Cloudflare** is the main host: `main` deploys to production at
  https://pixelsoup.lumenon.workers.dev/, and every pull request gets its own preview. The
  repository does not use Wrangler, a Cloudflare adapter or any runtime service.
- **GitHub Pages** mirrors `main` at https://haohengt.com/Pixelsoup/, deployed by
  `.github/workflows/pages.yml`.

A merge to `main` deploys to both hosts. Pull requests get Cloudflare previews only.

## Cloudflare Pages settings

Configure the Pages project in the Cloudflare dashboard with:

| Setting                | Value              |
| ---------------------- | ------------------ |
| Production branch      | `main`             |
| Build command          | `npm run build`    |
| Build output directory | `dist`             |
| Node.js version        | Read from `.nvmrc` |

Vite's `base` is `/` here, because Cloudflare serves the app at the domain root, and
`npm run build` writes the static site to `dist/`. Every pull request gets its own Cloudflare
preview deployment and URL. Test that preview before merging. Merges to `main` deploy
automatically to production.

## GitHub Pages

The repository's Pages source is **GitHub Actions**. The **Deploy to GitHub Pages** workflow
(`.github/workflows/pages.yml`) runs on every push to `main`, and can be run by hand from the
Actions tab:

- **build** sets up Node from `.nvmrc` with npm's cache, runs `npm ci`, then `npm run build`
  with `VITE_BASE=/Pixelsoup/`, and uploads `dist/` as the Pages artifact.
- **deploy** publishes the artifact to the `github-pages` environment, which accepts only `main`.
- Runs share the `pages` concurrency group, so a new push cancels a run still in progress and
  only the latest `main` is published.

GitHub serves a project site under the repository's name: here https://haohengt.com/Pixelsoup/,
on the owner's custom domain (`haoheng-tang.github.io/Pixelsoup/` redirects there). So the
workflow sets Vite's `base` to `/Pixelsoup/` through `VITE_BASE`, while `npm run dev`,
`npm run preview` and Cloudflare keep the default `/`. **The base path is the one setting that
changes if the repository is renamed**: set `VITE_BASE` in the workflow to the new name. (It
would become `/` if the site got a custom domain of its own.)

`public/.nojekyll` lands in `dist/` and stops Jekyll if `dist/` is ever published from a branch.
Deployments from Actions never run Jekyll, and `actions/upload-pages-artifact` leaves dotfiles
out of the artifact anyway.

## Rollback

**Cloudflare**: in the Cloudflare dashboard, open the Pages project and its deployment history,
select the last known-good production deployment, and choose **Rollback to this deployment**.
This restores the published site without changing Git history; follow up with a Git revert when
the source change also needs to be undone.

**GitHub Pages**: revert the change on `main`, and the workflow deploys the reverted code. A
Cloudflare rollback doesn't touch the mirror, which keeps the bad build until the revert lands.

## Headers, CSP and redirects

Cloudflare copies `public/_headers` to `dist/_headers` and applies its hardening headers to every
path: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and
`X-Frame-Options: DENY`. GitHub Pages can't set response headers; it serves `_headers` as a
plain file, so the mirror goes without them.

The Content Security Policy remains the production-only meta tag injected by `vite.config.ts`, so
there is one source of truth, and it applies on both hosts. It can move to `_headers` later if
deployment requirements call for an HTTP CSP header, though the GitHub Pages mirror would then
lose it.

Pixelsoup is a single page with no client-side routes, so it needs neither a `_redirects` file
nor a `404.html`.

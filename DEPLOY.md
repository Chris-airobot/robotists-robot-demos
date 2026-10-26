# Deploy Robotists Motion Library (always-online website)

This is a static React/Vite viewer. You do NOT need to keep the laptop,
Vite development server, or a robot running for visitors to use it.

## Hosting choice

Netlify's Git-connected deployment supports private GitHub repositories,
static HTTPS websites, and optional custom domains. GitHub stays private:
only the built `web/dist` contents are uploaded and publicly accessible.
Check company approval before publishing any manufacturer assets or branding.

Why Netlify rather than direct Cloudflare Pages: the original MagicDog
`models/magicdog/meshes/base.obj` is around 39 MiB; Cloudflare Pages has
a 25 MiB per-asset maximum. Avoid swapping MagicDog for a lower-fidelity
model just to meet the CDN limit.

## One-time deployment (in Netlify UI)

1. Open https://app.netlify.com/start and sign into Netlify.
2. Choose **Import an existing project** / **Deploy with Git**.
3. Choose **GitHub**, authorize Netlify for private repository access
   to `Chris-airobot/robotists-robot-demos` (prefer selected-repo access).
4. Select `Chris-airobot/robotists-robot-demos`.
5. Set production branch to **master**. Netlify should read the root
   `netlify.toml` automatically:
   - Base directory: leave empty (repository root).
   - Build command: `bash tools/build_static_site.sh`.
   - Publish directory: `web/dist`.
   - Node version: 24 (in `netlify.toml`).
   Avoid changing the base directory to `web`, since the build also
   downloads official mesh assets stored outside `web`.
6. Choose **Deploy**. The first build downloads and verifies 12 Unitree
   DAE meshes and 61 LimX STL meshes. It runs the complete motion test
   suite and builds the site, failing instead of publishing missing assets.
7. When it reports **Published**, open the assigned
   `https://<netlify-site-name>.netlify.app` URL. Test all five robots:
   MagicDog, Go2, A1, OLI and LUNA, especially Walking/Wave Hello.
   The actual hostname is allocated by Netlify; it is NOT known before
   you create the site.

## After deployment

- Every push to `master` builds and updates the site automatically.
- Your computer can be powered off.
- To use a branded domain (for example, a company-approved
  `motion.<company-domain>`), go to Netlify **Domain management**,
  add the domain, then apply the DNS records specified by Netlify.
  Do not change company DNS without authorization.
- Changes to DNS or source access may require help from the website
  administrator.

## Diagnosing a deploy error

1. Open Netlify's **Deploys > latest deploy > Deploy log**.
2. If official mesh downloads fail, review external access to
   `raw.githubusercontent.com` and `cdn.jsdelivr.net`; rerun deployment.
3. If tests fail, read the assertion in the build log. The deployment
   is deliberately stopped instead of silently serving broken motions.
4. If a card says **Model not available**, verify that the marker exists:
   `web/dist/<robot>/meshes/asset-ready.txt`, for `go2`, `a1`,
   `oli`, and `luna`.
5. If the original MagicDog model is missing, check the build output
   for `web/dist/magicdog/meshes/base.obj`.
6. This static site deploy is larger than a typical marketing site due
   to manufacturer meshes (~180+ MiB altogether). Initial downloads
   can be slower on mobile or constrained networks. Check the hosting
   plan's current bandwidth, build credit and price terms.

## Local reproduction of the full hosted build

From the repository root:

```bash
bash tools/build_static_site.sh
```

Then `cd web && npm run preview` to serve the production build
locally for verification.

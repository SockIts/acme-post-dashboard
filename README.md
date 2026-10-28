# ACME Content Dashboard: encrypted static site (GitHub Pages)

A **password-protected, fully static** copy of the ACME post-draft dashboard, meant for GitHub Pages.
`index.html` is a small login page that contains the whole dashboard **encrypted**. The browser derives a key
from the shared password and decrypts the dashboard in-page. Nothing is sent to any server and nothing is
ever posted automatically (test mode).

* Encryption: AES-256-GCM, key from the password with PBKDF2-HMAC-SHA256 (1,000,000 iterations), random 16-byte salt and
  12-byte IV, payload gzipped before encryption (about 11 MB of dashboard becomes about 10.5 MB of `index.html`).
  Web Crypto is used in the browser (needs https or localhost; GitHub Pages is https).
* No unencrypted dashboard, images, drafts or `data.json` are in this repository, and the password is stored nowhere.
* Wrong password: an error is shown and no content is rendered.
* "Remember me" is off by default. If ticked, the derived key (not the password) is kept in this browser's
  localStorage; the dashboard's **Lock** button forgets it.

## What works after unlocking
Cards on top, expanded posts below, per-post **Open in X**, **Copy full thread**, **Export comments**.
Because the site is static, **Approved, Post Date, status and comments are saved in each person's own browser
(localStorage)**. Use **Export comments** to share them. While the tab is open it checks every 30 s: approved cards whose
Post Date (Pacific time) has passed show a red **Due now** bar with Open in X buttons. It never posts anything.

## Rebuild (re-encrypt after the dashboard changes)
The source dashboard lives outside this repo (`../dashboard/acme-post-dashboard.html`, built by `../dashboard/build.py`).

```bash
pip install cryptography            # once
PAGES_PASSWORD='<the shared password>' ./build_pages.sh [path/to/acme-post-dashboard.html]
git add index.html && git commit -m "Re-encrypt dashboard" && git push
```
`PAGES_PASSWORD` is read from the environment at build time only. Re-running with a new password (or the same one)
generates a fresh random salt and IV. Changing the password invalidates old "remember me" keys automatically.

## Test
```bash
PAGES_PASSWORD='<the shared password>' node tests/browser_test.js   # needs google-chrome and node >= 22
```
Covers wrong/right password, thread expansion, localStorage persistence across reload, Due now (past date and the 30 s timer),
remember me, lock. It writes screenshots outside the repo (`../dashboard-pages-shots/`).

## Deploy
GitHub repo, Settings, Pages, "Deploy from a branch", `main` / root. `.nojekyll` is included.

## Limits
* A shared password protects only as well as it is strong: the encrypted file is public, so anyone can download it and try
  passwords offline (PBKDF2 slows that down, a long random password stops it). Rotate the password and rebuild if it leaks.
* Anyone who has unlocked it can copy the contents. Old copies of `index.html` stay in git history; changing the password
  does not re-protect old versions.
* Per-browser state only (no sharing between team members except via Export comments).
* File size: GitHub allows 100 MB per file (warning at 50 MB); this file is about 10.5 MB. Each rebuild adds another ~10 MB to git history.

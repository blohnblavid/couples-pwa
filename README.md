# couples-pwa

A private PWA for two people to share a timeline, photo album, and notes, with push notifications. Express backend, plain HTML/JS frontend, single Docker container.

## Features

- Timeline of milestones, each with an optional photo, editable after posting
- Photo album, single or bulk upload
- Notes back and forth
- A "thinking about you" button that sends a push notification to the other person's device
- Identity picker on first load, remembered per browser
- Installable to a phone home screen
- Day counter from a configurable start date

## Stack

- Backend: Express (Node.js)
- Frontend: plain HTML/CSS/JS, no build step
- Storage: JSON files and images on disk, no database
- Packaging: single Docker container

## Configuration

Set through environment variables, no code editing needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NAME_A` | No | `Ave` | First person's name |
| `NAME_B` | No | `John` | Second person's name |
| `START_DATE` | No | `2025-05-13` | Date the day counter counts from, `YYYY-MM-DD` |
| `VAPID_EMAIL` | Recommended | `admin@example.com` | Contact email for push notifications. Apple's push service rejects placeholder addresses, so use a real one if push matters to you. |
| `DATA_DIR` | No | `./data` (local) | Where the JSON database and photos are stored. On Railway, defaults to `/app/data`. |
| `PORT` | No | `3060` | Port the server listens on |

Set `NAME_A`, `NAME_B`, and `START_DATE` to whatever fits. Button text, the marquee, the day counter, and identity validation all follow from these.

## Running locally

```bash
git clone https://github.com/blohnblavid/couples-pwa.git
cd couples-pwa
docker compose up -d --build
```

Set `NAME_A`, `NAME_B`, `START_DATE`, and `VAPID_EMAIL` in `docker-compose.yml` (or however you pass env vars). App runs at `http://localhost:3060`.

Push notifications need HTTPS. Everything else works fine over plain HTTP on localhost, but the browser won't grant notification permission without HTTPS. If you want push working locally, put this behind something that terminates HTTPS (a reverse proxy with a cert, Tailscale's `tailscale serve`, ngrok, etc.).

## Deploying with HTTPS (Railway, Render, etc.)

For two people on two devices to use this, including push, it needs a public HTTPS URL:

1. Fork or push this repo to your own GitHub account
2. Create a project on Railway/Render, connect it to the repo
3. It should detect the Dockerfile and build from it
4. Set the env vars above in the platform's dashboard
5. Add a persistent volume mounted at `/app/data`. Without this, every redeploy wipes photos, notes, and milestones. The mount path has to match `DATA_DIR`.
6. Enable a public domain for the service to get the HTTPS URL

### If Railway stops redeploying on push

If pushes to GitHub stop triggering deploys, or the Settings page shows "GitHub Repo not found" under the connected branch, Railway's GitHub App has likely lost access to the repo. Fix:

1. Go to `github.com/settings/installations`
2. If Railway isn't listed, reinstall it at `github.com/apps/railway-app` and grant access to the repo
3. Reconnect the repo in Railway's service Settings tab
4. Push an empty commit to confirm the webhook works: `git commit --allow-empty -m "test deploy" && git push`

## Data

Milestones, photos, notes, and push keys are stored as flat JSON and image files under `DATA_DIR`. No database, no built-in export. Back up that folder (or the mounted volume) if the content matters.

## Limitations

- Identity isn't real authentication. Anyone with the URL can pick either name and post as that person. Meant to be shared privately, not deployed publicly.
- No built-in reset. Entries can be deleted one at a time through the UI, or by clearing the data directory manually.
- One relationship per deployment. Names and start date are global to the instance.

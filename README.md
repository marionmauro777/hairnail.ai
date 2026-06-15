# HairNail.ai — Hair-Swap Backend

A tiny server that performs photorealistic hair swaps via the LightX API and
returns the finished image to the HairNail.ai app. It exists so your LightX
**API key never ships inside the Android app** (where it could be extracted).

## What it does
1. Receives the user's photo + a style prompt from the app
2. Uploads the photo to LightX, submits a hairstyle/haircolor job
3. Polls LightX until the generated image is ready
4. Returns the finished image URL to the app

## Setup (5 minutes)

1. Install Node.js 18+ (for built-in `fetch`).
2. In this folder:
   ```
   npm install
   ```
3. Get a LightX API key — sign up at https://www.lightxeditor.com/api/
   (25 free credits, no card). Copy `.env.example` to `.env` and paste your key:
   ```
   LIGHTX_API_KEY=sk-...
   ```
4. Run locally:
   ```
   npm start
   ```
   You should see: `HairNail.ai backend listening on :8080`
5. Test it's alive: open http://localhost:8080/health → `{"ok":true}`

## Deploy (pick one)
- **Render.com / Railway.app / Fly.io** — connect this folder as a Node service,
  set the `LIGHTX_API_KEY` environment variable in their dashboard, deploy.
- **Any VPS** — `npm install && LIGHTX_API_KEY=... npm start` behind nginx.

After deploying you'll get a public URL like `https://hairnailai.onrender.com`.
Put that URL into the Android app (see the app's `local.properties`:
`HAIRSWAP_BACKEND_URL=...`).

## ⚠️ Verify against live LightX docs
LightX's submit endpoints are confirmed, but the exact field names for the
image-upload and status-polling steps can differ by API version. Search for
`>>> VERIFY` in `server.js` — there are three spots. Check them once against
https://docs.lightxeditor.com/ and adjust if needed. Everything else is ready.

## Endpoint
`POST /api/hairswap` (multipart/form-data)
- `photo` — image file
- `prompt` — e.g. `"short boxed beard"` or `"honey blonde balayage"`
- `kind` — `"hairstyle"` (default) or `"haircolor"`

Returns `{ "imageUrl": "https://..." }`.

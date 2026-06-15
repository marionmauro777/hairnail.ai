// ─────────────────────────────────────────────────────────────
//  HairNail.ai — LightX hair-swap backend
//
//  WHY THIS EXISTS
//  Your LightX API key must NOT live inside the Android app — anyone
//  could decompile the APK and steal it. This tiny server holds the key,
//  talks to LightX on the app's behalf, and returns only the finished
//  image URL. Deploy it somewhere simple (Render, Railway, Fly.io, a VPS).
//
//  THE LIGHTX FLOW (async, 3 steps)
//    1. Upload the user's photo so LightX can read it from a URL
//    2. Submit the hairstyle/haircolor job  -> returns an orderId
//    3. Poll the status endpoint until the output image is ready
//
//  IMPORTANT — VERIFY AGAINST LIVE DOCS
//  LightX's submit endpoints are confirmed:
//    POST /external/api/v1/hairstyle    { imageUrl, textPrompt }
//    POST /external/api/v2/haircolor/   { imageUrl, textPrompt }
//  The EXACT field names for the upload + status-polling responses can
//  vary by API version. Every spot you must confirm is marked:  >>> VERIFY
//  Check them once against https://docs.lightxeditor.com/ and adjust.
// ─────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import multer from "multer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const LIGHTX_API_KEY = process.env.LIGHTX_API_KEY || "";
const LIGHTX_BASE = "https://api.lightxeditor.com/external/api";
const PORT = process.env.PORT || 8080;

if (!LIGHTX_API_KEY) {
  console.warn("[WARN] LIGHTX_API_KEY is not set. Set it before going live.");
}

const lightxHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": LIGHTX_API_KEY,
});

// ─── Step 1: upload an image, get back a public URL LightX can read ───
//
// LightX issues a pre-signed upload URL, you PUT the bytes to it, then
// reference the returned imageUrl in the job. >>> VERIFY field names:
//   request:  { uploadType, size, contentType }
//   response: { body: { uploadImage, imageUrl } }
async function uploadToLightX(buffer, contentType) {
  const createRes = await fetch(`${LIGHTX_BASE}/v2/uploadImageUrl`, {
    method: "POST",
    headers: lightxHeaders(),
    body: JSON.stringify({
      uploadType: "imageUrl",
      size: buffer.length,
      contentType: contentType || "image/jpeg",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`upload-url request failed: ${createRes.status} ${await safeText(createRes)}`);
  }
  const createJson = await createRes.json();
  // >>> VERIFY: these two fields hold the PUT target and the final URL
  const putUrl = createJson?.body?.uploadImage;
  const imageUrl = createJson?.body?.imageUrl;
  if (!putUrl || !imageUrl) {
    throw new Error(`upload-url response missing fields: ${JSON.stringify(createJson)}`);
  }

  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType || "image/jpeg" },
    body: buffer,
  });
  if (!putRes.ok) {
    throw new Error(`image PUT failed: ${putRes.status}`);
  }
  return imageUrl;
}

// ─── Step 2: submit the hairstyle or haircolor job ───
async function submitJob(kind, imageUrl, textPrompt) {
  const path = kind === "haircolor" ? "/v2/haircolor/" : "/v1/hairstyle";
  const res = await fetch(`${LIGHTX_BASE}${path}`, {
    method: "POST",
    headers: lightxHeaders(),
    body: JSON.stringify({ imageUrl, textPrompt }),
  });
  if (!res.ok) {
    throw new Error(`submit ${kind} failed: ${res.status} ${await safeText(res)}`);
  }
  const json = await res.json();
  // >>> VERIFY: order id field (commonly body.orderId)
  const orderId = json?.body?.orderId ?? json?.orderId;
  if (!orderId) {
    throw new Error(`submit response missing orderId: ${JSON.stringify(json)}`);
  }
  return orderId;
}

// ─── Step 3: poll until the output is ready ───
//
// >>> VERIFY: status endpoint + fields.
//   POST /v1/order-status { orderId }
//   response: { body: { status: "active"|"init"|"failed", output: "<url>" } }
async function pollResult(orderId, { tries = 20, intervalMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${LIGHTX_BASE}/v1/order-status`, {
      method: "POST",
      headers: lightxHeaders(),
      body: JSON.stringify({ orderId }),
    });
    if (res.ok) {
      const json = await res.json();
      const status = json?.body?.status ?? json?.status;
      const output = json?.body?.output ?? json?.output;
      if (status === "active" && output) return output; // done
      if (status === "failed") throw new Error("LightX reported job failed");
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for LightX result");
}

// ─── Public endpoint the Android app calls ───
//
// POST /api/hairswap   (multipart/form-data)
//   field "photo"      : the user's image file
//   field "prompt"     : e.g. "short boxed beard, honey blonde balayage"
//   field "kind"       : "hairstyle" (default) or "haircolor"
// Returns: { imageUrl: "<finished image url>" }
app.post("/api/hairswap", upload.single("photo"), async (req, res) => {
  try {
    if (!LIGHTX_API_KEY) return res.status(500).json({ error: "Server missing LIGHTX_API_KEY" });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

    const prompt = (req.body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    const kind = req.body.kind === "haircolor" ? "haircolor" : "hairstyle";

    const imageUrl = await uploadToLightX(req.file.buffer, req.file.mimetype);
    const orderId = await submitJob(kind, imageUrl, prompt);
    const output = await pollResult(orderId);

    res.json({ imageUrl: output });
  } catch (err) {
    console.error("[hairswap]", err);
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`HairNail.ai backend listening on :${PORT}`));

// ─── helpers ───
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function safeText(res) { try { return await res.text(); } catch { return ""; } }

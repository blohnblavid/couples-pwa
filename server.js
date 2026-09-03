// Ave & John — tiny backend
// Serves the frontend, stores shared data as JSON on disk,
// saves photos as files, and sends Web Push notifications.

const express = require("express");
const webpush = require("web-push");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3060;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const VAPID_FILE = path.join(DATA_DIR, "vapid.json");

fs.mkdirSync(PHOTO_DIR, { recursive: true });

// ---------- persistence ----------
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {
      milestones: [],
      photos: [],
      notes: [],
      pings: {},           // { "Ave": iso, "John": iso }
      subscriptions: {},   // { "Ave": [sub, ...], "John": [sub, ...] }
    };
  }
}

let db = loadData();
let saveTimer = null;

// Debounced write: coalesces rapid changes into one disk write.
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (err) => {
      if (err) console.error("save failed:", err.message);
    });
  }, 250);
}

// ---------- VAPID keys (generated once, then reused) ----------
let vapid;
try {
  vapid = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
} catch {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2));
  console.log("Generated new VAPID keypair (stored in data/vapid.json)");
}
webpush.setVapidDetails(`mailto:${process.env.VAPID_EMAIL || "admin@example.com"}`, vapid.publicKey, vapid.privateKey);

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(PHOTO_DIR));

const NAME_A = process.env.NAME_A || "Ave";
const NAME_B = process.env.NAME_B || "John";
const START_DATE = process.env.START_DATE || "2025-05-13";
const OTHER = { [NAME_A]: NAME_B, [NAME_B]: NAME_A };
function validWho(who) {
  return who === NAME_A || who === NAME_B;
}

// ---- milestones ----
app.get("/api/milestones", (req, res) => res.json(db.milestones));

app.post("/api/milestones", (req, res) => {
  const { date, title, desc, photo } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "title required" });
  let photoUrl = null;
  if (photo) {
    photoUrl = savePhotoFile(photo);
    if (!photoUrl) return res.status(400).json({ error: "bad photo data" });
  }
  const entry = {
    id: "m-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
    date: date || "",
    title: title.trim(),
    desc: (desc || "").trim(),
    photo: photoUrl,
  };
  db.milestones.push(entry);
  persist();
  res.json(entry);
});

app.put("/api/milestones/:id", (req, res) => {
  const m = db.milestones.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "not found" });
  const { date, title, desc, photo } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "title required" });

  // photo === null            -> explicit removal
  // photo starts with data:   -> new upload, replaces the old file
  // anything else (undefined, or the existing /photos/... url) -> unchanged
  if (photo === null) {
    if (m.photo) deletePhotoFile(m.photo);
    m.photo = null;
  } else if (typeof photo === "string" && photo.startsWith("data:image/")) {
    const saved = savePhotoFile(photo);
    if (!saved) return res.status(400).json({ error: "bad photo data" });
    if (m.photo) deletePhotoFile(m.photo);
    m.photo = saved;
  }

  m.date = date || "";
  m.title = title.trim();
  m.desc = (desc || "").trim();
  persist();
  res.json(m);
});

app.delete("/api/milestones/:id", (req, res) => {
  const m = db.milestones.find((x) => x.id === req.params.id);
  if (m && m.photo) deletePhotoFile(m.photo);
  db.milestones = db.milestones.filter((x) => x.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---- photo wall ----
app.get("/api/photos", (req, res) => res.json(db.photos));

app.post("/api/photos", (req, res) => {
  const { src, caption, by } = req.body || {};
  if (!validWho(by)) return res.status(400).json({ error: "bad identity" });
  const url = savePhotoFile(src);
  if (!url) return res.status(400).json({ error: "bad photo data" });
  const entry = {
    id: "p-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
    src: url,
    caption: (caption || "").trim(),
    by,
    date: new Date().toISOString(),
  };
  db.photos.unshift(entry);
  persist();
  res.json(entry);
});

app.delete("/api/photos/:id", (req, res) => {
  const p = db.photos.find((x) => x.id === req.params.id);
  if (p) deletePhotoFile(p.src);
  db.photos = db.photos.filter((x) => x.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---- notes ----
app.get("/api/notes", (req, res) => res.json(db.notes));

app.post("/api/notes", (req, res) => {
  const { text, by } = req.body || {};
  if (!validWho(by)) return res.status(400).json({ error: "bad identity" });
  if (!text || !text.trim()) return res.status(400).json({ error: "text required" });
  const entry = {
    id: "n-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
    text: text.trim(),
    by,
    date: new Date().toISOString(),
  };
  db.notes.unshift(entry);
  persist();
  // A note also notifies the other person — it's the same "for you" energy.
  sendPushTo(OTHER[by], {
    title: `${by} left you a note 💛`,
    body: entry.text.length > 90 ? entry.text.slice(0, 90) + "…" : entry.text,
  });
  res.json(entry);
});

app.delete("/api/notes/:id", (req, res) => {
  db.notes = db.notes.filter((x) => x.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---- pings ----
app.get("/api/pings", (req, res) => res.json(db.pings));

app.post("/api/ping", (req, res) => {
  const { by } = req.body || {};
  if (!validWho(by)) return res.status(400).json({ error: "bad identity" });
  db.pings[by] = new Date().toISOString();
  persist();
  sendPushTo(OTHER[by], {
    title: "💛",
    body: `${by} is thinking about you`,
  });
  res.json({ ok: true });
});

// ---- push subscriptions ----
app.get("/api/vapid-public-key", (req, res) => res.json({ key: vapid.publicKey }));

app.post("/api/subscribe", (req, res) => {
  const { who, subscription } = req.body || {};
  if (!validWho(who) || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "bad subscription" });
  }
  if (!db.subscriptions[who]) db.subscriptions[who] = [];
  // De-dupe by endpoint; a device re-subscribing replaces its old entry.
  db.subscriptions[who] = db.subscriptions[who].filter((s) => s.endpoint !== subscription.endpoint);
  db.subscriptions[who].push(subscription);
  persist();
  res.json({ ok: true });
});

async function sendPushTo(who, payload) {
  const subs = db.subscriptions[who] || [];
  const body = JSON.stringify(payload);
  for (const sub of [...subs]) {
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      // 404/410 mean the subscription is dead (app uninstalled, permission revoked) — prune it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.subscriptions[who] = db.subscriptions[who].filter((s) => s.endpoint !== sub.endpoint);
        persist();
      } else {
        console.error("push failed:", err.statusCode, err.body, "endpoint host:", new URL(sub.endpoint).host);
      }
    }
  }
}

// ---------- photo file helpers ----------
// Accepts a base64 data URL, writes a jpg, returns its public path.
function savePhotoFile(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!match) return null;
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > 10 * 1024 * 1024) return null; // 10MB hard cap
  const name = Date.now() + "-" + crypto.randomBytes(4).toString("hex") + ".jpg";
  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  return "/photos/" + name;
}

function deletePhotoFile(url) {
  if (!url || !url.startsWith("/photos/")) return;
  const name = path.basename(url);
  fs.unlink(path.join(PHOTO_DIR, name), () => {});
}
app.get("/api/config", (req, res) => {
  res.json({ nameA: NAME_A, nameB: NAME_B, startDate: START_DATE });
});
app.listen(PORT, () => console.log(`ave & john listening on :${PORT}`));

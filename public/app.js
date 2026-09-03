// ave & john — frontend logic

let NAME_A = "Ave";
let NAME_B = "John";
let START_DATE = new Date("2025-05-13T00:00:00");

async function loadConfig() {
  const cfg = await fetch("/api/config").then(r => r.json());
  NAME_A = cfg.nameA;
  NAME_B = cfg.nameB;
  START_DATE = new Date(cfg.startDate + "T00:00:00");
  applyAccentColor("--accent-rgb", cfg.accentColor);
  applyBackgroundColor(cfg.bgColor);
  applyAccentColor("--accent2-rgb", cfg.accent2Color);
}

function applyAccentColor(cssVar, hex) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return;
  const rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)].join(",");
  document.documentElement.style.setProperty(cssVar, rgb);
}

function applyBackgroundColor(hex) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return;
  const base = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  const shade = (amt) => base.map(c => Math.max(0, Math.min(255, c + amt))).join(",");
  document.documentElement.style.setProperty("--bg1-rgb", shade(40));
  document.documentElement.style.setProperty("--bg2-rgb", shade(0));
  document.documentElement.style.setProperty("--bg3-rgb", shade(-20));
}
let who = localStorage.getItem("identity:who") || null;
let tlPhoto = null;      // pending timeline photo: dataURL (new), existing url (unchanged), or null (none/removed)
let editingId = null;    // milestone id currently being edited, or null when adding new
let currentMilestones = []; // last-loaded milestones, so editMilestone() can look one up without refetching
let phPending = null;    // pending album photo (dataURL)
let currentTab = "timeline";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Escapes text for safe embedding inside onclick="...('text')" —
// esc() alone isn't enough there: it doesn't touch quotes, so a title like
// "John's Birthday" breaks the inline JS string and kills that element's handler.
function jsAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + (days === 1 ? " day ago" : " days ago");
}

async function api(path, opts) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = "request failed (" + res.status + ")";
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Downscale an image client-side so uploads stay small.
function resizeImage(file, maxDim = 1100, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("image load failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width); width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height); height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

// ---------- identity ----------
function pickIdentity(name) {
  who = name;
  localStorage.setItem("identity:who", name);
  boot();
}

// ---------- tabs ----------
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  ["timeline", "photos", "notes", "settings"].forEach((v) => $("view-" + v).classList.toggle("hidden", v !== tab));
}

// ---------- timeline ----------
async function loadTimeline() {
  const list = $("timeline-list");
  try {
    const items = await api("/milestones");
    items.sort((a, b) => (a.date || "0000").localeCompare(b.date || "0000"));
    currentMilestones = items;
    list.innerHTML = items.map((m, i) => `
      <div class="tl-row">
        <div class="tl-rail">
          <div class="tl-dot"></div>
          ${i < items.length - 1 ? '<div class="tl-line"></div>' : ""}
        </div>
        <div class="tl-content">
          <div class="tl-date">${m.date ? esc(formatDate(m.date)) : "sometime"}</div>
          <div class="tl-title-row">
            <h3>${esc(m.title)}</h3>
            <div class="tl-actions">
              <button class="icon-btn" onclick="editMilestone('${m.id}')" aria-label="Edit">&#9999;</button>
              <button class="icon-btn" onclick="removeMilestone('${m.id}')" aria-label="Remove">&#128465;</button>
            </div>
          </div>
          ${m.desc ? `<p>${esc(m.desc)}</p>` : ""}
          ${m.photo ? `<img class="tl-photo" src="${esc(m.photo)}" alt="${esc(m.title)}" onclick="openLightbox('${esc(m.photo)}', '${jsAttr(m.title)}', '')" />` : ""}
        </div>
      </div>`).join("");
  } catch (err) {
    list.innerHTML = `<p class="empty">couldn't load the timeline — ${esc(err.message)}</p>`;
  }
}

function showTlForm(show) {
  $("tl-form").classList.toggle("hidden", !show);
  $("tl-add-btn").classList.toggle("hidden", show);
  showError("tl-error", "");
}

// Clears the form back to a blank "add" state — used both when opening
// a fresh add and after a successful save/update.
function resetTlForm() {
  editingId = null;
  $("tl-date").value = "";
  $("tl-title").value = "";
  $("tl-desc").value = "";
  clearTlPhoto();
  $("tl-save").textContent = "save";
  $("tl-save").disabled = false;
}

function openAddForm() {
  resetTlForm();
  showTlForm(true);
}

function editMilestone(id) {
  const m = currentMilestones.find((x) => x.id === id);
  if (!m) return;
  editingId = id;
  $("tl-date").value = m.date || "";
  $("tl-title").value = m.title || "";
  $("tl-desc").value = m.desc || "";
  if (m.photo) {
    tlPhoto = m.photo; // existing url — stays unchanged unless replaced or cleared below
    $("tl-preview-img").src = m.photo;
    $("tl-preview").classList.remove("hidden");
    $("tl-attach").classList.add("hidden");
  } else {
    tlPhoto = null;
    $("tl-preview").classList.add("hidden");
    $("tl-attach").classList.remove("hidden");
  }
  $("tl-save").textContent = "update";
  showTlForm(true);
  $("tl-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelTlForm() {
  resetTlForm();
  showTlForm(false);
}

async function handleTlFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  $("tl-attach").textContent = "processing...";
  try {
    tlPhoto = await resizeImage(file);
    $("tl-preview-img").src = tlPhoto;
    $("tl-preview").classList.remove("hidden");
    $("tl-attach").classList.add("hidden");
  } catch {
    showError("tl-error", "Couldn't read that image.");
  }
  $("tl-attach").innerHTML = "&#128247; attach a photo (optional)";
  e.target.value = "";
}

function clearTlPhoto() {
  tlPhoto = null;
  $("tl-preview").classList.add("hidden");
  $("tl-attach").classList.remove("hidden");
}

async function saveMilestone() {
  const title = $("tl-title").value.trim();
  if (!title) { showError("tl-error", "Give it a title first."); return; }
  const isEdit = !!editingId;
  const btn = $("tl-save");
  btn.disabled = true; btn.textContent = isEdit ? "updating..." : "saving...";
  try {
    const payload = { date: $("tl-date").value, title, desc: $("tl-desc").value, photo: tlPhoto };
    if (isEdit) {
      await api("/milestones/" + editingId, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/milestones", { method: "POST", body: JSON.stringify(payload) });
    }
    resetTlForm();
    showTlForm(false);
    loadTimeline();
    return; // resetTlForm() above already restored the button's label/state
  } catch (err) {
    showError("tl-error", "Couldn't save: " + err.message);
  }
  btn.disabled = false; btn.textContent = isEdit ? "update" : "save";
}

async function removeMilestone(id) {
  if (!confirm("Remove this moment?")) return;
  try { await api("/milestones/" + id, { method: "DELETE" }); loadTimeline(); } catch {}
}

// ---------- photo album ----------
async function loadPhotos() {
  const grid = $("photo-grid");
  try {
    const items = await api("/photos");
    $("ph-empty").classList.toggle("hidden", items.length > 0);
    grid.innerHTML = items.map((p) => `
      <div class="photo-card">
        <button class="photo-remove" onclick="removePhoto('${p.id}')" aria-label="Remove">&#10005;</button>
        <img src="${esc(p.src)}" alt="${esc(p.caption || "photo")}"
             onclick="openLightbox('${esc(p.src)}', '${jsAttr(p.caption || "")}', '${esc(p.by)}')" />
        <div class="photo-meta">
          ${p.caption ? `<div class="photo-caption">${esc(p.caption)}</div>` : ""}
          <div class="photo-by">added by ${esc(p.by)}</div>
        </div>
      </div>`).join("");
  } catch (err) {
    grid.innerHTML = `<p class="empty">couldn't load photos — ${esc(err.message)}</p>`;
  }
}

async function handlePhFile(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const btn = $("ph-add-btn");

  if (files.length === 1) {
    // Single photo — same as before: preview it, let them add a caption.
    btn.textContent = "processing...";
    btn.disabled = true;
    try {
      phPending = await resizeImage(files[0]);
      $("ph-pending-img").src = phPending;
      $("ph-pending").classList.remove("hidden");
      btn.classList.add("hidden");
    } catch {
      showError("ph-error", "Couldn't read that image.");
    }
    btn.innerHTML = "&#128247; add photos";
    btn.disabled = false;
    e.target.value = "";
    return;
  }

  // Multiple photos selected — bulk import, no per-photo captions.
  // Uploads sequentially so a big batch doesn't choke the browser or server.
  btn.disabled = true;
  showError("ph-error", "");
  let ok = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    btn.textContent = `uploading ${i + 1}/${files.length}...`;
    try {
      const dataUrl = await resizeImage(files[i]);
      await api("/photos", { method: "POST", body: JSON.stringify({ src: dataUrl, caption: "", by: who }) });
      ok++;
    } catch {
      failed++;
    }
  }
  loadPhotos();
  btn.disabled = false;
  btn.innerHTML = "&#128247; add photos";
  if (failed > 0) showError("ph-error", `Added ${ok}, ${failed} failed — try re-selecting those.`);
  e.target.value = "";
}

function discardPending() {
  phPending = null;
  $("ph-caption").value = "";
  $("ph-pending").classList.add("hidden");
  $("ph-add-btn").classList.remove("hidden");
  showError("ph-error", "");
}

async function savePhoto() {
  if (!phPending) return;
  const btn = $("ph-save");
  btn.disabled = true; btn.textContent = "adding...";
  try {
    await api("/photos", {
      method: "POST",
      body: JSON.stringify({ src: phPending, caption: $("ph-caption").value, by: who }),
    });
    discardPending();
    loadPhotos();
  } catch (err) {
    showError("ph-error", "Couldn't save: " + err.message);
  }
  btn.disabled = false; btn.textContent = "add to album";
}

async function removePhoto(id) {
  if (!confirm("Remove this photo?")) return;
  try { await api("/photos/" + id, { method: "DELETE" }); loadPhotos(); } catch {}
}

// ---------- lightbox ----------
function openLightbox(src, caption, by) {
  $("lightbox-img").src = src;
  $("lightbox-meta").innerHTML =
    (caption ? `<div class="lightbox-caption">${esc(caption)}</div>` : "") +
    (by ? `<div class="lightbox-by">added by ${esc(by)}</div>` : "");
  $("lightbox").classList.remove("hidden");
}
function closeLightbox() { $("lightbox").classList.add("hidden"); }

// ---------- notes ----------
async function loadNotes() {
  const list = $("notes-list");
  try {
    const items = await api("/notes");
    $("note-empty").classList.toggle("hidden", items.length > 0);
    list.innerHTML = items.map((n) => `
      <div class="note-card ${n.by === NAME_A ? "ave" : ""}">
        <div class="note-top">
          <span class="note-author">${esc(n.by)}</span>
          <span class="note-date">${new Date(n.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          <button class="icon-btn note-del" onclick="removeNote('${n.id}')" aria-label="Remove">&#128465;</button>
        </div>
        <p>${esc(n.text)}</p>
      </div>`).join("");
  } catch (err) {
    list.innerHTML = `<p class="empty">couldn't load notes — ${esc(err.message)}</p>`;
  }
}

async function saveNote() {
  const text = $("note-text").value.trim();
  if (!text) return;
  const btn = $("note-send");
  btn.disabled = true;
  try {
    await api("/notes", { method: "POST", body: JSON.stringify({ text, by: who }) });
    $("note-text").value = "";
    showError("note-error", "");
    loadNotes();
  } catch (err) {
    showError("note-error", "Couldn't save: " + err.message);
  }
  btn.disabled = false;
}

async function removeNote(id) {
  if (!confirm("Remove this note?")) return;
  try { await api("/notes/" + id, { method: "DELETE" }); loadNotes(); } catch {}
}

// ---------- pings ----------
async function loadPings() {
  try {
    const pings = await api("/pings");
    const other = who === NAME_A ? NAME_B : NAME_A;
    const banner = $("ping-banner");
    if (pings[other]) {
      banner.innerHTML = `&#10024; <span><strong>${esc(other)}</strong> was thinking about you &middot; ${timeAgo(pings[other])}</span>`;
      banner.classList.remove("hidden");
    }
  } catch {}
}

async function sendPing() {
  const btn = $("ping-btn");
  btn.disabled = true;
  try {
    await api("/ping", { method: "POST", body: JSON.stringify({ by: who }) });
    btn.classList.add("sent");
    btn.innerHTML = "sent &#128155;";
    setTimeout(() => {
      btn.classList.remove("sent");
      btn.innerHTML = "&#10084; thinking about you";
      btn.disabled = false;
    }, 2500);
  } catch {
    btn.disabled = false;
  }
}

// ---------- push notifications ----------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function setupNotifUI() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return; // unsupported browser
  const reg = await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.getSubscription();
  if (!sub || Notification.permission !== "granted") {
    $("notif-btn").classList.remove("hidden");
  } else {
    // Re-send the subscription on every load so the server always has a fresh copy.
    await api("/subscribe", { method: "POST", body: JSON.stringify({ who, subscription: sub }) }).catch(() => {});
  }
}

async function enableNotifications() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api("/vapid-public-key");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api("/subscribe", { method: "POST", body: JSON.stringify({ who, subscription: sub }) });
    $("notif-btn").classList.add("hidden");
  } catch (err) {
    alert("Couldn't enable notifications: " + err.message);
  }
}

// ---------- boot ----------
function boot() {
  $("gate").classList.add("hidden");
  $("main").classList.remove("hidden");
  $("days-num").textContent = Math.max(0, Math.floor((new Date().setHours(0,0,0,0) - START_DATE) / 86400000));
  $("note-text").placeholder = `leave something for the other one, ${who}...`;
  loadTimeline();
  loadPhotos();
  loadNotes();
  loadPings();
  setupNotifUI();
  setInterval(loadPings, 30000);
}

async function init() {
  await loadConfig();
  loadThemeOverrides();
  document.querySelector(".marquee-names").innerHTML =
    `${NAME_A.toLowerCase()} <span class="marquee-heart">&#9825;</span> ${NAME_B.toLowerCase()}`;
  const gateBtns = document.querySelectorAll(".gate-btn");
  gateBtns[0].textContent = NAME_A;
  gateBtns[0].onclick = () => pickIdentity(NAME_A);
  gateBtns[1].textContent = NAME_B;
  gateBtns[1].onclick = () => pickIdentity(NAME_B);
  if (who) boot();
}
init();

// ---------- personal theme override ----------
function loadThemeOverrides() {
  const saved = JSON.parse(localStorage.getItem("themeOverride") || "{}");
  if (saved.accent) { applyAccentColor("--accent-rgb", saved.accent); $("theme-accent").value = saved.accent; }
  if (saved.accent2) { applyAccentColor("--accent2-rgb", saved.accent2); $("theme-accent2").value = saved.accent2; }
  if (saved.bg) { applyBackgroundColor(saved.bg); $("theme-bg").value = saved.bg; }
}

function saveThemeOverride(key, value) {
  const saved = JSON.parse(localStorage.getItem("themeOverride") || "{}");
  saved[key] = value;
  localStorage.setItem("themeOverride", JSON.stringify(saved));
}

function resetTheme() {
  localStorage.removeItem("themeOverride");
  location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  $("theme-accent").addEventListener("input", (e) => {
    applyAccentColor("--accent-rgb", e.target.value);
    saveThemeOverride("accent", e.target.value);
  });
  $("theme-accent2").addEventListener("input", (e) => {
    applyAccentColor("--accent2-rgb", e.target.value);
    saveThemeOverride("accent2", e.target.value);
  });
  $("theme-bg").addEventListener("input", (e) => {
    applyBackgroundColor(e.target.value);
    saveThemeOverride("bg", e.target.value);
  });
});

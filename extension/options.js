const $ = s => document.querySelector(s);
const statusEl = $("#status");
let state = { profile: {}, custom: [], answers: [] };
let apps = [];
let appsOn = true;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "value") e.value = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

let uid = 0;
function field(label, control, hint) {
  control.id = "c" + ++uid;
  return h("div", { class: "field" }, h("label", { for: control.id }, label), control, hint ? h("p", { class: "fieldhint" }, hint) : null);
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

async function run(fn) {
  try {
    await fn();
    setStatus("All changes saved");
    updateUsage();
  } catch (e) {
    setStatus("Couldn’t save: " + e.message, true);
  }
}

const timers = new Map();
function later(key, fn, ms = 500) {
  setStatus("Saving…");
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); run(fn); }, ms));
}

function renderProfile() {
  const wrap = $("#profileGroups");
  wrap.replaceChildren();
  for (const group of [...new Set(FIELDS.map(f => f.group))]) {
    const grid = h("div", { class: "grid" });
    for (const f of FIELDS.filter(f => f.group === group)) {
      const input = h("input", {
        type: f.type || "text",
        value: state.profile[f.key] || "",
        placeholder: f.ph,
        autocomplete: f.ac ? f.ac[0] : "off",
        oninput: e => {
          const v = e.target.value.trim();
          if (v) state.profile[f.key] = v; else delete state.profile[f.key];
          later("profile", () => AK.saveProfile(state.profile));
        }
      });
      grid.append(field(f.label, input));
    }
    wrap.append(h("fieldset", {}, h("legend", {}, group), grid));
  }
}

function renderCustom() {
  const list = $("#customList");
  list.replaceChildren();
  if (!state.custom.length) {
    list.append(h("p", { class: "empty" }, "No extra fields yet. Add one for things like gender, veteran status, or a referral code."));
  }
  for (const c of state.custom) {
    const upd = k => e => { c[k] = e.target.value; later("custom", () => AK.saveCustom(state.custom)); };
    list.append(h("div", { class: "item" },
      h("div", { class: "grid" },
        field("Name", h("input", { value: c.label || "", placeholder: "e.g. Gender", oninput: upd("label") })),
        field("Label keywords", h("input", { value: c.keywords || "", placeholder: "e.g. gender, sex", oninput: upd("keywords") }), "Separate keywords with commas."),
        field("Value", h("input", { value: c.value || "", placeholder: "e.g. Prefer not to say", oninput: upd("value") }))
      ),
      h("div", { class: "itemfoot" }, h("span"),
        h("button", {
          type: "button", class: "text danger",
          onclick: () => {
            state.custom = state.custom.filter(x => x !== c);
            renderCustom();
            run(() => AK.saveCustom(state.custom));
          }
        }, "Remove"))
    ));
  }
}

function renderAnswers() {
  const list = $("#ansList");
  list.replaceChildren();
  const q = normalize($("#ansSearch").value);
  const shown = state.answers.filter(a => !q || normalize(a.q + " " + a.a).includes(q));
  if (!state.answers.length) {
    list.append(h("p", { class: "empty" }, "No saved answers yet. On an application, write your answer, then tap “Save as answer” in the suggestion box. Or add one here."));
  } else if (!shown.length) {
    list.append(h("p", { class: "empty" }, "No answers match that search."));
  }
  for (const a of shown) {
    const save = () => later("ans:" + a.id, () => AK.saveAnswer(a));
    list.append(h("div", { class: "item" },
      field("Question", h("input", { value: a.q, placeholder: "e.g. Why do you want to work here?", oninput: e => { a.q = e.target.value; save(); } })),
      field("Answer", h("textarea", { rows: 5, value: a.a, oninput: e => { a.a = e.target.value; save(); } })),
      h("div", { class: "itemfoot" },
        h("span", { class: "meta" }, a.t ? "Updated " + new Date(a.t).toLocaleDateString() : "New"),
        h("button", {
          type: "button", class: "text danger",
          onclick: () => {
            state.answers = state.answers.filter(x => x !== a);
            renderAnswers();
            run(() => AK.deleteAnswer(a.id));
          }
        }, "Delete"))
    ));
  }
}

// ---------- Resume ----------
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const kb = n => Math.max(1, Math.round(n / 1024)) + " KB";
const when = t => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function setResumeMsg(text, isError) {
  const m = $("#resumeMsg");
  m.textContent = text;
  m.classList.toggle("error", !!isError);
}

// Turns a share link into a direct download, plus the sites it redirects through.
// Those are the only sites Firefox is asked to let Apply Kit reach.
function resumeSource(link) {
  let u;
  try { u = new URL(link); } catch { throw new Error("That doesn’t look like a link."); }
  if (u.protocol !== "https:") throw new Error("The link needs to start with https://.");
  const google = ["https://*.googleusercontent.com/*"];
  let m = u.pathname.match(/\/file\/d\/([\w-]+)/);
  if (u.hostname === "drive.google.com") {
    const id = m ? m[1] : u.searchParams.get("id");
    if (!id) throw new Error("That Google Drive link doesn’t point to a file.");
    return { url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
      origins: ["https://drive.google.com/*", "https://drive.usercontent.google.com/*", ...google] };
  }
  m = u.pathname.match(/\/document\/d\/([\w-]+)/);
  if (u.hostname === "docs.google.com" && m) {
    return { url: `https://docs.google.com/document/d/${m[1]}/export?format=pdf`, origins: ["https://docs.google.com/*", ...google] };
  }
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) {
    u.searchParams.set("dl", "1");
    return { url: u.href, origins: [u.origin + "/*", "https://*.dropboxusercontent.com/*"] };
  }
  return { url: u.href, origins: [u.origin + "/*"] };
}

function nameFrom(res, url) {
  const cd = res.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  let name = "";
  try { name = star ? decodeURIComponent(star[1].trim()) : plain ? plain[1].trim() : ""; } catch { /* odd header */ }
  if (!name) name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  if (!/\.pdf$/i.test(name)) name = "Resume.pdf";
  return name;
}

async function fetchResume(link) {
  let src;
  try { src = resumeSource(link); } catch (e) { setResumeMsg(e.message, true); return; }
  // Firefox only shows its permission prompt in direct response to a tap, so this has to
  // be the first thing that waits.
  const granted = await browser.permissions.request({ origins: src.origins });
  if (!granted) { setResumeMsg("Firefox wasn’t given permission to reach that site, so nothing was downloaded.", true); return; }
  setResumeMsg("Downloading…");
  try {
    const res = await fetch(src.url, { credentials: "omit" });
    if (!res.ok) throw new Error(`The site answered with error ${res.status}.`);
    const buf = await res.arrayBuffer();
    const head = String.fromCharCode(...new Uint8Array(buf, 0, Math.min(5, buf.byteLength)));
    if (head !== "%PDF-") throw new Error("That link gave a web page, not a PDF. Check that anyone with the link can view it.");
    await AK.saveResume(buf, nameFrom(res, src.url), "link", link);
    setResumeMsg("");
    await loadAndRender();
  } catch (e) {
    setResumeMsg("Couldn’t download it. " + (e.message === "NetworkError when attempting to fetch resource." ? "Check the link and your connection." : e.message), true);
  }
}

function renderResume() {
  const card = $("#resumeCard");
  const here = state.resumeHere, synced = state.resume;
  card.replaceChildren();
  // The other device has a newer resume than this one.
  if (synced && (!here || synced.t > here.t)) {
    const n = h("div", { class: "notice" }, h("span", {},
      `Your other device has ${here ? "a newer resume" : "a resume"}: ${synced.name}, ${when(synced.t)}.`));
    if (synced.link) n.append(h("button", { type: "button", onclick: () => fetchResume(synced.link) }, "Download it here"));
    else n.append(h("span", {}, "Upload the same PDF here to use it on this device."));
    card.append(n);
  }
  if (!here) {
    card.append(h("div", { class: "card empty" }, "No resume on this device yet."));
  } else {
    const via = here.source === "link" ? "from your link" : "uploaded";
    const remove = h("button", { type: "button", class: "text danger", onclick: async () => {
      await AK.removeResume();
      if (here.link) {
        try { await browser.permissions.remove({ origins: resumeSource(here.link).origins }); } catch { /* already gone */ }
      }
      $("#resumeLink").value = "";
      await loadAndRender();
    } }, "Remove");
    const actions = h("div", {});
    if (here.link) actions.append(h("button", { type: "button", class: "text", onclick: () => fetchResume(here.link) }, "Refresh"));
    actions.append(remove);
    card.append(h("div", { class: "card" },
      h("span", { class: "doc", "aria-hidden": "true" }, "PDF"),
      h("div", { class: "what" }, h("span", { class: "name" }, here.name), h("span", { class: "meta" }, `${kb(here.size)} · ${via} ${when(here.t)}`)),
      actions));
  }
  const link = (here && here.link) || (synced && synced.link) || "";
  if (link && !$("#resumeLink").value) $("#resumeLink").value = link;
}

$("#resumeFetch").addEventListener("click", () => fetchResume($("#resumeLink").value.trim()));
$("#resumeFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    await AK.saveResume(await file.arrayBuffer(), file.name, "upload");
    setResumeMsg("");
    await loadAndRender();
  } catch (err) {
    setResumeMsg("Couldn’t save it. " + err.message, true);
  }
});

async function updateUsage() {
  try {
    const bytes = await browser.storage.sync.getBytesInUse(null);
    $("#usage").textContent = `Using ${(bytes / 1024).toFixed(1)} KB of about 100 KB sync storage.`;
  } catch {
    // Not every Firefox version reports this.
  }
}

async function loadAndRender() {
  state = await AK.load();
  renderProfile();
  renderCustom();
  renderAnswers();
  renderResume();
  await loadApps();
  updateUsage();
}

$("#addCustom").addEventListener("click", () => {
  state.custom.push({ id: AK.newId(), label: "", keywords: "", value: "" });
  renderCustom();
  const inputs = $("#customList").querySelectorAll(".item:last-child input");
  if (inputs[0]) inputs[0].focus();
});

$("#addAns").addEventListener("click", () => {
  $("#ansSearch").value = "";
  state.answers.unshift({ id: AK.newId(), q: "", a: "", t: 0 });
  renderAnswers();
  $("#ansList input").focus();
});

$("#ansSearch").addEventListener("input", renderAnswers);

// What a backup file or transfer code holds. The resume isn't included: it's too big
// for a code, and each device keeps its own copy.
const backupData = () => ({ version: 1, profile: state.profile, custom: state.custom, answers: state.answers });

async function importBackup(parsed, what) {
  if (!parsed || typeof parsed.profile !== "object") throw new Error(`That ${what} isn’t from Apply Kit.`);
  if (!confirm(`Replace everything here with this ${what}?`)) return false;
  await AK.replaceAll(parsed);
  await loadAndRender();
  return true;
}

$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(backupData(), null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `apply-kit-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setStatus("Backup exported");
});

$("#import").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (await importBackup(JSON.parse(await file.text()), "backup file")) setStatus("Backup imported");
  } catch (err) {
    setStatus("Couldn’t import: " + err.message, true);
  }
});

// ---------- Applications log ----------
const STATUSES = ["Filled", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"];
const isoDay = t => new Date(t).toISOString().slice(0, 10);

async function loadApps() {
  [apps, appsOn] = await Promise.all([AK.loadApps(), AK.appsEnabled()]);
  renderApps();
}

function renderApps() {
  const list = $("#appsList");
  list.replaceChildren();
  $("#appsOn").checked = appsOn;
  $("#appsActions").hidden = !apps.length;
  if (!apps.length) {
    list.append(h("p", { class: "empty" }, appsOn ? "Nothing yet. Forms you fill show up here." : "Logging is off."));
    return;
  }
  for (const a of apps) {
    const save = () => later("apps", () => AK.saveApps(apps));
    const status = h("select", { onchange: e => { a.status = e.target.value; run(() => AK.saveApps(apps)); } },
      ...STATUSES.map(s => h("option", { value: s, selected: s === a.status }, s)));
    const again = a.last - a.t > 60 * 60 * 1000 ? `, again ${when(a.last)}` : "";
    list.append(h("div", { class: "app" },
      field("Company", h("input", { value: a.company, oninput: e => { a.company = e.target.value; save(); } })),
      field("Role", h("input", { value: a.role, oninput: e => { a.role = e.target.value; save(); } })),
      field("Status", status),
      h("div", { class: "foot" },
        h("span", { class: "meta" }, `Filled ${when(a.t)}${again}`),
        h("a", { href: a.url, target: "_blank", rel: "noopener" }, a.host),
        h("button", { type: "button", class: "text danger", onclick: () => {
          apps = apps.filter(x => x !== a);
          renderApps();
          run(() => AK.saveApps(apps));
        } }, "Delete"))));
  }
}

$("#appsOn").addEventListener("change", e => {
  appsOn = e.target.checked;
  renderApps();
  run(() => AK.setAppsEnabled(appsOn));
});

// A cell starting with = + - @ would run as a formula in a spreadsheet, and company and
// role names come from web pages, so those get a leading apostrophe.
function csvCell(v) {
  let t = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
const appsCsv = () => [["Company", "Role", "Status", "First filled", "Last filled", "Link"],
  ...apps.map(a => [a.company, a.role, a.status, isoDay(a.t), isoDay(a.last), a.url])]
  .map(row => row.map(csvCell).join(",")).join("\r\n");

$("#appsCsv").addEventListener("click", () => {
  const blob = new Blob([appsCsv()], { type: "text/csv" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `apply-kit-applications-${isoDay(Date.now())}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setStatus("CSV downloaded");
});

$("#appsCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(appsCsv());
    setStatus("CSV copied. Paste it into a spreadsheet.");
  } catch (e) {
    setStatus("Couldn’t copy: " + e.message, true);
  }
});

// ---------- Transfer code ----------
// The same data as a backup file, gzipped and base64-encoded into one line of text you
// can paste into a notes app or a chat with yourself. Not encrypted.
const CODE_PREFIX = "APPLYKIT1.";
// Locked codes: AES-256-GCM with a key derived from your passphrase (PBKDF2-SHA-256).
// Layout after the prefix: 16-byte salt, 12-byte IV, then the encrypted gzip data.
const LOCKED_PREFIX = "APPLYKIT1L.";
const PBKDF2_ROUNDS = 310000;

async function passKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function lock(bytes, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await passKey(pass, salt), bytes));
  const out = new Uint8Array(28 + sealed.length);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(sealed, 28);
  return out;
}

async function unlock(bytes, pass) {
  try {
    const key = await passKey(pass, bytes.subarray(0, 16));
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(16, 28) }, key, bytes.subarray(28)));
  } catch {
    throw new Error("Wrong passphrase, or the code got changed on the way.");
  }
}

async function gzip(text, compress) {
  const stream = new Blob([text]).stream().pipeThrough(compress ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

$("#makeCode").addEventListener("click", async () => {
  const pass = $("#codePass").value;
  const packed = await gzip(JSON.stringify(backupData()), true);
  const code = pass ? LOCKED_PREFIX + toBase64Url(await lock(packed, pass)) : CODE_PREFIX + toBase64Url(packed);
  $("#codeText").value = code;
  $("#codeMeta").textContent = `${code.length.toLocaleString()} characters · ${plural(state.answers.length, "saved answer")} · ${pass ? "locked with your passphrase" : "not locked"}`;
  $("#codeOut").hidden = false;
  $("#codeText").select();
});

$("#copyCode").addEventListener("click", async () => {
  const box = $("#codeText");
  try {
    await navigator.clipboard.writeText(box.value);
  } catch {
    box.select();
    document.execCommand("copy");
  }
  setStatus("Transfer code copied");
});

$("#useCode").addEventListener("click", async () => {
  // Chat apps and email can wrap long lines, so ignore any whitespace.
  const raw = $("#codeIn").value.replace(/\s+/g, "");
  try {
    const locked = raw.startsWith(LOCKED_PREFIX);
    if (!locked && !raw.startsWith(CODE_PREFIX)) throw new Error("That isn’t an Apply Kit transfer code. It should start with APPLYKIT1.");
    const pass = $("#codePass").value;
    if (locked && !pass) throw new Error("This code is locked. Enter its passphrase in the Passphrase box, then tap Import code again.");
    let bytes;
    try {
      bytes = fromBase64Url(raw.slice((locked ? LOCKED_PREFIX : CODE_PREFIX).length));
    } catch {
      throw new Error("The code is incomplete or got changed on the way. Copy it again in full.");
    }
    if (locked) bytes = await unlock(bytes, pass);
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(await gzip(bytes, false)));
    } catch {
      throw new Error("The code is incomplete or got changed on the way. Copy it again in full.");
    }
    if (await importBackup(parsed, "transfer code")) {
      $("#codeIn").value = "";
      $("#codePass").value = "";
      setStatus("Transfer code imported");
    }
  } catch (err) {
    setStatus("Couldn’t import: " + err.message, true);
  }
});

// ---------- Updates ----------
// Only Firefox can install a new version. This just reads the same updates.json Firefox
// checks, when you tap the button, and says whether there's something newer.
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

$("#version").textContent = browser.runtime.getManifest().version;
$("#checkUpdate").addEventListener("click", async () => {
  const out = $("#updateMsg");
  const manifest = browser.runtime.getManifest();
  const gecko = manifest.browser_specific_settings.gecko;
  out.classList.remove("error");
  out.textContent = "Checking…";
  try {
    const res = await fetch(gecko.update_url, { cache: "no-store", credentials: "omit" });
    if (!res.ok) throw new Error(`error ${res.status}`);
    const list = (((await res.json()).addons || {})[gecko.id] || {}).updates || [];
    const latest = list.reduce((best, u) => (!best || newer(u.version, best.version) ? u : best), null);
    if (!latest || !newer(latest.version, manifest.version)) {
      out.textContent = `You have the latest version (${manifest.version}).`;
      return;
    }
    const page = latest.update_link.replace(/\/releases\/download\/([^/]+)\/.*$/, "/releases/tag/$1");
    out.replaceChildren(
      `Version ${latest.version} is out. Desktop Firefox installs it by itself within a day; to get it now, open about:addons, click the gear and choose “Check for Updates”. On a phone, download it from the `,
      h("a", { href: page, target: "_blank", rel: "noopener" }, "release page"),
      " and install it from file.");
  } catch (e) {
    out.textContent = "Couldn’t check for updates (" + e.message + ").";
    out.classList.add("error");
  }
});

// Pick up changes synced from your other device, unless you're mid-edit.
browser.storage.onChanged.addListener((changes, area) => {
  const editing = document.activeElement && document.activeElement.matches("input, textarea, select");
  if (area === "local" && (changes.apps || changes.appsOff) && !editing && !timers.size) loadApps();
  if (area !== "sync" && !(area === "local" && changes.resumeInfo)) return;
  if (!editing && !timers.size) loadAndRender();
});

loadAndRender().catch(e => setStatus("Couldn’t load your profile: " + e.message, true));

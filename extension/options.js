const $ = s => document.querySelector(s);
const statusEl = $("#status");
let state = { profile: {}, custom: [], answers: [] };

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
  timers.set(key, setTimeout(() => run(fn), ms));
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

// ---------- Transfer code ----------
// The same data as a backup file, gzipped and base64-encoded into one line of text you
// can paste into a notes app or a chat with yourself. Not encrypted.
const CODE_PREFIX = "APPLYKIT1.";

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
  const code = CODE_PREFIX + toBase64Url(await gzip(JSON.stringify(backupData()), true));
  $("#codeText").value = code;
  $("#codeMeta").textContent = `${code.length.toLocaleString()} characters · ${plural(state.answers.length, "saved answer")}`;
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
    if (!raw.startsWith(CODE_PREFIX)) throw new Error("That isn’t an Apply Kit transfer code. It should start with " + CODE_PREFIX);
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(await gzip(fromBase64Url(raw.slice(CODE_PREFIX.length)), false)));
    } catch {
      throw new Error("The code is incomplete or got changed on the way. Copy it again in full.");
    }
    if (await importBackup(parsed, "transfer code")) {
      $("#codeIn").value = "";
      setStatus("Transfer code imported");
    }
  } catch (err) {
    setStatus("Couldn’t import: " + err.message, true);
  }
});

// Pick up changes synced from your other device, unless you're mid-edit.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" && !(area === "local" && changes.resumeInfo)) return;
  const editing = document.activeElement && document.activeElement.matches("input, textarea");
  if (!editing && !timers.size) loadAndRender();
});

loadAndRender().catch(e => setStatus("Couldn’t load your profile: " + e.message, true));

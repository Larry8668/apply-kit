const $ = s => document.querySelector(s);
const statusEl = $("#status");
let state = { profile: {}, custom: [], work: [], edu: [], answers: [] };
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

// ---------- Work history and education ----------
// Dates are stored as "2021-05" (or just "2021"), entered as a month menu and a year box.
function monthYear(label, value, onChange, disabled) {
  const [y = "", m = ""] = String(value || "").split("-");
  const month = h("select", { "aria-label": label + " month", disabled },
    h("option", { value: "" }, "Month"), ...MONTHS.map((name, i) => h("option", { value: String(i + 1).padStart(2, "0"), selected: m === String(i + 1).padStart(2, "0") }, name.slice(0, 3))));
  const year = h("input", { type: "text", inputmode: "numeric", maxlength: "4", placeholder: "Year", value: y, "aria-label": label + " year", disabled });
  const emit = () => {
    const yy = year.value.trim();
    onChange(/^\d{4}$/.test(yy) ? (month.value ? `${yy}-${month.value}` : yy) : "");
  };
  month.addEventListener("change", emit);
  year.addEventListener("input", emit);
  return h("div", { class: "field" }, h("span", { class: "flabel" }, label), h("div", { class: "monthyear" }, month, year));
}

const HISTORY = {
  work: {
    list: () => state.work, set: v => { state.work = v; }, save: () => AK.saveWork(state.work), box: "#workList", noun: "job",
    title: (e, i) => `Job ${i + 1}${e.company ? " · " + e.company : ""}`,
    empty: "No jobs yet. Add your current or most recent one first.",
    fields: [["company", "Company", "e.g. Example Labs"], ["title", "Job title", "e.g. Senior Software Engineer"], ["location", "Location", "e.g. Bengaluru, India"]],
    current: "I currently work here", start: "Start", end: "End", description: true
  },
  edu: {
    list: () => state.edu, set: v => { state.edu = v; }, save: () => AK.saveEdu(state.edu), box: "#eduList", noun: "school",
    title: (e, i) => `Education ${i + 1}${e.school ? " · " + e.school : ""}`,
    empty: "No education yet. Add your highest or most relevant first.",
    fields: [["school", "School or university", "e.g. University of Example"], ["degree", "Degree", "e.g. Bachelor of Technology"], ["major", "Field of study", "e.g. Computer Science"],
      ["gpa", "Grade / GPA", "e.g. 8.6/10"], ["city", "City", ""], ["state", "State / province", ""], ["country", "Country", ""]],
    current: "I’m still studying here", start: "Start", end: "End or expected graduation", description: false
  }
};

function renderHistory(kind) {
  const H = HISTORY[kind];
  const box = $(H.box);
  box.replaceChildren();
  const list = H.list();
  if (!list.length) box.append(h("p", { class: "empty" }, H.empty));
  list.forEach((e, i) => {
    const save = () => later(kind, H.save);
    const set = k => ev => { e[k] = ev.target.value; save(); };
    const move = d => () => {
      const next = list.slice();
      [next[i], next[i + d]] = [next[i + d], next[i]];
      H.set(next);
      renderHistory(kind);
      run(H.save);
    };
    const endBox = monthYear(H.end, e.end, v => { e.end = v; save(); }, e.current);
    const head = h("div", { class: "entryhead" },
      h("strong", {}, H.title(e, i)),
      h("div", { class: "entryacts" },
        h("button", { type: "button", class: "text", disabled: i === 0, "aria-label": "Move up", title: "Move up", onclick: move(-1) }, "↑"),
        h("button", { type: "button", class: "text", disabled: i === list.length - 1, "aria-label": "Move down", title: "Move down", onclick: move(1) }, "↓"),
        h("button", { type: "button", class: "text danger", onclick: () => {
          H.set(list.filter(x => x !== e));
          renderHistory(kind);
          run(H.save);
        } }, "Remove")));
    const current = h("label", { class: "check inline" },
      h("input", { type: "checkbox", checked: !!e.current, onchange: ev => {
        e.current = ev.target.checked;
        for (const c of endBox.querySelectorAll("select, input")) c.disabled = e.current;
        save();
      } }), H.current);
    box.append(h("div", { class: "item entry" },
      head,
      h("div", { class: "grid" }, ...H.fields.map(([k, label, ph]) => field(label, h("input", { value: e[k] || "", placeholder: ph, oninput: set(k) })))),
      h("div", { class: "grid dates" }, monthYear(H.start, e.start, v => { e.start = v; save(); }), endBox),
      current,
      H.description ? field("Description (optional)", h("textarea", { rows: 3, value: e.description || "", placeholder: "What you did there, for forms that ask", oninput: set("description") })) : null));
  });
}

for (const kind of ["work", "edu"]) {
  $(kind === "work" ? "#addWork" : "#addEdu").addEventListener("click", () => {
    const H = HISTORY[kind];
    H.set([...H.list(), { id: AK.newId() }]);
    renderHistory(kind);
    const inputs = $(H.box).querySelectorAll(".entry:last-child input");
    if (inputs[0]) inputs[0].focus();
  });
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
    card.append(h("div", { class: "doccard empty" }, "No resume on this device yet."));
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
    card.append(h("div", { class: "doccard" },
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
  renderHistory("work");
  renderHistory("edu");
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
const backupData = () => ({ version: 1, profile: state.profile, custom: state.custom, work: state.work, edu: state.edu, answers: state.answers });

async function importBackup(parsed, what) {
  if (!parsed || typeof parsed.profile !== "object") throw new Error(`That ${what} isn’t from Apply Kit.`);
  if (!confirm(`Replace everything here with this ${what}?`)) return false;
  await AK.replaceAll(parsed);
  await loadAndRender();
  return true;
}

$("#export").addEventListener("click", () => {
  download(new Blob([JSON.stringify(backupData(), null, 2)], { type: "application/json" }), `apply-kit-backup-${isoDay(Date.now())}.json`);
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
const pad = n => String(n).padStart(2, "0");
const isoDay = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shortDay = t => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
function chevron() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M5.5 8l4.5 4.5L14.5 8");
  svg.append(path);
  return svg;
}
let appsFilter = "All";
const openApps = new Set();

async function loadApps() {
  [apps, appsOn] = await Promise.all([AK.loadApps(), AK.appsEnabled()]);
  renderApps();
}

function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function renderApps() {
  $("#appsOn").checked = appsOn;
  $("#appsExports").hidden = !apps.length;

  // Status filter chips with counts.
  const counts = { All: apps.length };
  for (const a of apps) counts[a.status] = (counts[a.status] || 0) + 1;
  if (appsFilter !== "All" && !counts[appsFilter]) appsFilter = "All";
  $("#appsFilters").hidden = !apps.length;
  $("#appsSearch").hidden = !apps.length;
  $("#appsFilters").replaceChildren(...["All", ...STATUSES].filter(s => s === "All" || counts[s]).map(s =>
    h("button", { type: "button", class: "chip", "aria-pressed": String(s === appsFilter), onclick: () => { appsFilter = s; renderApps(); } },
      s, h("b", {}, String(counts[s] || 0)))));

  const list = $("#appsList");
  list.replaceChildren();
  if (!apps.length) {
    list.className = "";
    list.append(h("div", { class: "appsempty" },
      h("strong", {}, appsOn ? "No applications yet" : "Logging is off"),
      appsOn ? "When you fill an application form, it shows up here with the company, role and link." : "Turn it on below to keep a list of the forms you fill."));
    return;
  }
  const q = normalize($("#appsSearch").value);
  const shown = apps.filter(a => (appsFilter === "All" || a.status === appsFilter) &&
    (!q || normalize(`${a.company} ${a.role} ${a.host} ${a.notes || ""}`).includes(q)));
  list.className = "apps";
  list.append(h("div", { class: "apphead", "aria-hidden": "true" },
    h("span", {}, "Company and role"), h("span", {}, "Site"), h("span", {}, "Status"), h("span", {}, "Filled"), h("span")));
  if (!shown.length) list.append(h("p", { class: "empty", style: "padding: 18px" }, "No applications match."));
  for (const a of shown) list.append(appRow(a));
}

function appRow(a) {
  const save = () => later("apps", () => AK.saveApps(apps));
  const row = h("div", { class: "app" + (openApps.has(a.id) ? " open" : "") });
  const toggle = () => {
    if (openApps.has(a.id)) openApps.delete(a.id); else openApps.add(a.id);
    row.replaceWith(appRow(a));
  };
  const status = h("select", {
    class: "pill", "data-status": a.status, "aria-label": "Status for " + (a.company || a.host),
    onclick: e => e.stopPropagation(),
    onchange: e => { a.status = e.target.value; e.target.dataset.status = a.status; run(() => AK.saveApps(apps)); renderApps(); }
  }, ...STATUSES.map(s => h("option", { value: s, selected: s === a.status }, s)));
  const more = h("button", { type: "button", class: "more", "aria-expanded": String(openApps.has(a.id)),
    "aria-label": (openApps.has(a.id) ? "Hide" : "Show") + " details", onclick: e => { e.stopPropagation(); toggle(); } }, chevron());
  row.append(h("div", { class: "appmain", onclick: toggle },
    h("div", { class: "who" }, h("span", { class: "company" }, a.company || a.host), h("span", { class: "role" }, a.role || "Role not detected")),
    h("span", { class: "site", title: a.url }, a.host),
    h("div", { class: "statuscell" }, status),
    h("span", { class: "date", title: new Date(a.t).toLocaleString() }, shortDay(a.t)),
    more));

  if (openApps.has(a.id)) {
    const again = a.last - a.t > 60 * 60 * 1000 ? ` · filled again ${when(a.last)}` : "";
    row.append(h("div", { class: "appdetail" },
      h("div", { class: "grid" },
        field("Company", h("input", { value: a.company, oninput: e => { a.company = e.target.value; save(); } })),
        field("Role", h("input", { value: a.role, oninput: e => { a.role = e.target.value; save(); } }))),
      h("div", {}, h("span", { class: "label" }, "Where you filled it"),
        h("div", { class: "linkline" },
          h("a", { href: a.url, target: "_blank", rel: "noopener", title: a.url }, a.url),
          h("a", { class: "button secondary", href: a.url, target: "_blank", rel: "noopener" }, "Open"))),
      a.fieldNames && a.fieldNames.length
        ? h("div", {}, h("span", { class: "label" }, `Fields Apply Kit filled (${a.fieldNames.length})`),
          h("div", { class: "tags" }, ...a.fieldNames.map(n => h("span", { class: "tag" }, n))))
        : null,
      field("Notes", h("textarea", { value: a.notes || "", placeholder: "Recruiter, referral, salary discussed, next steps…",
        oninput: e => { a.notes = e.target.value; save(); } })),
      h("div", { class: "foot" },
        h("span", { class: "meta" }, `First filled ${when(a.t)}${again}`),
        h("button", { type: "button", class: "text danger", onclick: () => {
          apps = apps.filter(x => x !== a);
          openApps.delete(a.id);
          renderApps();
          run(() => AK.saveApps(apps));
        } }, "Delete"))));
  }
  return row;
}

$("#appsSearch").addEventListener("input", renderApps);
$("#appsOn").addEventListener("change", e => {
  appsOn = e.target.checked;
  renderApps();
  run(() => AK.setAppsEnabled(appsOn));
});

const APP_COLUMNS = ["Company", "Role", "Status", "First filled", "Last filled", "Link", "Notes", "Fields filled"];
const appCells = a => [a.company, a.role, a.status, a.t, a.last, a.url, a.notes || "", (a.fieldNames || []).join(", ")];

// A cell starting with = + - @ would run as a formula in a spreadsheet, and company and
// role names come from web pages, so those get a leading apostrophe.
function csvCell(v) {
  let t = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
const appsCsv = () => [APP_COLUMNS, ...apps.map(a => appCells(a).map((v, i) => (i === 3 || i === 4 ? isoDay(v) : v)))]
  .map(row => row.map(csvCell).join(",")).join("\r\n");

$("#appsXlsx").addEventListener("click", () => {
  const rows = [APP_COLUMNS, ...apps.map(a => appCells(a).map((v, i) =>
    i === 3 || i === 4 ? { date: v } : i === 5 ? { text: v, link: v } : v))];
  download(XLSX_LITE.build("Applications", rows, [24, 34, 14, 13, 13, 48, 40, 40]), `apply-kit-applications-${isoDay(Date.now())}.xlsx`);
  setStatus("Excel file downloaded");
});

$("#appsCsv").addEventListener("click", () => {
  download(new Blob([appsCsv()], { type: "text/csv" }), `apply-kit-applications-${isoDay(Date.now())}.csv`);
  setStatus("CSV downloaded");
});

$("#appsCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(appsCsv());
    setStatus("Copied. Paste it into a spreadsheet.");
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

// Four groups of five characters from an alphabet without look-alikes (0/O, 1/l/I):
// about 98 bits of randomness, and still easy to type on a phone.
$("#genPass").addEventListener("click", () => {
  const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map(b => ALPHA[b % ALPHA.length]).join("");
  const box = $("#codePass");
  box.value = chars.match(/.{5}/g).join("-");
  box.type = "text";
  setStatus("Passphrase generated. Copy it before you leave this page.");
});

$("#copyPass").addEventListener("click", async () => {
  const box = $("#codePass");
  if (!box.value) { setStatus("There’s no passphrase to copy yet.", true); return; }
  try {
    await navigator.clipboard.writeText(box.value);
    setStatus("Passphrase copied");
  } catch (e) {
    setStatus("Couldn’t copy: " + e.message, true);
  }
});

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

// ---------- Pages ----------
// One section shows at a time; the address hash picks it, so links like
// options.html#applications open straight to it.
function showPage() {
  const id = location.hash.slice(1);
  const pages = [...document.querySelectorAll(".page")];
  const page = pages.find(p => p.id === "page-" + id) || pages[0];
  for (const p of pages) p.hidden = p !== page;
  for (const a of document.querySelectorAll(".nav a")) {
    if ("page-" + a.dataset.page === page.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = `${page.dataset.title} · Apply Kit`;
  const tab = document.querySelector(`.nav a[data-page="${page.id.slice(5)}"]`);
  if (tab) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
}
window.addEventListener("hashchange", () => { showPage(); scrollTo(0, 0); });
showPage();

loadAndRender().catch(e => setStatus("Couldn’t load your profile: " + e.message, true));

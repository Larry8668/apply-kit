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

$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, ...state }, null, 2)], { type: "application/json" });
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
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed.profile !== "object") throw new Error("That file isn’t an Apply Kit backup.");
    if (!confirm("Replace everything here with this backup?")) return;
    await AK.replaceAll(parsed);
    await loadAndRender();
    setStatus("Backup imported");
  } catch (err) {
    setStatus("Couldn’t import: " + err.message, true);
  }
});

// Pick up changes synced from your other device, unless you're mid-edit.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const editing = document.activeElement && document.activeElement.matches("input, textarea");
  if (!editing && !timers.size) loadAndRender();
});

loadAndRender().catch(e => setStatus("Couldn’t load your profile: " + e.message, true));

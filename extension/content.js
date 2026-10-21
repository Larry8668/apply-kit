// Runs on every page, but only wakes up on pages that look like job applications
// (or when you tap "Fill this page" in the toolbar menu).
(() => {
  if (window.__applyKit) return;
  window.__applyKit = true;

  const JOB_HINT = /job|career|apply|application|recruit|talent|hiring|greenhouse|lever\.co|workday|ashbyhq|smartrecruiters|icims|taleo|bamboohr|jobvite|workable|teamtailor|personio|successfactors|wellfound|rippling/i;
  const TEXTY = new Set(["", "text", "email", "tel", "url", "number", "search"]);
  const STOP = new Set("the and for you your are with this that have what why how our will would which who from about please describe tell any can into been was were has had not but all more most very also its".split(" "));

  let data = { profile: {}, custom: [], answers: [] };
  let forced = false;
  let filling = false;
  let jobCache = { url: "", val: false };

  async function reload() {
    try { data = await AK.load(); } catch (e) { console.warn("[Apply Kit]", e); }
  }

  // ---------- Reading the page ----------
  const clean = s => (s || "").replace(/\*/g, "").replace(/\(?\brequired\b\)?/gi, "").replace(/\s+/g, " ").trim();
  const textOf = n => (n ? clean(n.innerText || n.textContent) : "");
  const controlsIn = n => n.querySelectorAll("input:not([type=hidden]), textarea, select").length;
  const byIds = ids => clean((ids || "").split(/\s+/).map(id => textOf(document.getElementById(id))).join(" "));

  function labelFor(el) {
    if (el.labels && el.labels.length) {
      const t = clean([...el.labels].map(textOf).join(" "));
      if (t) return t;
    }
    const lb = byIds(el.getAttribute("aria-labelledby"));
    if (lb) return lb;
    const al = el.getAttribute("aria-label");
    if (al) return clean(al);
    // Walk up a few levels looking for a label-ish element, but stop once the
    // container holds more than one field (its label might belong to another).
    let node = el.parentElement;
    for (let i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
      if (controlsIn(node) > 1) break;
      const cand = node.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (cand && !cand.contains(el)) {
        const t = textOf(cand);
        if (t && t.length < 300) return t;
      }
    }
    return "";
  }

  function optionLabel(radio) {
    if (radio.labels && radio.labels.length) return textOf(radio.labels[0]);
    return clean(radio.getAttribute("aria-label") || (radio.nextSibling && radio.nextSibling.textContent) || radio.value);
  }

  function groupQuestion(radios) {
    const first = radios[0];
    const fs = first.closest("fieldset");
    if (fs && fs.querySelector("legend")) return textOf(fs.querySelector("legend"));
    const rg = first.closest('[role="radiogroup"]');
    if (rg) {
      const t = clean(rg.getAttribute("aria-label")) || byIds(rg.getAttribute("aria-labelledby"));
      if (t) return t;
    }
    const optionLabels = new Set(radios.flatMap(r => [...(r.labels || [])]));
    let node = first.parentElement;
    while (node && node !== document.body && !radios.every(r => node.contains(r))) node = node.parentElement;
    for (let i = 0; i < 3 && node && node !== document.body; i++, node = node.parentElement) {
      const cand = [...node.querySelectorAll('label, legend, [class*="label" i], [class*="question" i], p, span')]
        .find(c => !optionLabels.has(c) && !radios.some(r => c.contains(r)) && textOf(c).length > 3 && textOf(c).length < 300);
      if (cand) return textOf(cand);
    }
    return "";
  }

  function hintsFor(el, label) {
    const raw = [label, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name"), el.id, el.getAttribute("data-automation-id")];
    if (el.tagName === "SELECT" && el.options[0]) raw.push(el.options[0].text);
    return [...new Set(raw.map(normalize).filter(Boolean))];
  }

  function classify(hints, el) {
    for (const c of data.custom) {
      const kws = String(c.keywords || "").split(",").map(normalize).filter(Boolean);
      if (c.value && kws.length && hints.some(h => kws.some(k => h.includes(k)))) return { key: "custom", value: c.value, name: c.label || "Extra field" };
    }
    if (el) {
      const ac = (el.getAttribute("autocomplete") || "").toLowerCase().trim().split(/\s+/).pop();
      const f = ac && FIELDS.find(f => f.ac && f.ac.includes(ac));
      if (f) return { key: f.key, name: f.label };
    }
    for (const h of hints) {
      if (h.length > 160) continue; // long free-text questions are for saved answers
      for (const f of MATCH_ORDER) {
        if (f.max && h.length > f.max) continue;
        if (f.re.test(h) && !(f.not && f.not.test(h))) return { key: f.key, name: f.label };
      }
    }
    if (el && el.type === "email") return { key: "email", name: "Email" };
    if (el && el.type === "tel") return { key: "phone", name: "Phone" };
    return null;
  }

  function valueFor(m) {
    if (!m) return "";
    if (m.value != null) return m.value;
    const p = data.profile;
    const full = p.fullName || [p.firstName, p.lastName].filter(Boolean).join(" ");
    if (m.key === "fullName") return full;
    if (m.key === "firstName") return p.firstName || full.split(" ")[0] || "";
    if (m.key === "lastName") return p.lastName || full.split(" ").slice(1).join(" ");
    return p[m.key] || "";
  }

  // Picks the option whose text best matches the value ("No" → "No, I will not require…").
  function pickOption(options, value) {
    const v = normalize(value);
    if (!v) return null;
    const norm = options.map(o => ({ o, l: normalize(o.label) })).filter(x => x.l);
    const firstWord = s => s.split(" ")[0];
    const hit = norm.find(x => x.l === v)
      || (!v.includes(" ") && norm.find(x => firstWord(x.l) === v))
      || norm.find(x => x.l.startsWith(v + " ") || v.startsWith(x.l + " "))
      || (v.length > 3 && norm.find(x => x.l.includes(v)));
    return hit ? hit.o : null;
  }

  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const isField = el => el && !el.disabled && !el.readOnly && (
    el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
    (el.tagName === "INPUT" && TEXTY.has((el.getAttribute("type") || "").toLowerCase())));

  // Every field on the page we know how to fill and that is still empty.
  function scan() {
    const out = [];
    const groups = new Map();
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.disabled) continue;
      if (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "radio") {
        const k = el.name || el.closest('[role="radiogroup"], fieldset') || el;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(el);
        continue;
      }
      if (!isField(el) || !visible(el)) continue;
      const label = labelFor(el);
      if (el.tagName === "TEXTAREA" && label.length > 40) continue;
      const m = classify(hintsFor(el, label), el);
      const value = valueFor(m);
      if (!value) continue;
      if (el.tagName === "SELECT") {
        if (el.selectedIndex > 0 && el.value) continue;
        const option = pickOption([...el.options].map(o => ({ label: o.text, o })), value);
        if (option) out.push({ kind: "select", el, option: option.o });
      } else if (!el.value.trim()) {
        out.push({ kind: "text", el, value });
      }
    }
    for (const radios of groups.values()) {
      if (radios.length < 2 || radios.some(r => r.checked)) continue;
      const q = groupQuestion(radios);
      const value = valueFor(classify([normalize(q)], null));
      const option = value && pickOption(radios.map(r => ({ label: optionLabel(r), el: r })), value);
      if (option) out.push({ kind: "radio", el: option.el });
    }
    return out;
  }

  // ---------- Writing to the page ----------
  function setValue(el, v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
      : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    // Use the native setter so React/Vue-style forms notice the change.
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function flash(el) {
    const prev = [el.style.outline, el.style.outlineOffset];
    el.style.outline = "2px solid #F2B705";
    el.style.outlineOffset = "1px";
    setTimeout(() => { [el.style.outline, el.style.outlineOffset] = prev; }, 2500);
  }

  function fillAll({ quietIfEmpty = false } = {}) {
    filling = true;
    let n = 0;
    for (const m of scan()) {
      if (m.kind === "text") setValue(m.el, m.value);
      else if (m.kind === "select") setValue(m.el, m.option.value);
      else if (m.kind === "radio") m.el.click();
      m.el.dispatchEvent(new Event("blur"));
      flash(m.kind === "radio" && m.el.labels && m.el.labels[0] ? m.el.labels[0] : m.el);
      n++;
    }
    filling = false;
    hideChip();
    if (n) toast(`Filled ${n} field${n === 1 ? "" : "s"}. Check them before you submit.`);
    else if (!quietIfEmpty) toast("Nothing left to fill on this page.");
    refreshFab();
    return n;
  }

  function fillOne(el, v) {
    filling = true;
    if (el.tagName === "SELECT") {
      const option = pickOption([...el.options].map(o => ({ label: o.text, o })), v);
      if (option) setValue(el, option.o.value);
    } else {
      setValue(el, v);
    }
    flash(el);
    filling = false;
    el.focus();
    hideChip();
    refreshSoon();
  }

  // ---------- Saved answers ----------
  const stem = w => w.replace(/(ing|ed|es|s)$/, "");
  const tokens = s => new Set(normalize(s).split(" ").filter(w => w.length > 2 && !STOP.has(w)).map(stem));

  function rankAnswers(question) {
    const A = tokens(question);
    if (!A.size) return [];
    return data.answers
      .map(a => {
        const B = tokens(a.q);
        let shared = 0;
        for (const w of A) if (B.has(w)) shared++;
        return { a, s: B.size ? shared / Math.sqrt(A.size * B.size) : 0 };
      })
      .filter(x => x.s >= 0.25 && x.a.a)
      .sort((x, y) => y.s - x.s)
      .map(x => x.a);
  }

  async function saveAnswerFrom(el, question) {
    const existing = data.answers.find(x => normalize(x.q) === normalize(question));
    try {
      await AK.saveAnswer({ id: existing ? existing.id : AK.newId(), q: question, a: el.value.trim() });
      await reload();
      toast(existing ? "Saved answer updated." : "Answer saved. It'll be suggested for similar questions.");
    } catch (e) {
      toast("Couldn't save the answer: " + e.message);
    }
    hideChip();
  }

  // ---------- UI (inside a closed shadow root so sites can't restyle it) ----------
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .chip { position: fixed; width: min(360px, calc(100vw - 16px)); max-height: 50vh; overflow: auto;
      background: #fff; color: #17212B; border: 1px solid #17212B; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(23,33,43,.18); padding: 4px; font-size: 14px; line-height: 1.35; }
    .opt { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 3px solid transparent;
      border-radius: 6px; padding: 8px 10px; color: inherit; cursor: pointer; font-size: 14px; }
    .opt:hover, .opt:focus-visible { background: #F3F5F7; border-left-color: #F2B705; outline: none; }
    .what { display: block; font-size: 12px; color: #5B6875; margin-bottom: 2px; }
    .val { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    .foot { display: flex; gap: 6px; justify-content: flex-end; padding: 6px 4px 2px; border-top: 1px solid #D5DBE1; margin-top: 2px; }
    .foot:first-child { border-top: 0; margin-top: 0; }
    .act { background: none; border: 1px solid #D5DBE1; border-radius: 999px; padding: 6px 12px; font-size: 13px; color: #17212B; cursor: pointer; min-height: 32px; }
    .act.main { background: #17212B; border-color: #17212B; color: #fff; }
    .fab { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); display: flex; align-items: center; gap: 8px;
      background: #17212B; color: #fff; border: 0; border-radius: 999px; padding: 0 18px; min-height: 46px;
      font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(23,33,43,.28); }
    .fab:focus-visible, .act:focus-visible { outline: 3px solid #F2B705; outline-offset: 2px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #F2B705; }
    .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(76px + env(safe-area-inset-bottom, 0px));
      max-width: calc(100vw - 32px); background: #17212B; color: #fff; border-radius: 10px; padding: 10px 14px; font-size: 14px; }
    [hidden] { display: none !important; }
    @media (prefers-color-scheme: dark) {
      .chip { background: #1A2128; color: #E6EBEF; border-color: #3A4652; }
      .opt:hover, .opt:focus-visible { background: #232C35; }
      .what { color: #9AA6B2; }
      .foot { border-color: #2C3640; }
      .act { color: #E6EBEF; border-color: #3A4652; }
      .act.main { background: #F2B705; border-color: #F2B705; color: #17212B; }
    }`;

  let ui = null;
  let current = null;
  let chipBusy = false;

  function getUI() {
    if (ui) return ui;
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style><div class="chip" hidden></div><button class="fab" type="button" hidden></button><div class="toast" role="status" hidden></div>`;
    document.documentElement.appendChild(host);
    ui = { chip: root.querySelector(".chip"), fab: root.querySelector(".fab"), toast: root.querySelector(".toast") };
    ui.fab.addEventListener("click", () => fillAll());
    ui.chip.addEventListener("mousedown", e => e.preventDefault()); // keep focus in the form field
    ui.chip.addEventListener("pointerdown", () => { chipBusy = true; });
    return ui;
  }

  let toastTimer;
  function toast(msg) {
    const { toast: t } = getUI();
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function hideChip() {
    if (ui) ui.chip.hidden = true;
  }

  function place() {
    if (!ui || ui.chip.hidden || !current) return;
    const r = current.getBoundingClientRect();
    const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
    const chip = ui.chip;
    const h = chip.offsetHeight, w = chip.offsetWidth;
    chip.style.visibility = r.bottom < 0 || r.top > vh ? "hidden" : "visible";
    let top = r.bottom + 6;
    if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    chip.style.top = top + "px";
    chip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  }

  function button(cls, text, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.addEventListener("click", () => { chipBusy = false; onClick(); });
    return b;
  }

  function showChipFor(el) {
    if (!active() || !isField(el)) return hideChip();
    const label = labelFor(el);
    const items = [];

    const m = classify(hintsFor(el, label), el);
    const v = valueFor(m);
    if (v && el.value !== v) items.push({ title: m.name, text: v });

    const questiony = el.tagName === "TEXTAREA" || label.length > 25;
    if (questiony && label && el.tagName !== "SELECT") {
      for (const a of rankAnswers(label).slice(0, 3)) {
        if (a.a !== el.value) items.push({ title: "Saved answer · " + a.q, text: a.a });
      }
    }
    const canSave = questiony && label && el.tagName !== "SELECT" && el.value.trim().length >= 20;
    if (!items.length && !canSave) return hideChip();

    const { chip } = getUI();
    chip.replaceChildren();
    for (const it of items) {
      const b = button("opt", "", () => fillOne(el, it.text));
      const t = document.createElement("span"); t.className = "what"; t.textContent = it.title;
      const val = document.createElement("span"); val.className = "val"; val.textContent = it.text;
      b.append(t, val);
      chip.append(b);
    }
    const foot = document.createElement("div");
    foot.className = "foot";
    if (canSave) foot.append(button("act main", "Save as answer", () => saveAnswerFrom(el, label)));
    foot.append(button("act", "Hide", () => { hideChip(); el.focus(); }));
    chip.append(foot);
    chip.hidden = false;
    place();
  }

  // ---------- Wiring ----------
  function looksLikeJobPage() {
    if (jobCache.url === location.href) return jobCache.val;
    let val = JOB_HINT.test(location.href) || /apply|application|resume|career/i.test(document.title);
    if (!val && document.querySelector('input[type="file"]')) {
      val = /\b(resume|résumé|cv|cover letter)\b/i.test((document.body && document.body.innerText || "").slice(0, 20000));
    }
    jobCache = { url: location.href, val };
    return val;
  }
  const active = () => forced || looksLikeJobPage();

  function refreshFab() {
    if (!active()) { if (ui) ui.fab.hidden = true; return; }
    const pending = scan().length;
    if (pending < 2) { if (ui) ui.fab.hidden = true; return; }
    const { fab } = getUI();
    const dot = document.createElement("span");
    dot.className = "dot";
    fab.replaceChildren(dot, `Fill ${pending} fields`);
    fab.hidden = false;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  const refreshSoon = debounce(refreshFab, 700);
  const rechipSoon = debounce(() => current && showChipFor(current), 350);
  const placeSoon = () => requestAnimationFrame(place);

  document.addEventListener("focusin", e => {
    if (filling || !isField(e.target)) return;
    current = e.target;
    showChipFor(current);
  }, true);

  document.addEventListener("focusout", e => {
    if (e.target !== current) return;
    setTimeout(() => {
      if (chipBusy) { chipBusy = false; return; }
      if (document.activeElement !== current) hideChip();
    }, 200);
  }, true);

  document.addEventListener("input", e => { if (e.target === current && !filling) rechipSoon(); }, true);
  window.addEventListener("scroll", placeSoon, { capture: true, passive: true });
  window.addEventListener("resize", placeSoon, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", placeSoon);

  new MutationObserver(refreshSoon).observe(document.documentElement, { childList: true, subtree: true });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") reload().then(refreshFab);
  });

  browser.runtime.onMessage.addListener(msg => {
    if (!msg || msg.cmd !== "fill") return;
    forced = true;
    const inFrameSetup = window !== window.top || !!document.querySelector("iframe");
    return Promise.resolve(fillAll({ quietIfEmpty: inFrameSetup }));
  });

  reload().then(() => setTimeout(refreshFab, 400));
})();

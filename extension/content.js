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
  const clean = s => (s || "").replace(/[*✱]/g, "").replace(/\(?\brequired\b\)?/gi, "").replace(/\s+/g, " ").trim();
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
  // `near` are extra words that break ties, like your state and country when several
  // places are called "San Francisco".
  function pickOption(options, value, near = []) {
    const v = normalize(value);
    if (!v) return null;
    const norm = options.map(o => ({ o, l: normalize(o.label) })).filter(x => x.l);
    const firstWord = s => s.split(" ")[0];
    const hit = norm.find(x => x.l === v)
      || (!v.includes(" ") && norm.find(x => firstWord(x.l) === v))
      // Most context words, then shortest: "United States" picks "United States +1", not
      // "…Minor Outlying Islands", and "San Francisco" picks the one in California.
      || norm.filter(x => x.l.startsWith(v + " ") || v.startsWith(x.l + " "))
        .map(x => ({ ...x, score: near.map(normalize).filter(w => w && x.l.includes(w)).length }))
        .sort((a, b) => b.score - a.score || a.l.length - b.l.length)[0]
      || (/^\d+$/.test(v) && norm.find(x => x.l.split(" ").includes(v))) // "+91" → "India (+91)"
      || (v.length > 3 && norm.find(x => x.l.includes(v)));
    return hit ? hit.o : null;
  }

  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const isField = el => el && !el.disabled && !el.readOnly && (
    el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
    (el.tagName === "INPUT" && TEXTY.has((el.getAttribute("type") || "").toLowerCase())));

  // Rendered, but you couldn't actually see it: tiny, see-through, pushed off the page,
  // clipped away, or covered by something else. A page can use fields like this to collect
  // details you never meant to give it, so these are only filled if you tick them in the
  // review panel.
  function concealed(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return true;
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return true;
    // Forms don't scroll sideways, so a field starting past the page's right edge is out of view.
    if (r.left + scrollX >= document.documentElement.clientWidth) return true;
    let opacity = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      opacity *= parseFloat(cs.opacity) || 0;
      if (opacity < 0.1) return true;
      if (n !== el && n !== document.body && /hidden|clip/.test(cs.overflowX + cs.overflowY)) {
        const p = n.getBoundingClientRect();
        if (r.right <= p.left || r.left >= p.right || r.bottom <= p.top || r.top >= p.bottom) return true;
      }
    }
    return coveredUp(el, r);
  }

  // Asks the browser what's on top at a few points inside the field. If none of them is the
  // field, its label, or our own box, something covers it or clip-path cuts it away. Only
  // points on screen can be checked, so a field scrolled out of view is given the benefit.
  function coveredUp(el, r) {
    const vw = document.documentElement.clientWidth, vh = innerHeight;
    const points = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]
      .map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
    if (!points.length) return false;
    const own = n => n && (el.contains(n) || n.contains(el) && n.tagName === "LABEL" ||
      [...(el.labels || [])].some(l => l.contains(n)) || (ui && n === ui.host));
    return !points.some(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return own(top) || own(top && top.closest("label"));
    });
  }
  // Styled radio buttons often hide the real input and show only the label.
  const radioSeen = r => [r, ...(r.labels || [])].some(n => visible(n) && !concealed(n));
  // Upload fields are almost always a hidden input behind a visible button or drop area,
  // and searchable dropdowns hide their input inside a styled box.
  function shownNearby(el) {
    if (radioSeen(el)) return true;
    let n = el.parentElement;
    for (let i = 0; i < 3 && n && n !== document.body; i++, n = n.parentElement) {
      if (visible(n) && !concealed(n)) return true;
    }
    return false;
  }
  const RESUME = /(^| )(resume|résumé|cv|curriculum vitae)( |$)/u;

  // Upload buttons are often labelled just "Attach"; the field's real name is on its group.
  function groupLabel(el) {
    const g = el.closest('[role="group"][aria-labelledby], fieldset');
    return g ? byIds(g.getAttribute("aria-labelledby")) || textOf(g.querySelector("legend")) : "";
  }

  // Searchable dropdowns (react-select on Greenhouse, and other ARIA comboboxes) look like a
  // text box but only accept a value picked from their list.
  const isCombo = el => el.tagName === "INPUT" &&
    (el.getAttribute("role") === "combobox" || /^(list|both)$/.test(el.getAttribute("aria-autocomplete") || ""));
  // A "strict" one throws away typed text that isn't an option; others are text boxes with suggestions.
  const strictCombo = el => /select/i.test(el.className) || !!el.closest('[class*="select__"], [class*="Select"]');
  const comboBox = el => el.closest('[class*="control"]') || (el.parentElement && el.parentElement.parentElement) || el;
  const comboHasValue = el => !!comboBox(el).querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]');

  // Stable ids, so the review panel and toolbar menu can say which fields to fill.
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = el => { if (!ids.has(el)) ids.set(el, nextId++); return ids.get(el); };

  // Every field on the page we know how to fill and that is still empty.
  function scan() {
    const out = [];
    const groups = new Map();
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.disabled) continue;
      if (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "file") {
        const r = data.resumeHere;
        if (!r || el.files.length) continue;
        const label = groupLabel(el) || labelFor(el);
        const hints = hintsFor(el, label).join(" ");
        const accept = (el.getAttribute("accept") || "").toLowerCase();
        if (!RESUME.test(hints) || /\bcover\b/u.test(hints)) continue;
        if (accept && !/pdf|application\/\*|\*\/\*/.test(accept)) continue;
        // Upload fields often have two labels, the heading and the "Attach" button; show the heading.
        const asks = !groupLabel(el) && el.labels && el.labels.length > 1 ? textOf(el.labels[0]) : label;
        out.push({ id: idOf(el), kind: "file", el, field: "Resume", label: asks, value: r.name,
          shown: `${r.name} · ${Math.max(1, Math.round(r.size / 1024))} KB`, hidden: !shownNearby(el) });
        continue;
      }
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
      // A <label> wrapped around a <select> also contains every option's text; drop it for display.
      const asks = el.tagName === "SELECT" ? clean([...el.options].reduce((t, o) => t.replace(clean(o.text), ""), label)) : label;
      const base = { id: idOf(el), el, field: m.name, label: asks, hidden: concealed(el) };
      if (isCombo(el)) {
        if (comboHasValue(el) || el.value.trim()) continue;
        out.push({ ...base, kind: "combo", value, shown: value, hidden: !shownNearby(el) });
      } else if (el.tagName === "SELECT") {
        if (el.selectedIndex > 0 && el.value) continue;
        const option = pickOption([...el.options].map(o => ({ label: o.text, o })), value);
        if (option) out.push({ ...base, kind: "select", value: option.o.value, shown: option.o.text });
      } else if (!el.value.trim()) {
        out.push({ ...base, kind: "text", value, shown: value });
      }
    }
    for (const radios of groups.values()) {
      if (radios.length < 2 || radios.some(r => r.checked)) continue;
      const q = groupQuestion(radios);
      const m = classify([normalize(q)], null);
      const value = valueFor(m);
      const option = value && pickOption(radios.map(r => ({ label: optionLabel(r), el: r })), value);
      if (option) {
        out.push({ id: idOf(option.el), kind: "radio", el: option.el, field: m.name, label: q,
          value: option.el.value, shown: option.label, hidden: !radioSeen(option.el) });
      }
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

  const flashTarget = it => (it.kind === "radio" && it.el.labels && it.el.labels[0] ? it.el.labels[0] : it.el);
  let lastFill = []; // what the latest fill changed, for Undo

  // Puts the resume into an upload field, the same way choosing it yourself would.
  function attachFile(el, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(test, ms) {
    for (let t = 0; t <= ms; t += 100) {
      const v = test();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }

  // Some sites (Greenhouse's newer forms) keep react-select's open state in their own code and
  // ignore scripted typing and clicks. React stores each element's component props on the
  // element, so find the nearest component with an option list and an onChange and choose
  // the matching option through it: the same call a click on that option would make. It can
  // only pick options the page itself offers. In Firefox, page properties are reached through
  // wrappedJSObject, and objects handed to page code are cloned into the page with cloneInto.
  const nearWords = () => [data.profile.state, data.profile.country].filter(Boolean);

  // The react-select component an input belongs to, found through React's props on the element.
  function reactSelectProps(el) {
    const node = el.wrappedJSObject || el;
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber"));
    for (let f = key && node[key], i = 0; f && i < 30; f = f.return, i++) {
      const props = f.memoizedProps;
      // The select component itself: it has a menu, not just a text input's change handler.
      if (typeof f.type === "string" || !props || typeof props.onChange !== "function" || typeof props.onMenuOpen !== "function") continue;
      if (Array.isArray(props.options) || typeof props.loadOptions === "function") return props;
    }
    return null;
  }
  const toPage = obj => (typeof cloneInto === "function" ? cloneInto(obj, window) : obj);

  async function selectViaReact(el, value) {
    const props = reactSelectProps(el);
    if (!props) return false;
    let options = Array.isArray(props.options) ? [...props.options] : [];
    if (!options.length && typeof props.loadOptions === "function") {
      // Options that come from a search as you type, like a city lookup.
      try {
        options = await new Promise((resolve, reject) => {
          const callback = typeof exportFunction === "function" ? exportFunction(list => resolve(list || []), window) : list => resolve(list || []);
          const result = props.loadOptions(value, callback);
          if (result && typeof result.then === "function") result.then(list => resolve(list || []), reject);
          setTimeout(() => resolve([]), 6000);
        });
        options = [...options];
      } catch {
        options = [];
      }
    }
    const flat = options.flatMap(o => (o && Array.isArray(o.options) ? [...o.options] : [o]));
    const hit = pickOption(flat.map(o => ({ label: String(o && o.label != null ? o.label : ""), o })), value, nearWords());
    if (!hit) return false;
    props.onChange(hit.o, toPage({ action: "select-option", option: hit.o, name: props.name }));
    return true;
  }

  // Types the value into a searchable dropdown, waits for its list to settle, clicks the
  // matching option, and checks it took. Returns false if nothing matched.
  async function chooseOption(el, value) {
    // These widgets re-render as you use them, so always look the input up again by id.
    const live = () => (el.id && document.getElementById(el.id)) || el;
    el.focus();
    setValue(el, value);
    const listbox = () => {
      const id = live().getAttribute("aria-controls") || live().getAttribute("aria-owns");
      const lb = id && document.getElementById(id);
      return lb && lb.querySelector('[role="option"]') ? lb : null;
    };
    let lb = await waitFor(listbox, 2000);
    if (!lb) {
      // The list didn't open for scripted typing; choose through the component instead.
      setValue(live(), "");
      if (await selectViaReact(live(), value)) {
        const ok = await waitFor(() => comboHasValue(live()), 1500);
        live().blur();
        return !!ok;
      }
      live().blur();
      return false;
    }
    // Options can arrive in batches (place search, remote lists); wait until they stop changing.
    for (let i = 0, last = ""; lb && i < 10 && lb.textContent !== last; i++) {
      last = lb.textContent;
      await sleep(250);
      lb = listbox() || lb;
    }
    const options = lb ? [...lb.querySelectorAll('[role="option"]')].filter(o => o.getAttribute("aria-disabled") !== "true") : [];
    const hit = pickOption(options.map(o => ({ label: o.textContent, o })), value, nearWords());
    if (!hit) {
      if (!strictCombo(el)) return true; // a text box with suggestions keeps what was typed
      setValue(live(), "");
      live().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      live().blur();
      return false;
    }
    for (const type of ["mousedown", "mouseup", "click"]) hit.o.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    const ok = await waitFor(() => comboHasValue(live()) || (live().value && normalize(live().value) === normalize(hit.o.textContent)), 1500);
    live().blur();
    return !!ok;
  }

  // Fills the fields with these ids. Scanning again first means anything you've typed into
  // since the review, or that the page removed, is left alone.
  async function fillIds(wanted) {
    const want = new Set(wanted);
    let resume = null;
    try {
      resume = await AK.loadResumeFile();
    } catch (e) {
      console.warn("[Apply Kit]", e);
    }
    filling = true;
    const done = [], missed = [];
    for (const it of scan()) {
      if (!want.has(it.id)) continue;
      const prev = it.el.value;
      if (it.kind === "file") {
        if (!resume) { missed.push(it); continue; }
        attachFile(it.el, resume);
      } else if (it.kind === "combo") {
        let ok = false;
        try {
          ok = await chooseOption(it.el, it.value);
        } catch (e) {
          console.warn("[Apply Kit]", e);
        }
        if (!ok) { missed.push(it); continue; }
      } else if (it.kind === "radio") it.el.click();
      else setValue(it.el, it.value);
      it.el.dispatchEvent(new Event("blur"));
      flash(flashTarget(it));
      done.push({ ...it, prev });
    }
    filling = false;
    hideChip();
    lastFill = done;
    refreshFab();
    if (done.length) {
      AK.logApplication({ ...describeApplication(), fields: done.length, fieldNames: done.map(it => it.field) })
        .catch(e => console.warn("[Apply Kit]", e));
    }
    return { done, missed };
  }

  // Puts back what was there before the latest fill, skipping fields you've changed since.
  function undoLast() {
    filling = true;
    let n = 0;
    for (const it of lastFill) {
      if (!it.el.isConnected && it.kind !== "combo") continue;
      if (it.kind === "radio") {
        if (!it.el.checked) continue;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set.call(it.el, false);
        it.el.dispatchEvent(new Event("input", { bubbles: true }));
        it.el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (it.kind === "combo") {
        // Backspace in an empty searchable dropdown clears its choice.
        const input = (it.el.id && document.getElementById(it.el.id)) || it.el;
        if (!comboHasValue(input)) continue;
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true }));
        input.blur();
        const again = (it.el.id && document.getElementById(it.el.id)) || input;
        const props = comboHasValue(again) && reactSelectProps(again);
        if (props) props.onChange(null, toPage({ action: "clear", name: props.name }));
      } else if (it.kind === "file") {
        if (!it.el.files.length || it.el.files[0].name !== it.value) continue;
        it.el.value = "";
        it.el.dispatchEvent(new Event("input", { bubbles: true }));
        it.el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        if (it.el.value !== it.value) continue;
        setValue(it.el, it.prev);
      }
      n++;
    }
    filling = false;
    lastFill = [];
    refreshFab();
    return n;
  }

  // Where this copy of the script is running. Each frame on a page gets its own copy.
  function frameInfo() {
    const top = window === window.top;
    let parent = "";
    if (!top) {
      try { parent = new URL(document.referrer).hostname; } catch { /* no referrer */ }
    }
    const host = location.hostname;
    const platform = PLATFORM.test(host);
    // A frame from some other site that isn't a known application platform, like an ad.
    const foreign = !top && !platform && (!parent || siteOf(parent) !== siteOf(host));
    return { top, host, parent, platform, foreign };
  }

  // Best guess at the company and role for the applications log. Hosted platforms put the
  // company in the address; elsewhere fall back to page metadata. You can fix it in settings.
  function describeApplication() {
    const meta = n => ((document.querySelector(`meta[property="${n}"], meta[name="${n}"]`) || {}).content || "").trim();
    const tidy = t => {
      t = clean(decodeURIComponent(t || "")).replace(/[-_]+/g, " ").trim();
      return t && t === t.toLowerCase() ? t.replace(/\b\w/g, c => c.toUpperCase()) : t;
    };
    const host = location.hostname.replace(/^www\./, "");
    const first = location.pathname.split("/").filter(Boolean)[0] || "";
    // Greenhouse titles read "Job Application for <role> at <company>".
    const gh = document.title.match(/^Job Application for (.+?) at (.+)$/);
    let company = gh ? gh[2] : "";
    if (!company) {
      let slug = "";
      if (/greenhouse\.io$/.test(host)) slug = new URLSearchParams(location.search).get("for") || (first !== "embed" ? first : "");
      else if (/(lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|teamtailor\.com|wellfound\.com)$/.test(host)) slug = first;
      else if (/(myworkdayjobs|myworkdaysite|bamboohr|icims|jobvite|personio)\./.test(host)) slug = host.split(".")[0];
      company = tidy(slug) || meta("og:site_name") || tidy(host.replace(/^(careers|jobs|apply|boards|job-boards|join)\./, "").split(".")[0]);
    }

    let role = gh ? gh[1] : "";
    const h1 = [...document.querySelectorAll("h1, h2")].find(h => visible(h) && textOf(h).length > 2 && textOf(h).length < 120);
    role = role || (h1 ? textOf(h1) : "") || meta("og:title") || document.title;
    // "Senior Engineer - Acme Corp" → "Senior Engineer"
    const esc = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    role = clean(role.replace(new RegExp(`\\s*[-|–·]\\s*${esc}.*$`, "i"), "")).slice(0, 120);
    return { url: location.href.split("#")[0], host, company, role };
  }

  // What the toolbar menu needs to show a field, without the element itself.
  const brief = it => ({ id: it.id, field: it.field, label: it.label, shown: it.shown, hidden: it.hidden });

  async function fillOne(el, v) {
    if (isCombo(el)) {
      hideChip();
      filling = true;
      const ok = await chooseOption(el, v).catch(() => false);
      filling = false;
      if (!ok) toast("That isn’t one of this list’s options. Pick one by hand.");
      else flash(comboBox(el));
      refreshSoon();
      return;
    }
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
    .optrow { display: flex; align-items: stretch; gap: 2px; }
    .optrow .opt { flex: 1; min-width: 0; }
    .copy { flex: none; width: 36px; border: 0; border-radius: 6px; background: none; color: #5B6875; cursor: pointer; display: grid; place-items: center; }
    .copy:hover, .copy:focus-visible { background: #F3F5F7; color: #17212B; outline: none; }
    .more { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 2px; padding: 9px 10px;
      border: 0; border-top: 1px solid #D5DBE1; background: none; color: #17212B; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; }
    .more:first-child { border-top: 0; margin-top: 0; }
    .more:hover { background: #F3F5F7; }
    .chev { display: grid; color: #5B6875; transition: transform .15s; }
    .chev.up { transform: rotate(180deg); }
    .find { display: block; width: calc(100% - 12px); margin: 2px 6px 6px; padding: 8px 10px; border: 1px solid #D5DBE1; border-radius: 8px;
      font: inherit; font-size: 14px; color: inherit; background: #fff; }
    .find:focus { outline: none; border-color: #17212B; box-shadow: inset 0 -2px 0 #F2B705; }
    .all { max-height: 240px; overflow: auto; overscroll-behavior: contain; }
    .all .val { -webkit-line-clamp: 1; }
    .none { margin: 6px 10px 10px; color: #5B6875; font-size: 13px; }
    .foot { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; padding: 6px 4px 2px; border-top: 1px solid #D5DBE1; margin-top: 2px; }
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

    .panel { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      width: min(380px, calc(100vw - 32px)); max-height: min(600px, calc(100vh - 32px));
      display: flex; flex-direction: column; overflow: hidden; outline: none;
      background: #fff; color: #17212B; border: 1px solid #D5DBE1; border-radius: 16px;
      box-shadow: 0 16px 48px rgba(23,33,43,.24), 0 2px 6px rgba(23,33,43,.08);
      font-size: 14px; line-height: 1.35; animation: rise .18s ease-out; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
    @media (max-width: 560px) {
      .panel { left: 0; right: 0; bottom: 0; width: auto; max-height: 64vh; border-width: 1px 0 0;
        border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
      .panel::before { content: ""; display: block; width: 36px; height: 4px; border-radius: 2px;
        background: #D5DBE1; margin: 8px auto 0; flex: none; }
    }
    svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8;
      stroke-linecap: round; stroke-linejoin: round; }
    .head { display: flex; align-items: flex-start; gap: 12px; padding: 14px 12px 12px 18px; border-bottom: 1px solid #E6EAEE; flex: none; }
    .head .badge { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #F2B705; color: #17212B; flex: none; margin-top: 1px; }
    .head .badge svg { stroke-width: 2.4; }
    .title { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
    .sub { margin: 2px 0 0; color: #5B6875; font-size: 13px; overflow-wrap: anywhere; }
    .x { margin-left: auto; width: 34px; height: 34px; border-radius: 50%; border: 0; background: none; color: #5B6875;
      display: grid; place-items: center; cursor: pointer; flex: none; }
    .x:hover { background: #F3F5F7; color: #17212B; }
    .list { overflow: auto; overscroll-behavior: contain; padding: 6px 8px 10px; flex: 1 1 auto; }
    .sec { display: flex; align-items: center; gap: 6px; margin: 12px 10px 4px; font-size: 11.5px; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase; color: #8A6300; }
    .note { margin: 4px 6px 6px; padding: 9px 12px; border-radius: 10px; background: #FFF6DB; color: #5E4300; font-size: 12.5px; }
    .row { display: flex; align-items: center; gap: 4px; border-radius: 12px; }
    .row:hover { background: #F3F5F7; }
    .pick { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 12px; padding: 9px 4px 9px 10px; border: 0;
      background: none; color: inherit; text-align: left; cursor: pointer; border-radius: 12px; font-size: 14px; }
    .box { width: 20px; height: 20px; margin-top: 1px; border-radius: 6px; border: 1.5px solid #9AA6B2; display: grid;
      place-items: center; color: transparent; flex: none; transition: background .12s, border-color .12s; }
    .box svg { width: 13px; height: 13px; stroke-width: 2.6; }
    [aria-checked="true"] .box { background: #17212B; border-color: #17212B; color: #fff; }
    .flag .box { border-color: #C99A00; }
    .text { min-width: 0; display: grid; gap: 1px; }
    .name { font-weight: 600; font-size: 13.5px; }
    .valtext { color: #3B4752; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .asks { color: #5B6875; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [aria-checked="false"] .valtext { color: #5B6875; }
    .loc { width: 36px; height: 36px; border-radius: 50%; border: 0; background: none; color: #5B6875; display: grid;
      place-items: center; cursor: pointer; flex: none; margin-right: 2px; }
    .loc:hover { background: #E6EAEE; color: #17212B; }
    .tick { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: #FFF1C2; color: #6B4E00; flex: none; margin-top: 1px; }
    .tick svg { width: 12px; height: 12px; stroke-width: 2.6; }
    .tick.miss { background: #FDE4E1; color: #A1271A; }
    .tick.miss svg { stroke-width: 2.2; }
    .done .pick { cursor: default; }
    .bar { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid #E6EAEE; flex: none; }
    .btn { flex: 1; min-height: 44px; border-radius: 999px; border: 1px solid #D5DBE1; background: none; color: #17212B;
      font-size: 14.5px; font-weight: 600; cursor: pointer; }
    .btn.main { flex: 1.4; background: #17212B; border-color: #17212B; color: #fff; }
    .btn:disabled { opacity: .4; cursor: default; }
    .btn:focus-visible, .pick:focus-visible, .loc:focus-visible, .x:focus-visible { outline: 3px solid #F2B705; outline-offset: 1px; }

    @media (prefers-color-scheme: dark) {
      .panel { background: #1A2128; color: #E6EBEF; border-color: #3A4652; box-shadow: 0 16px 48px rgba(0,0,0,.5); }
      .panel::before { background: #3A4652; }
      .head, .bar { border-color: #2C3640; }
      .sub, .asks, .x, .loc, [aria-checked="false"] .valtext { color: #9AA6B2; }
      .valtext { color: #C9D2DA; }
      .x:hover, .row:hover { background: #232C35; color: #E6EBEF; }
      .loc:hover { background: #2C3640; color: #E6EBEF; }
      .sec { color: #F2B705; }
      .note { background: #3A2F0F; color: #F6E3A8; }
      .box { border-color: #6B7884; }
      [aria-checked="true"] .box { background: #F2B705; border-color: #F2B705; color: #17212B; }
      .tick { background: #3A2F0F; color: #F2B705; }
      .tick.miss { background: #3B1A17; color: #F7A196; }
      .btn { color: #E6EBEF; border-color: #3A4652; }
      .btn.main { background: #F2B705; border-color: #F2B705; color: #17212B; }
      .chip { background: #1A2128; color: #E6EBEF; border-color: #3A4652; }
      .opt:hover, .opt:focus-visible { background: #232C35; }
      .what { color: #9AA6B2; }
      .foot { border-color: #2C3640; }
      .act { color: #E6EBEF; border-color: #3A4652; }
      .copy, .chev, .none { color: #9AA6B2; }
      .copy:hover, .copy:focus-visible, .more:hover { background: #232C35; color: #E6EBEF; }
      .more { color: #E6EBEF; border-color: #2C3640; }
      .find { background: #11161B; border-color: #3A4652; }
      .find:focus { border-color: #E6EBEF; }
      .act.main { background: #F2B705; border-color: #F2B705; color: #17212B; }
    }`;

  let ui = null;
  let current = null;
  let chipBusy = false;
  let detailsOpen = false; // "All my details" expanded in the suggestion box

  function getUI() {
    if (ui) return ui;
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style><div class="chip" hidden></div><button class="fab" type="button" hidden></button><div class="toast" role="status" hidden></div><div class="panel" role="dialog" aria-label="Apply Kit" tabindex="-1" hidden></div>`;
    document.documentElement.appendChild(host);
    ui = { root, host, chip: root.querySelector(".chip"), fab: root.querySelector(".fab"), toast: root.querySelector(".toast"), panel: root.querySelector(".panel") };
    ui.fab.addEventListener("click", () => openReview());
    ui.panel.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });
    // Keep focus in the form field, except when you tap the search box.
    ui.chip.addEventListener("mousedown", e => { if (!e.target.classList.contains("find")) e.preventDefault(); });
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
    detailsOpen = false;
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

  // Copies text from a tap in the page. Falls back to a hidden text box when the site's
  // permissions don't allow the clipboard API.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      getUI().root.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  // The job description, for "Copy for chatbot": the biggest block of text on the page that
  // isn't the form itself, or the page's summary if there isn't one.
  function jobDescription(el) {
    const blocks = [...document.querySelectorAll('[class*="description" i], [id*="description" i], [class*="posting" i], [class*="job" i], article, main, section')]
      .filter(n => !n.contains(el) && n.querySelectorAll("input, textarea, select").length <= 2)
      .map(n => (n.innerText || "").trim())
      .filter(t => t.length > 300)
      .sort((x, y) => y.length - x.length);
    const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
    return (blocks[0] || (meta && meta.content) || "").replace(/\n{3,}/g, "\n\n").slice(0, 8000);
  }

  // One block to paste into a chatbot along with your resume.
  function chatbotPrompt(el, question) {
    const { company, role } = describeApplication();
    const p = data.profile;
    const now = p.currentTitle ? `I'm currently ${/^[aeiou]/i.test(p.currentTitle) ? "an" : "a"} ${p.currentTitle}${p.currentCompany ? ` at ${p.currentCompany}` : ""}${p.yearsExperience ? `, with ${p.yearsExperience} years of experience` : ""}.` : "";
    const jd = jobDescription(el);
    const past = rankAnswers(question).slice(0, 3);
    return [
      `I'm applying for ${role ? `the ${role} role` : "a role"}${company ? ` at ${company}` : ""}. ${now}`.trim(),
      "Help me answer the application question below in my own voice. Use my resume if I've attached it, and my past answers for facts and tone. Keep it concise unless the question asks for detail, and don't invent experience I don't have.",
      `\nQuestion:\n${question}`,
      el.value.trim() ? `\nMy draft so far:\n${el.value.trim()}` : "",
      jd ? `\nJob description:\n${jd}` : "",
      past.length ? "\nMy past answers to similar questions:\n" + past.map((a, i) => `${i + 1}. Q: ${a.q}\n   A: ${a.a}`).join("\n\n") : ""
    ].filter(Boolean).join("\n");
  }

  // A row in the suggestion box: tap it to fill, or the copy button to copy.
  function detailRow(title, text, el) {
    const fill = button("opt", "", () => fillOne(el, text));
    fill.append(make("span", "what", title), make("span", "val", text));
    const copy = button("copy", "", async () => {
      const ok = await copyText(text);
      toast(ok ? "Copied. Paste it where you need it." : "Couldn’t copy on this page.");
      if (ok) { copy.replaceChildren(icon(PATH.check)); setTimeout(() => copy.replaceChildren(icon(PATH.copy)), 1500); }
    });
    copy.setAttribute("aria-label", "Copy " + title);
    copy.title = "Copy";
    copy.append(icon(PATH.copy));
    return make("div", "optrow", fill, copy);
  }

  function showChipFor(el) {
    if (!active() || !isField(el) || (ui && !ui.panel.hidden)) return hideChip();
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
    const everything = allDetails(data);
    if (!items.length && !canSave && !everything.length) return hideChip();

    const { chip } = getUI();
    chip.replaceChildren(...items.map(it => detailRow(it.title, it.text, el)));

    // Everything you've saved, for fields Apply Kit didn't recognise (or got wrong).
    if (el.tagName !== "SELECT" && everything.length) {
      const toggle = button("more", "", () => { detailsOpen = !detailsOpen; showChipFor(el); });
      toggle.setAttribute("aria-expanded", String(detailsOpen));
      toggle.append(items.length ? "All my details" : "Pick from my details", make("span", "chev" + (detailsOpen ? " up" : ""), icon(PATH.chevron)));
      chip.append(toggle);
      if (detailsOpen) {
        const search = document.createElement("input");
        search.type = "search";
        search.className = "find";
        search.placeholder = "Search my details";
        search.setAttribute("aria-label", "Search my details");
        const list = make("div", "all");
        const draw = () => {
          const q = normalize(search.value);
          const shown = everything.filter(d => !q || normalize(`${d.name} ${d.value}`).includes(q));
          list.replaceChildren(...shown.map(d => detailRow(d.name, d.value, el)));
          if (!shown.length) list.append(make("p", "none", "Nothing matches."));
        };
        search.addEventListener("input", draw);
        search.addEventListener("keydown", e => { if (e.key === "Escape") { hideChip(); el.focus(); } });
        draw();
        chip.append(search, list);
      }
    }

    const foot = document.createElement("div");
    foot.className = "foot";
    if (questiony && label && el.tagName !== "SELECT") {
      foot.append(button("act", "Copy for chatbot", async () => {
        const ok = await copyText(chatbotPrompt(el, label));
        toast(ok ? "Copied the question, job description and your past answers. Paste it into your chatbot." : "Couldn’t copy on this page.");
      }));
    }
    if (canSave) foot.append(button("act main", "Save as answer", () => saveAnswerFrom(el, label)));
    foot.append(button("act", "Hide", () => { hideChip(); el.focus(); }));
    chip.append(foot);
    chip.hidden = false;
    place();
  }

  // ---------- Review panel ----------
  // Bulk filling always goes through here: you see every field and value first, and
  // hidden fields or fields in a frame from another site start unticked.
  const PATH = {
    check: "M3.5 8.5l3 3 6-7",
    close: "M4 4l8 8M12 4l-8 8",
    locate: "M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5M8 5a3 3 0 1 1 0 6a3 3 0 1 1 0-6",
    warn: "M8 2.2l6.3 11.3H1.7zM8 6.6v3.2M8 11.7v.1",
    copy: "M5.5 5.5V3.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7h-2.3M3.2 5.5h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7H3.2c-.4 0-.7-.3-.7-.7V6.2c0-.4.3-.7.7-.7z",
    chevron: "M4 6.5l4 4 4-4"
  };
  function icon(d) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  }
  function make(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.append(...kids.filter(k => k != null));
    return e;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function head(title, sub, badge) {
    const close = button("x", "", closePanel);
    close.setAttribute("aria-label", "Close");
    close.append(icon(PATH.close));
    return make("div", "head", badge ? make("span", "badge", icon(PATH.check)) : null,
      make("div", "", make("h2", "title", title), make("p", "sub", sub)), close);
  }

  function locate(it) {
    const target = flashTarget(it);
    const narrow = innerWidth <= 560;
    // On a phone the panel covers the bottom of the screen, so bring the field near the top.
    target.scrollIntoView({ block: narrow ? "start" : "center" });
    if (narrow) scrollBy(0, -innerHeight * 0.15);
    flash(target);
  }

  function fieldRow(it, picked, onToggle) {
    const pick = button("pick", "", () => {
      if (!picked) return;
      if (picked.has(it.id)) picked.delete(it.id); else picked.add(it.id);
      pick.setAttribute("aria-checked", String(picked.has(it.id)));
      onToggle();
    });
    const text = make("span", "text", make("span", "name", it.field), make("span", "valtext", it.shown));
    if (it.label && normalize(it.label) !== normalize(it.field)) text.append(make("span", "asks", `Page asks: “${it.label}”`));
    if (picked) {
      pick.setAttribute("role", "checkbox");
      pick.setAttribute("aria-checked", String(picked.has(it.id)));
      pick.append(make("span", "box", icon(PATH.check)), text);
    } else {
      pick.append(it.missed ? make("span", "tick miss", icon(PATH.warn)) : make("span", "tick", icon(PATH.check)), text);
    }
    const loc = button("loc", "", () => locate(it));
    loc.setAttribute("aria-label", "Show " + it.field + " on the page");
    loc.title = "Show on the page";
    loc.append(icon(PATH.locate));
    return make("div", "row" + (it.hidden ? " flag" : ""), pick, loc);
  }

  function showPanel(...parts) {
    const { panel, fab } = getUI();
    panel.replaceChildren(...parts);
    panel.hidden = false;
    fab.hidden = true;
    hideChip();
    panel.focus({ preventScroll: true });
  }

  function closePanel() {
    if (ui) ui.panel.hidden = true;
    refreshFab();
  }

  function openReview() {
    const items = scan();
    if (!items.length) { closePanel(); toast("Nothing left to fill on this page."); return; }
    const info = frameInfo();
    const picked = new Set(items.filter(it => !it.hidden && !info.foreign).map(it => it.id));
    const seen = items.filter(it => !it.hidden), unseen = items.filter(it => it.hidden);

    const fill = button("btn main", "", async () => {
      fill.disabled = true;
      fill.textContent = "Filling…";
      showDone(await fillIds([...picked]));
    });
    const update = () => {
      fill.textContent = picked.size ? "Fill " + plural(picked.size, "field") : "Nothing selected";
      fill.disabled = !picked.size;
    };
    update();

    const list = make("div", "list",
      info.foreign ? make("p", "note", `This form is in a frame from ${info.host}${info.parent ? `, embedded in ${info.parent}` : ""}. Only fill it if you expected a form from that site here.`) : null,
      ...seen.map(it => fieldRow(it, picked, update)));
    if (unseen.length) {
      list.append(
        make("div", "sec", icon(PATH.warn), "Hidden on the page"),
        make("p", "note", "You can’t see these fields, so the page may be asking for more than it shows. Leave them unticked unless you know why they’re there."),
        ...unseen.map(it => fieldRow(it, picked, update)));
    }
    showPanel(
      head("Review before filling", `${info.host || "This page"} · ${plural(items.length, "field")}`),
      list,
      make("div", "bar", button("btn", "Cancel", closePanel), fill));
  }

  function showDone({ done, missed }) {
    if (!done.length && !missed.length) { closePanel(); toast("Those fields changed, so nothing was filled."); return; }
    const undo = button("btn", "Undo", () => {
      const n = undoLast();
      closePanel();
      toast(n ? "Undid " + plural(n, "field") + "." : "Nothing to undo. You’ve changed those fields since.");
    });
    showPanel(
      head("Filled " + plural(done.length, "field"), (missed.length ? plural(missed.length, "field") + " need you. " : "") + "Check them before you submit. Nothing was submitted.", true),
      make("div", "list done",
        ...done.map(it => fieldRow(it, null)),
        missed.length ? make("div", "sec", icon(PATH.warn), "Fill these by hand") : null,
        missed.length ? make("p", "note", "Apply Kit couldn’t find a matching option for these. Tap the target to jump to each one.") : null,
        ...missed.map(it => fieldRow({ ...it, missed: true }, null))),
      make("div", "bar", undo, button("btn main", "Done", closePanel)));
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
    if (!active() || (ui && !ui.panel.hidden)) { if (ui) ui.fab.hidden = true; return; }
    const pending = scan().filter(it => !it.hidden).length;
    if (pending < 2) { if (ui) ui.fab.hidden = true; return; }
    const { fab } = getUI();
    const dot = document.createElement("span");
    dot.className = "dot";
    fab.replaceChildren(dot, `Review ${pending} fields`);
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
      // Focus inside the box itself (its search field) shows up as focus on its host element.
      if (document.activeElement !== current && !(ui && document.activeElement === ui.host)) hideChip();
    }, 200);
  }, true);

  document.addEventListener("input", e => { if (e.target === current && !filling) rechipSoon(); }, true);
  // Tapping anywhere else on the page closes the suggestion box. (Taps inside it arrive here
  // as taps on its host element, because it lives in a closed shadow root.)
  document.addEventListener("pointerdown", e => {
    if (ui && !ui.chip.hidden && e.target !== ui.host && e.target !== current) hideChip();
  }, true);
  window.addEventListener("scroll", placeSoon, { capture: true, passive: true });
  window.addEventListener("resize", placeSoon, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", placeSoon);

  new MutationObserver(refreshSoon).observe(document.documentElement, { childList: true, subtree: true });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" || (area === "local" && changes.resumeInfo)) reload().then(refreshFab);
  });

  // The toolbar menu asks every frame what it found, shows one combined review, then
  // tells each frame which of its fields to fill.
  browser.runtime.onMessage.addListener(msg => {
    if (!msg) return;
    if (msg.cmd === "scan") {
      forced = true;
      if (ui) ui.panel.hidden = true;
      browser.runtime.sendMessage({ cmd: "found", ...frameInfo(), items: scan().map(brief) }).catch(() => {});
      refreshFab();
      return Promise.resolve(true);
    }
    if (msg.cmd === "fill") return fillIds(msg.ids || []).then(r => ({ done: r.done.map(brief), missed: r.missed.map(brief) }));
    if (msg.cmd === "undo") return Promise.resolve(undoLast());
    if (msg.cmd === "locate") {
      const it = scan().find(x => x.id === msg.id);
      if (it) locate(it);
      return Promise.resolve(!!it);
    }
  });

  reload().then(() => setTimeout(refreshFab, 400));
})();

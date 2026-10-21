// The toolbar menu. "Fill this page" asks every frame on the page what it can fill,
// shows one review grouped by site, and fills only what you leave ticked.
const view = document.getElementById("view");
const msg = document.getElementById("msg");
let tab = null;
const reports = new Map(); // frameId → what that frame found

const PATH = {
  check: "M3.5 8.5l3 3 6-7",
  locate: "M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5M8 5a3 3 0 1 1 0 6a3 3 0 1 1 0-6",
  warn: "M8 2.2l6.3 11.3H1.7zM8 6.6v3.2M8 11.7v.1"
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
function button(cls, text, onClick) {
  const b = make("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const head = (title, sub, badge) => make("div", "head", badge ? make("span", "badge", icon(PATH.check)) : null,
  make("div", "", make("h1", "title", title), make("p", "sub", sub)));

browser.runtime.onMessage.addListener((m, sender) => {
  if (m && m.cmd === "found" && tab && sender.tab && sender.tab.id === tab.id) reports.set(sender.frameId, m);
});

document.getElementById("fill").addEventListener("click", async () => {
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  reports.clear();
  try {
    await browser.tabs.sendMessage(tab.id, { cmd: "scan" });
  } catch {
    msg.textContent = "This page can’t be filled. Firefox blocks extensions on some pages, like settings and addons.mozilla.org. Reload the page and try again.";
    return;
  }
  // Every frame answers separately; give the slower ones a moment.
  await new Promise(r => setTimeout(r, 300));
  showReview();
});

document.getElementById("ver").textContent = "Apply Kit " + browser.runtime.getManifest().version;

document.getElementById("edit").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

document.getElementById("apps").addEventListener("click", async () => {
  await browser.tabs.create({ url: browser.runtime.getURL("options.html#applications") });
  window.close();
});

function fieldRow(frameId, it, picked, onToggle) {
  const key = frameId + ":" + it.id;
  const pick = button("pick", "", () => {
    if (!picked) return;
    if (picked.has(key)) picked.delete(key); else picked.add(key);
    pick.setAttribute("aria-checked", String(picked.has(key)));
    onToggle();
  });
  const text = make("span", "text", make("span", "name", it.field), make("span", "valtext", it.shown));
  if (it.label && normalize(it.label) !== normalize(it.field)) text.append(make("span", "asks", `Page asks: “${it.label}”`));
  if (picked) {
    pick.setAttribute("role", "checkbox");
    pick.setAttribute("aria-checked", String(picked.has(key)));
    pick.append(make("span", "box", icon(PATH.check)), text);
  } else {
    pick.append(it.missed ? make("span", "tick miss", icon(PATH.warn)) : make("span", "tick", icon(PATH.check)), text);
  }
  const loc = button("loc", "", () => browser.tabs.sendMessage(tab.id, { cmd: "locate", id: it.id }, { frameId }).catch(() => {}));
  loc.setAttribute("aria-label", "Show " + it.field + " on the page");
  loc.title = "Show on the page";
  loc.append(icon(PATH.locate));
  return make("div", "row" + (it.hidden ? " flag" : ""), pick, loc);
}

function showReview() {
  const found = [...reports].filter(([, r]) => r.items.length);
  if (!found.length) {
    view.replaceChildren(
      head("Nothing to fill", "Apply Kit checked every part of this page."),
      make("div", "empty", make("p", "", "Fields that already have something in them are skipped. If a field should have matched, add it to your profile or as an extra field in settings.")),
      make("div", "bar", button("btn", "Close", () => window.close()), button("btn main", "Edit profile", () => { browser.runtime.openOptionsPage(); window.close(); })));
    return;
  }

  const topReport = [...reports.values()].find(r => r.top);
  const topSite = topReport ? siteOf(topReport.host) : "";
  const kind = r => {
    if (r.top) return { tag: "This page" };
    if (r.platform) return { tag: "Application form" };
    if (topSite ? siteOf(r.host) === topSite : !r.foreign) return { tag: "Same site" };
    return { tag: "Other site", warn: true };
  };
  found.sort(([, a], [, b]) => (b.top - a.top) || (kind(a).warn ? 1 : 0) - (kind(b).warn ? 1 : 0));

  const picked = new Set();
  for (const [frameId, r] of found) {
    if (kind(r).warn) continue;
    for (const it of r.items) if (!it.hidden) picked.add(frameId + ":" + it.id);
  }
  const total = found.reduce((n, [, r]) => n + r.items.length, 0);

  const fill = button("btn main", "", () => doFill(picked));
  const update = () => {
    fill.textContent = picked.size ? "Fill " + plural(picked.size, "field") : "Nothing selected";
    fill.disabled = !picked.size;
  };
  update();

  const list = make("div", "list");
  for (const [frameId, r] of found) {
    const k = kind(r);
    list.append(make("div", "group", r.host || "This page", make("span", "tag" + (k.warn ? " warn" : ""), k.tag)));
    if (k.warn) list.append(make("p", "note", "This part of the page comes from a different site, like an ad or a widget. Only fill it if you expected a form from that site here."));
    const seen = r.items.filter(it => !it.hidden), unseen = r.items.filter(it => it.hidden);
    list.append(...seen.map(it => fieldRow(frameId, it, picked, update)));
    if (unseen.length) {
      list.append(
        make("div", "sec", icon(PATH.warn), "Hidden on the page"),
        make("p", "note", "You can’t see these fields, so the page may be asking for more than it shows. Leave them unticked unless you know why they’re there."),
        ...unseen.map(it => fieldRow(frameId, it, picked, update)));
    }
  }

  view.replaceChildren(
    head("Review before filling", plural(total, "field") + (found.length > 1 ? ` across ${plural(found.length, "part")} of the page` : "")),
    list,
    make("div", "bar", button("btn", "Cancel", () => window.close()), fill));
}

async function doFill(picked) {
  const byFrame = new Map();
  for (const key of picked) {
    const [frameId, id] = key.split(":").map(Number);
    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId).push(id);
  }
  const done = [], missed = [];
  for (const [frameId, ids] of byFrame) {
    try {
      const result = await browser.tabs.sendMessage(tab.id, { cmd: "fill", ids }, { frameId });
      for (const it of (result && result.done) || []) done.push([frameId, it]);
      for (const it of (result && result.missed) || []) missed.push([frameId, it]);
    } catch {
      // That frame went away (navigated or closed) since the review.
    }
  }
  if (!done.length && !missed.length) {
    view.replaceChildren(head("Nothing was filled", "Those fields changed since the review. Try again."),
      make("div", "bar", button("btn main", "Close", () => window.close())));
    return;
  }

  const undo = button("btn", "Undo", async () => {
    let n = 0;
    for (const frameId of new Set(done.map(([f]) => f))) {
      n += await browser.tabs.sendMessage(tab.id, { cmd: "undo" }, { frameId }).catch(() => 0);
    }
    view.replaceChildren(head(n ? "Undid " + plural(n, "field") : "Nothing to undo", n ? "Those fields are empty again." : "You’ve changed those fields since."),
      make("div", "bar", button("btn main", "Close", () => window.close())));
  });
  const list = make("div", "list done", ...done.map(([frameId, it]) => fieldRow(frameId, it, null)));
  if (missed.length) {
    list.append(make("div", "sec", icon(PATH.warn), "Fill these by hand"),
      make("p", "note", "Apply Kit couldn’t find a matching option for these. Tap the target to jump to each one."),
      ...missed.map(([frameId, it]) => fieldRow(frameId, { ...it, missed: true }, null)));
  }
  view.replaceChildren(
    head("Filled " + plural(done.length, "field"), (missed.length ? plural(missed.length, "field") + " need you. " : "") + "Check them before you submit. Nothing was submitted.", true),
    list,
    make("div", "bar", undo, button("btn main", "Done", () => window.close())));
}

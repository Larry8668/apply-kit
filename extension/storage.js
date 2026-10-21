// Everything lives in storage.sync, which Firefox Sync copies between your devices.
// Limits: about 100 KB total, 8 KB per item, so each saved answer is its own item.
var AK = (() => {
  const area = browser.storage.sync;
  const local = browser.storage.local;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function load() {
    const all = await area.get(null);
    const answers = Object.keys(all)
      .filter(k => k.startsWith("ans:"))
      .map(k => ({ id: k.slice(4), q: all[k].q || "", a: all[k].a || "", t: all[k].t || 0 }))
      .sort((x, y) => y.t - x.t);
    const { resumeInfo } = await local.get("resumeInfo");
    return { profile: all.profile || {}, custom: all.custom || [], answers, resume: all.resume || null, resumeHere: resumeInfo || null };
  }

  const saveProfile = p => area.set({ profile: p });
  const saveCustom = c => area.set({ custom: c });
  const saveAnswer = ({ id, q, a }) => area.set({ ["ans:" + id]: { q, a, t: Date.now() } });
  const deleteAnswer = id => area.remove("ans:" + id);

  // Firefox's sync limits, measured the way it counts them: key plus JSON value, in bytes.
  const PER_ITEM = 8192, TOTAL = 102400, MAX_ITEMS = 512;
  const sizeOf = (k, v) => new TextEncoder().encode(k + JSON.stringify(v)).length;

  async function replaceAll({ profile = {}, custom = [], answers = [] }) {
    const items = { profile, custom: Array.isArray(custom) ? custom : [] };
    for (const x of Array.isArray(answers) ? answers : []) {
      items["ans:" + (x.id || newId())] = { q: String(x.q || ""), a: String(x.a || ""), t: x.t || Date.now() };
    }
    // Check it fits before touching anything, so a bad backup can't wipe what's here.
    let total = 0;
    for (const [k, v] of Object.entries(items)) {
      const size = sizeOf(k, v);
      if (size > PER_ITEM) throw new Error(k.startsWith("ans:") ? `The saved answer “${items[k].q.slice(0, 40)}” is too long for sync storage (8 KB per answer).` : `The ${k} section is too big for sync storage (8 KB).`);
      total += size;
    }
    if (total > TOTAL) throw new Error(`The backup is ${(total / 1024).toFixed(0)} KB, more than the 100 KB sync storage holds.`);
    if (Object.keys(items).length > MAX_ITEMS) throw new Error("The backup has more items than sync storage allows.");

    const before = await area.get(null);
    if (before.resume) items.resume = before.resume;
    await area.clear();
    try {
      await area.set(items);
    } catch (e) {
      const restored = await area.set(before).then(() => true, () => false);
      throw new Error((restored ? "Nothing was changed. " : "") + e.message);
    }
  }

  // The resume PDF is too big for sync storage, so the file stays on each device in
  // storage.local. Only its name, size, date and link (if any) sync, under "resume", so
  // the other device can tell when its copy is out of date.
  const MAX_RESUME = 5 * 1024 * 1024;

  async function saveResume(buffer, name, source, link = "") {
    const bytes = new Uint8Array(buffer);
    if (bytes.length > MAX_RESUME) throw new Error("That PDF is over 5 MB. Most application forms won’t accept it either.");
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("That isn’t a PDF file.");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const info = { name: name.replace(/[\\/]/g, "_"), size: bytes.length, t: Date.now(), source, link };
    await local.set({ resumeInfo: info, resumeData: btoa(bin) });
    await area.set({ resume: info });
    return info;
  }

  async function loadResumeFile() {
    const { resumeInfo, resumeData } = await local.get(["resumeInfo", "resumeData"]);
    if (!resumeInfo || !resumeData) return null;
    const bin = atob(resumeData);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], resumeInfo.name, { type: "application/pdf", lastModified: resumeInfo.t });
  }

  async function removeResume() {
    await local.remove(["resumeInfo", "resumeData"]);
    await area.remove("resume");
  }

  // Applications you've filled, newest first. Kept per device in storage.local: it can grow past
  // what sync storage holds, and phones can't sync it anyway.
  const MAX_APPS = 500;
  const loadApps = async () => (await local.get("apps")).apps || [];
  const saveApps = apps => local.set({ apps: apps.slice(0, MAX_APPS) });
  const appsEnabled = async () => !(await local.get("appsOff")).appsOff;
  const setAppsEnabled = on => (on ? local.remove("appsOff") : local.set({ appsOff: true }));

  // Records a fill. Filling the same job again (another step of a multi-page form, or
  // coming back later) updates its entry instead of adding a second one.
  async function logApplication({ url, host, company, role, fields }) {
    if (!(await appsEnabled())) return;
    const apps = await loadApps();
    const now = Date.now();
    const same = a => a.url === url || (a.host === host && role && a.role.toLowerCase() === role.toLowerCase());
    const hit = apps.find(same);
    if (hit) {
      hit.last = now;
      hit.fields += fields;
      apps.splice(apps.indexOf(hit), 1);
      apps.unshift(hit);
    } else {
      apps.unshift({ id: newId(), url, host, company, role, t: now, last: now, fields, status: "Filled" });
    }
    await saveApps(apps);
  }

  return { newId, load, saveProfile, saveCustom, saveAnswer, deleteAnswer, replaceAll, saveResume, loadResumeFile, removeResume,
    loadApps, saveApps, appsEnabled, setAppsEnabled, logApplication };
})();

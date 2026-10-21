// Everything lives in storage.sync, which Firefox Sync copies between your devices.
// Limits: about 100 KB total, 8 KB per item, so each saved answer is its own item.
var AK = (() => {
  const area = browser.storage.sync;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function load() {
    const all = await area.get(null);
    const answers = Object.keys(all)
      .filter(k => k.startsWith("ans:"))
      .map(k => ({ id: k.slice(4), q: all[k].q || "", a: all[k].a || "", t: all[k].t || 0 }))
      .sort((x, y) => y.t - x.t);
    return { profile: all.profile || {}, custom: all.custom || [], answers };
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
    await area.clear();
    try {
      await area.set(items);
    } catch (e) {
      const restored = await area.set(before).then(() => true, () => false);
      throw new Error((restored ? "Nothing was changed. " : "") + e.message);
    }
  }

  return { newId, load, saveProfile, saveCustom, saveAnswer, deleteAnswer, replaceAll };
})();

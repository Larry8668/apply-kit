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

  async function replaceAll({ profile = {}, custom = [], answers = [] }) {
    await area.clear();
    const items = { profile, custom };
    for (const x of answers) items["ans:" + (x.id || newId())] = { q: x.q || "", a: x.a || "", t: x.t || Date.now() };
    await area.set(items);
  }

  return { newId, load, saveProfile, saveCustom, saveAnswer, deleteAnswer, replaceAll };
})();

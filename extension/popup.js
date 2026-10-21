const msg = document.getElementById("msg");

document.getElementById("fill").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    await browser.tabs.sendMessage(tab.id, { cmd: "fill" });
    window.close();
  } catch {
    msg.textContent = "This page can’t be filled. Firefox blocks extensions on some pages, like settings and addons.mozilla.org. Reload the page and try again.";
  }
});

document.getElementById("edit").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

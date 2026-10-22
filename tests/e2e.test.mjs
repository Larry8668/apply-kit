// End-to-end checks in a real Firefox with the extension installed.
// Run with `npm run test:e2e` (set HEADED=1 to watch).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_ID = JSON.parse(readFileSync(join(ROOT, "extension/manifest.json"), "utf8")).browser_specific_settings.gecko.id;
const UUID = "6f1c2c1e-5a5b-4c4d-9e9f-0a0b0c0d0e0f";

const PROFILE = {
  firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "+1 555 0100",
  city: "London", state: "Greater London", postalCode: "N1 9GU",
  linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada", website: "https://ada.example.test",
  currentCompany: "Analytical Engines", salary: "150000"
};

// Fields a person can see and use; each must be listed, ticked, and filled.
const SHOWN = { firstName: "First name", email: "Email", phone: "Phone", city: "City", linkedin: "LinkedIn URL", currentCompany: "Current company" };
// Fields the page hides from the person; each must start unticked under "Hidden on the page" and stay empty.
const HIDDEN = { lastName: "Last name", postalCode: "Postal / ZIP code", state: "State / province", github: "GitHub URL", website: "Website or portfolio", salary: "Expected salary" };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Apply: Engineer</title>
<style>
  html { overflow-x: hidden; }
  body { font: 16px sans-serif; margin: 24px; }
  .f { position: relative; margin: 12px 0; width: 320px; }
  .f input { width: 300px; height: 32px; box-sizing: border-box; padding: 4px 8px; }
  .float { position: absolute; left: 8px; top: 7px; pointer-events: none; color: #666; }
  .icon { position: absolute; right: 20px; top: 4px; width: 24px; height: 24px; background: #ccc; border: 0; }
  .rounded { clip-path: inset(0 round 8px); }
  .cover { position: absolute; inset: 0; background: #fff; }
</style></head><body>
  <h1>Apply for Engineer</h1>
  <div class="f"><label for="fn">First name</label><input id="fn"></div>
  <div class="f"><label for="em">Email</label><input id="em" type="email"></div>
  <div class="f"><input id="ph" type="tel" aria-label="Phone"><span class="float">Phone</span></div>
  <div class="f"><label for="ci">City</label><input id="ci"><button class="icon" type="button" aria-label="Locate"></button></div>
  <div class="f rounded"><label for="co">Current company</label><input id="co"></div>

  <div class="f"><label for="ln">Last name</label><input id="ln" style="width:1px;height:1px;padding:0;border:0"></div>
  <div class="f"><label for="pc">Postal code</label><input id="pc" style="opacity:0"></div>
  <div class="f"><label for="st">State</label><input id="st" style="position:absolute;left:-9999px"></div>
  <div class="f"><label for="gh">GitHub</label><input id="gh" style="position:absolute;left:6000px;top:0"></div>
  <div class="f"><label for="ws">Website</label><input id="ws"><div class="cover"></div></div>
  <div class="f"><label for="sa">Expected salary</label><input id="sa" style="clip-path:inset(50%)"></div>

  <div style="height:1800px"></div>
  <div class="f"><label for="li">LinkedIn</label><input id="li" type="url"></div>

  <button id="probe" type="button">probe</button>
  <script>
    // Runs as the page itself: what can a website see of Apply Kit?
    document.getElementById("probe").addEventListener("click", () => {
      const host = [...document.documentElement.children].find(n => n.tagName === "DIV" && n.style.zIndex === "2147483647");
      const text = document.documentElement.innerText + [...document.querySelectorAll("*")].map(n => n.getAttribute("value") || "").join(" ");
      document.body.dataset.probe = JSON.stringify({
        hostFound: !!host,
        shadowRoot: host ? host.shadowRoot !== null : null,
        akGlobal: typeof window.AK !== "undefined",
        marker: window.__applyKit !== undefined,
        browserApi: typeof window.browser !== "undefined",
        profileInPageText: ${JSON.stringify(Object.values(PROFILE))}.filter(v => text.includes(v))
      });
    });
  </script>
</body></html>`;

const ID_BY_KEY = { firstName: "fn", email: "em", phone: "ph", city: "ci", currentCompany: "co", lastName: "ln", postalCode: "pc", state: "st", github: "gh", website: "ws", salary: "sa", linkedin: "li" };

let server, base;
const builds = [];

before(async () => {
  server = createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  for (const dir of builds) rmSync(dir, { recursive: true, force: true });
});

// A copy of the extension. `openShadow` swaps the closed shadow root for an open one so the
// test can read and click the review panel; nothing else changes.
function buildCopy({ openShadow }) {
  const dir = mkdtempSync(join(tmpdir(), "apply-kit-e2e-"));
  builds.push(dir);
  cpSync(join(ROOT, "extension"), dir, { recursive: true });
  if (openShadow) {
    const file = join(dir, "content.js");
    const src = readFileSync(file, "utf8");
    const patched = src.replace('attachShadow({ mode: "closed" })', 'attachShadow({ mode: "open" })');
    assert.notEqual(patched, src, "content.js no longer creates its shadow root the way this test expects");
    writeFileSync(file, patched);
  }
  return dir;
}

async function startFirefox(extDir) {
  const options = new firefox.Options()
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [EXT_ID]: UUID }))
    .windowSize({ width: 1280, height: 900 });
  if (!process.env.HEADED) options.addArguments("-headless");
  // System access lets the test open the extension's own settings page, which WebDriver
  // won't navigate a normal tab to.
  const service = new firefox.ServiceBuilder().addArguments("--allow-system-access");
  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.installWebExtension(extDir, { permanent: false });
  await seedProfile(driver);
  return driver;
}

async function seedProfile(driver) {
  const first = await driver.getWindowHandle();
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    "gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });",
    `moz-extension://${UUID}/options.html`);
  await driver.setContext(firefox.Context.CONTENT);
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles.find(h => h !== first));
  await driver.wait(async () => (await driver.getCurrentUrl()).startsWith("moz-extension:") &&
    (await driver.executeScript("return document.readyState")) === "complete", 10000, "Settings page never loaded");
  const error = await driver.executeAsyncScript(`
    const [profile, done] = arguments;
    const api = window.browser || window.wrappedJSObject.browser;
    api.storage.sync.clear().then(() => api.storage.sync.set({ profile })).then(() => done(null), e => done(String(e)));`,
    PROFILE);
  assert.equal(error, null, "couldn't seed the profile");
  await driver.close();
  await driver.switchTo().window(first);
}

// Panel contents, read through the (test build's) open shadow root.
const READ_PANEL = `
  const host = [...document.documentElement.children].find(n => n.shadowRoot && n.shadowRoot.querySelector(".panel"));
  const panel = host && host.shadowRoot.querySelector(".panel");
  if (!panel || panel.hidden) return null;
  return {
    title: panel.querySelector(".title") && panel.querySelector(".title").textContent,
    rows: [...panel.querySelectorAll(".row")].map(r => ({
      field: r.querySelector(".name").textContent,
      checked: r.querySelector(".pick").getAttribute("aria-checked"),
      hidden: r.classList.contains("flag")
    }))
  };`;

const clickInPanel = sel => `
  const host = [...document.documentElement.children].find(n => n.shadowRoot && n.shadowRoot.querySelector(".panel"));
  host.shadowRoot.querySelector(${JSON.stringify(sel)}).click();`;

const values = driver => driver.executeScript(
  `return Object.fromEntries(Object.entries(arguments[0]).map(([k, id]) => [k, document.getElementById(id).value]));`, ID_BY_KEY);

test("review lists visible fields ticked, hidden ones unticked, and Fill/Undo only touch what was ticked", async () => {
  const driver = await startFirefox(buildCopy({ openShadow: true }));
  try {
    await driver.get(`${base}/careers/engineer/apply`);
    await driver.wait(async () => driver.executeScript(`
      const host = [...document.documentElement.children].find(n => n.shadowRoot && n.shadowRoot.querySelector(".fab"));
      return !!host && !host.shadowRoot.querySelector(".fab").hidden;`), 10000, "Review button never appeared");

    await driver.executeScript(clickInPanel(".fab"));
    const panel = await driver.wait(async () => driver.executeScript(READ_PANEL), 5000, "Review panel never opened");
    assert.equal(panel.title, "Review before filling");

    const byField = Object.fromEntries(panel.rows.map(r => [r.field, r]));
    const problems = [];
    for (const [key, field] of Object.entries(SHOWN)) {
      const r = byField[field];
      if (!r) problems.push(`${key}: missing from the review`);
      else if (r.hidden || r.checked !== "true") problems.push(`${key}: should be ticked and shown, got checked=${r.checked} hidden=${r.hidden}`);
    }
    for (const [key, field] of Object.entries(HIDDEN)) {
      const r = byField[field];
      if (!r) problems.push(`${key}: missing from the review`);
      else if (!r.hidden || r.checked !== "false") problems.push(`${key}: should be unticked under "Hidden on the page", got checked=${r.checked} hidden=${r.hidden}`);
    }
    assert.deepEqual(problems, []);

    await driver.executeScript(clickInPanel(".bar .btn.main"));
    await driver.wait(async () => {
      const p = await driver.executeScript(READ_PANEL);
      return p && p.title && p.title.startsWith("Filled");
    }, 15000, "Fill never finished");

    const filled = await values(driver);
    for (const key of Object.keys(SHOWN)) assert.equal(filled[key], PROFILE[key], `${key} should be filled`);
    for (const key of Object.keys(HIDDEN)) assert.equal(filled[key], "", `${key} is hidden and must stay empty`);

    await driver.executeScript(clickInPanel(".bar .btn:not(.main)"));
    const undone = await values(driver);
    for (const key of Object.keys(SHOWN)) assert.equal(undone[key], "", `${key} should be empty after Undo`);
  } finally {
    await driver.quit();
  }
});

test("the page itself can't reach the panel, the extension's code, or profile values before a fill", async () => {
  const driver = await startFirefox(buildCopy({ openShadow: false }));
  try {
    await driver.get(`${base}/careers/engineer/apply`);
    await driver.wait(until.elementLocated({ id: "probe" }), 5000);
    await driver.sleep(1500);
    // Show the suggestion box too, so profile values are on screen inside the closed shadow root.
    await driver.findElement({ id: "em" }).click();
    await driver.sleep(500);
    await driver.findElement({ id: "probe" }).click();
    const seen = JSON.parse(await driver.executeScript("return document.body.dataset.probe"));
    assert.deepEqual(seen, {
      hostFound: true, shadowRoot: false, akGlobal: false, marker: false, browserApi: false, profileInPageText: []
    });
  } finally {
    await driver.quit();
  }
});

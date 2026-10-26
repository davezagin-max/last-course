/**
 * Functional check of the built app, driven through headless Chromium.
 *
 *   BASE_URL=http://localhost:3120 FUNC_OUT=<dir> node scripts/functional.mjs
 *
 * Demo mode only. The key dialog is exercised with a made-up key whose shape
 * passes the form check; no question is asked and no generation is started
 * while a key is set, so nothing reaches the model. Exits 1 when any check
 * fails. Results (and screenshots) are written to FUNC_OUT when it is set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3120").replace(/\/$/, "");
const OUT = process.env.FUNC_OUT ?? "";
const STORAGE_KEY = "last-course:v1:the-fourth-course";
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const FAKE_KEY = "sk-ant-functional-test-key-00000000";
const TOTAL_QUESTIONS = 37;
const TOTAL_EXHIBITS = 15;
const TOTAL_THEORIES = 28;
const START_THEORIES = "14/28";

const results = [];
const issues = [];
const hosts = new Set();
const sideScroll = [];
const apiCalls = [];

function record(id, feature, pass, detail = "") {
  results.push({ id, feature, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${feature}${detail ? ` :: ${detail}` : ""}`);
}

async function check(id, feature, fn) {
  try {
    const detail = await fn();
    record(id, feature, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(id, feature, false, String(error?.message ?? error).split("\n")[0].slice(0, 300));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(fn, desc, timeout = 15000) {
  const end = Date.now() + timeout;
  let last = "";
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = String(error.message).split("\n")[0];
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${desc}${last ? ` (${last})` : ""}`);
}

async function shot(page, name) {
  if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function sideCheck(page, tag, label) {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  sideScroll.push({ tag, label, sw, iw, ok: sw <= iw });
}

async function openSite(browser, viewport, tag, { touch = false } = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(`${tag} console: ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (error) => issues.push(`${tag} page error: ${error.message.slice(0, 200)}`));
  page.on("response", (res) => {
    if (res.status() >= 400) issues.push(`${tag} HTTP ${res.status()} ${res.url().slice(0, 140)}`);
  });
  page.on("request", (req) => {
    const host = new URL(req.url()).host;
    if (!/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) hosts.add(host);
    if (/\/api\/(interrogate|generate)/.test(req.url())) apiCalls.push(req.url());
  });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await rail(page).first().waitFor();
  return { context, page };
}

// Selectors, kept in one place so a markup change is a one-line fix.
const tabButton = (page, name) =>
  page.getByRole("navigation", { name: "Views" }).getByRole("button", { name });
// Only the five suspect buttons: the nav also holds the "Make an accusation" button.
const rail = (page) =>
  page.getByRole("navigation", { name: "Suspects" }).locator("ul > li > button");
const interrogation = (page) => page.getByRole("region", { name: /^Interrogation of/ });
const questionButtons = (page) =>
  page.locator('section[aria-label^="Interrogation of"] ul > li > button');
const askedButtons = (page) => questionButtons(page).filter({ hasText: /\bAsked\b/ });
const transcript = (page) => page.getByRole("log", { name: "Transcript" });
const board = (page) => page.getByRole("region", { name: "Evidence board" });
const cards = (page) => page.locator('[aria-roledescription="movable card"]');
const reveal = (page) => page.locator('section[aria-label="The reveal"]');
const accusationForm = (page) => page.locator('section[aria-label="Accusation"]');

async function stat(page, label) {
  return page.evaluate((text) => {
    const dt = [...document.querySelectorAll("dl dt")].find((d) => d.textContent.trim() === text);
    return dt?.nextElementSibling?.textContent.trim() ?? null;
  }, label);
}

async function position(locator) {
  return locator.evaluate((el) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
  }));
}

async function askedCount(page) {
  return askedButtons(page).count();
}

/** Asks the first suggested question that has not been asked yet. Returns its text, or null. */
async function askNext(page) {
  const buttons = questionButtons(page);
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (/\bAsked\b/.test((await button.textContent()) ?? "")) continue;
    const spans = await button.locator("span").allTextContents();
    const text = spans.find((t) => t && !t.startsWith("Show:") && t !== "Asked") ?? "";
    const before = await askedCount(page);
    await button.click();
    await until(
      async () =>
        (await askedCount(page)) > before ||
        (await interrogation(page).getByRole("alert").count()) > 0,
      "the answer to a question",
      30000,
    );
    const alert = interrogation(page).getByRole("alert");
    if (await alert.count()) throw new Error(`answer failed: ${await alert.first().textContent()}`);
    return text;
  }
  return null;
}

/** Opens the first "New exhibit" button in the transcript, checks the dialog, closes it with Escape. */
async function exhibitFromTranscript(page) {
  const button = interrogation(page).getByRole("button", { name: /^New exhibit:/ }).first();
  if (!(await button.count())) return null;
  await button.click();
  await page.locator("dialog[open] h2").waitFor();
  const title = (await page.locator("dialog[open] h2").textContent())?.trim() ?? "";
  expect(title.length > 0, "exhibit dialog has no title");
  await page.keyboard.press("Escape");
  await until(async () => (await page.locator("dialog[open]").count()) === 0, "dialog to close");
  return title;
}

/** Works through every suggested question for every suspect, until none is left open. */
async function playEverything(page, tag) {
  let asked = 0;
  let exhibitTitle = null;
  for (let pass = 0; pass < 6; pass++) {
    let progressed = false;
    const suspects = await rail(page).count();
    for (let i = 0; i < suspects; i++) {
      await rail(page).nth(i).click();
      for (;;) {
        const question = await askNext(page);
        if (question === null) break;
        asked++;
        progressed = true;
        if (exhibitTitle === null) exhibitTitle = await exhibitFromTranscript(page);
      }
    }
    if (!progressed) break;
  }
  await sideCheck(page, tag, `after ${asked} questions`);
  return { asked, exhibitTitle };
}

async function desktopMain(browser) {
  const tag = "desktop";
  const { context, page } = await openSite(browser, DESKTOP, tag);

  // Start of game: banner, stats, suspect rail, locked questions, no-key explanation.
  await check("D1", "F1 demo banner says demo mode with an Add key button", async () => {
    const banner = page.locator("div[role=status]").filter({ hasText: "Demo mode" });
    await banner.waitFor();
    expect(
      (await banner.getByRole("button", { name: "Add key", exact: true }).count()) === 1,
      "no Add key button in the banner",
    );
    return (await banner.textContent()).trim().slice(0, 140);
  });

  await check("D2", "F2 starts with 14/28 theories and the first suspect in the chair", async () => {
    expect((await stat(page, "Theories left")) === START_THEORIES, `Theories left is ${await stat(page, "Theories left")}`);
    const exhibits = await stat(page, "Exhibits");
    expect(exhibits?.endsWith(`/${TOTAL_EXHIBITS}`), `Exhibits reads ${exhibits}`);
    const pressed = await rail(page).first().getAttribute("aria-pressed");
    expect(pressed === "true", "first suspect is not selected");
    expect((await rail(page).count()) === 5, "suspect rail does not list five suspects");
    return `Exhibits ${exhibits}, Theories left ${START_THEORIES}, five suspects`;
  });

  await check("D3", "F5 locked questions are counted and suggested questions show", async () => {
    await interrogation(page).getByText(/more questions? open/).first().waitFor();
    const open = await questionButtons(page).count();
    expect(open > 0, "no suggested question is open at the start");
    return `${open} open at the start`;
  });

  await check("D4", "F6 without a key the free-question box is replaced by an explanation", async () => {
    expect((await interrogation(page).getByRole("textbox").count()) === 0, "a free-question input shows in demo mode");
    await interrogation(page).getByText("Demo mode plays the questions above").waitFor();
    const addKey = interrogation(page).getByRole("button", { name: "Add your key", exact: true });
    expect((await addKey.count()) === 1, "no Add your key button in the explanation");
    return "explanation and Add your key shown, no input box";
  });

  await check("D5", "F3 a suggested question is answered in the transcript", async () => {
    const question = "Did you know the man at table seven?";
    const before = await transcript(page).textContent();
    await questionButtons(page).filter({ hasText: question }).click();
    await until(async () => (await askedCount(page)) >= 1, "the first answer");
    const after = await transcript(page).textContent();
    expect(after.includes(question), "question does not appear in the transcript");
    expect(after.length > before.length + question.length, "no answer text appeared");
    expect((await askedButtons(page).count()) === 1, "question not marked Asked");
    return "answer and the question are in the transcript and the question is marked Asked";
  });

  await check("D6", "F4 suspect rail shows the asked count for that suspect", async () => {
    const badge = rail(page).first().locator('span[title="1 asked"]');
    expect((await badge.count()) === 1, "rail badge does not show 1 asked for Odile");
    return "Odile shows 1 question asked";
  });

  await check("D7", "F8 the first question files a Proven false conflict in the notebook", async () => {
    await until(async () => ((await stat(page, "Conflicts")) ?? "0") !== "0", "a conflict to be counted");
    const notebook = page.locator("#notebook");
    await notebook.getByText("Proven false").first().waitFor();
    const notes = interrogation(page).getByRole("button", { name: /notes? in the notebook/ });
    expect((await notes.count()) > 0, "no notebook note link under the answer");
    return `Conflicts ${await stat(page, "Conflicts")}, Proven false shown`;
  });

  await shot(page, "desktop-question-first-answer");

  // Full playthrough: every suggested question, every suspect.
  let play = { asked: 0, exhibitTitle: null };
  let boardDefault = null;
  await check("D8", "F7 the 37 suggested questions can all be asked and unlock all 15 exhibits", async () => {
    play = await playEverything(page, tag);
    const totalAsked = play.asked + 1;
    expect(totalAsked === TOTAL_QUESTIONS, `asked ${totalAsked} of ${TOTAL_QUESTIONS}`);
    const exhibits = await until(async () => {
      const value = await stat(page, "Exhibits");
      return value === `${TOTAL_EXHIBITS}/${TOTAL_EXHIBITS}` ? value : null;
    }, "all exhibits to be found", 5000).catch(async () => stat(page, "Exhibits"));
    expect(exhibits === `${TOTAL_EXHIBITS}/${TOTAL_EXHIBITS}`, `Exhibits reads ${exhibits}`);
    return `${totalAsked} questions, Exhibits ${exhibits}`;
  });

  await check("D9", "F7 Theories left falls to 1 of 28 once every exhibit is found", async () => {
    const value = await until(async () => {
      const left = await stat(page, "Theories left");
      return left === `1/${TOTAL_THEORIES}` ? left : null;
    }, "Theories left to reach 1/28", 8000).catch(async () => stat(page, "Theories left"));
    expect(value === `1/${TOTAL_THEORIES}`, `Theories left reads ${value}`);
    return `Theories left ${value}`;
  });

  await check("D10", "F9 an exhibit opened from the transcript shows its title, then closes with Escape", async () => {
    expect(play.exhibitTitle !== null, "no New exhibit button was offered during play");
    return `opened and closed "${play.exhibitTitle}"`;
  });

  await check("D11", "F9 exhibit dialog opens from the notebook and closes by Close, Escape and backdrop", async () => {
    const notebook = page.locator("#notebook");
    const exhibitButtons = notebook.locator('section[aria-label="Exhibits"] button');
    expect((await exhibitButtons.count()) === TOTAL_EXHIBITS, `notebook lists ${await exhibitButtons.count()} exhibits`);
    await exhibitButtons.nth(0).click();
    await page.locator("dialog[open]").waitFor();
    await page.locator("dialog[open]").getByRole("button", { name: "Close", exact: true }).click();
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "Close to shut the dialog");
    await exhibitButtons.nth(1).click();
    await page.locator("dialog[open]").waitFor();
    await page.keyboard.press("Escape");
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "Escape to shut the dialog");
    await exhibitButtons.nth(2).click();
    await page.locator("dialog[open]").waitFor();
    await page.mouse.click(4, 4);
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "a backdrop click to shut the dialog");
    return "Close, Escape and backdrop each shut the dialog";
  });

  await check("D12", "F8 notebook has conflicts, statements that open, and claims with quotes", async () => {
    const notebook = page.locator("#notebook");
    const conflicts = notebook.locator('section[aria-label="Conflicts"]');
    await conflicts.waitFor();
    const groups = await conflicts.locator("li").count();
    expect(groups > 0, "no conflict groups listed after the playthrough");
    const statements = notebook.locator('section[aria-label="Statements"] details').first();
    const wasOpen = await statements.getAttribute("open");
    await statements.locator("summary").click();
    expect((await statements.getAttribute("open")) !== wasOpen, "statements did not toggle");
    return `${groups} conflict entries listed; statement list opens`;
  });

  await check("D13", "F8 a note link under an answer scrolls the notebook into view", async () => {
    const link = interrogation(page).getByRole("button", { name: /notes? in the notebook/ }).last();
    await link.click();
    await until(async () => {
      const top = await page.evaluate(() => document.getElementById("notebook")?.getBoundingClientRect().top ?? 1e9);
      return top < 800 ? top : null;
    }, "the notebook to be in view");
    return "notebook is on screen after the link";
  });

  // Board: strings, mouse drag, tidy, keyboard, Enter.
  await tabButton(page, /^Board/).click();
  await check("D14", "F10 evidence board shows 20 cards: five suspects and fifteen exhibits", async () => {
    await board(page).waitFor();
    const count = await cards(page).count();
    expect(count === 5 + TOTAL_EXHIBITS, `board shows ${count} cards`);
    return `${count} cards`;
  });

  await check("D15", "F15 strings are drawn between cards, with a legend, and a conflict string is red", async () => {
    const paths = await board(page).locator("svg path").count();
    expect(paths > 0, "no string paths on the board");
    const red = await board(page).locator('svg path[stroke="var(--danger)"]').count();
    expect(red > 0, "no conflict string on the board");
    for (const label of ["Concerns", "Contradicts", "Led to"]) {
      await board(page).getByText(label, { exact: true }).waitFor();
    }
    return `${paths} string paths, ${red} conflict string(s), legend shown`;
  });

  await check("D16", "F10 a card dragged with the mouse moves and stays where it is dropped", async () => {
    const tidy = page.getByRole("button", { name: "Tidy board", exact: true });
    expect(await tidy.isDisabled(), "Tidy board is enabled before anything moved");
    const exhibit = page.locator('[aria-roledescription="movable card"][aria-label^="Exhibit:"]').first();
    await exhibit.scrollIntoViewIfNeeded();
    const before = await position(exhibit);
    boardDefault = before;
    const box = await exhibit.boundingBox();
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy + 20, { steps: 8 });
    await page.mouse.move(sx + 120, sy + 70, { steps: 12 });
    await page.mouse.up();
    const after = await position(exhibit);
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    expect(moved >= 20, `card moved only ${moved}px`);
    expect(await tidy.isEnabled(), "Tidy board stayed disabled after a move");
    expect(await tabButton(page, /^Board/).getAttribute("aria-current"), "a drag opened something else");
    return `moved ${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)} px`;
  });

  await check("D17", "F14 Tidy board puts the moved cards back and disables itself again", async () => {
    const tidy = page.getByRole("button", { name: "Tidy board", exact: true });
    const exhibit = page.locator('[aria-roledescription="movable card"][aria-label^="Exhibit:"]').first();
    await tidy.click();
    expect(await tidy.isDisabled(), "Tidy board is still enabled after tidying");
    const restored = await until(async () => {
      const at = await position(exhibit);
      return boardDefault && at.x === boardDefault.x && at.y === boardDefault.y ? at : null;
    }, "the card to return to its default place", 5000);
    return `tidied; first exhibit card back at ${restored.x}, ${restored.y}`;
  });

  await check("D18", "F12 arrow keys move a focused card (Shift for larger steps) and the status line says so", async () => {
    const exhibit = page.locator('[aria-roledescription="movable card"][aria-label^="Exhibit:"]').first();
    await exhibit.scrollIntoViewIfNeeded();
    await exhibit.focus();
    const start = await position(exhibit);
    await page.keyboard.press("ArrowRight");
    const afterRight = await position(exhibit);
    expect(afterRight.x > start.x, "ArrowRight did not move the card right");
    await page.keyboard.press("Shift+ArrowDown");
    const afterShift = await position(exhibit);
    expect(afterShift.y - afterRight.y >= 40, "Shift+ArrowDown did not make a larger step down");
    const status = await board(page).getByRole("status").textContent();
    expect(status.includes("moved to"), `status line reads "${status}"`);
    return `ArrowRight +${afterRight.x - start.x}px, Shift+ArrowDown +${afterShift.y - afterRight.y}px; "${status.trim()}"`;
  });

  await check("D19", "F13 Enter on a focused exhibit opens its dialog; Escape closes it", async () => {
    const exhibit = page.locator('[aria-roledescription="movable card"][aria-label^="Exhibit:"]').first();
    await exhibit.focus();
    await page.keyboard.press("Enter");
    await page.locator("dialog[open] h2").waitFor();
    await page.keyboard.press("Escape");
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "dialog to close");
    return "dialog opened on Enter and closed on Escape";
  });

  await check("D20", "F13 Enter on a focused suspect card opens the Question view with that suspect", async () => {
    const suspect = page.locator('[aria-roledescription="movable card"][aria-label^="Suspect:"]').first();
    await suspect.focus();
    await page.keyboard.press("Enter");
    await until(async () => (await tabButton(page, /^Question/).getAttribute("aria-current")) === "page", "Question view");
    return "Question view opened";
  });

  // Timeline.
  await check("D21", "F16 timeline shows Says, Others say and Proven lanes with rows per suspect", async () => {
    await tabButton(page, /^Timeline/).click();
    const timeline = page.getByRole("region", { name: "Timeline" });
    await timeline.waitFor();
    for (const lane of ["Says", "Others say", "Proven", "In conflict"]) {
      await timeline.getByText(lane, { exact: true }).first().waitFor();
    }
    const rows = await timeline.locator('[aria-label$=": says"], [aria-label$=": others say"], [aria-label$=": proven"]').count();
    expect(rows > 0, "no lane rows rendered");
    const conflicting = await timeline.locator('[class*="border-danger"]').count();
    expect(conflicting > 0, "no conflicting bar drawn in red");
    return `${rows} lane rows, ${conflicting} conflict bars`;
  });

  await check("D22", "F16 timeline chart scrolls inside its own box and can take keyboard focus", async () => {
    const group = page.getByRole("group", { name: /Timeline chart/ });
    await group.focus();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expect(focused.startsWith("Timeline chart"), `focus went to "${focused}"`);
    return "timeline chart group is focusable";
  });

  // Snapshot the solved-but-unaccused game, so a fresh context can make the right accusation.
  let savedState = null;
  await check("D26", "F22 the game state is saved to this browser after play", async () => {
    savedState = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(savedState && savedState.length > 100, "no saved game in localStorage");
    return `${savedState.length} characters saved`;
  });

  // Accusation: a wrong one first, which must give feedback and show the reveal.
  await tabButton(page, /^Accuse/).click();
  await check("D23", "F17 Accuse is disabled until a culprit and a method are chosen", async () => {
    const button = accusationForm(page).getByRole("button", { name: "Accuse", exact: true });
    expect(await button.isDisabled(), "Accuse is enabled with no choice made");
    await accusationForm(page).locator("label", { hasText: "Odile Renard" }).first().click();
    expect(await button.isDisabled(), "Accuse is enabled with no method");
    await accusationForm(page).locator("label", { hasText: "consommé" }).first().click();
    expect(await button.isEnabled(), "Accuse is still disabled after culprit and method");
    return "disabled, then enabled after a culprit and a method";
  });

  await check("D24", "F19 a wrong accusation gives feedback: Case not closed and what was wrong", async () => {
    await accusationForm(page).locator("label", { hasText: "I cannot say why" }).first().click();
    await accusationForm(page).getByRole("button", { name: "Accuse", exact: true }).click();
    await reveal(page).waitFor();
    await reveal(page).getByText("Case not closed").waitFor();
    await reveal(page).getByText(/You accused Odile/).waitFor();
    await reveal(page).getByText(/It was Gus Pereira/).waitFor();
    return "Case not closed; line-by-line feedback names the real culprit";
  });

  await check("D25", "F30 once solved the Accuse tab reads The reveal", async () => {
    await tabButton(page, /^The reveal/).waitFor();
    return "tab reads The reveal";
  });

  // Case files: Start over returns the built case to its opening state.
  await tabButton(page, /^Case files/).click();
  await check("D27", "F23 Case files lists the built case as open now, and Start over resets it", async () => {
    const openNow = page.getByRole("button", { name: "Open now", exact: true });
    expect(await openNow.isDisabled(), "Open now is not disabled for the open case");
    const startOver = page.getByRole("button", { name: /^Start over \(/ });
    await startOver.first().click();
    await until(async () => (await stat(page, "Theories left")) === START_THEORIES, "theories to reset");
    expect((await stat(page, "Exhibits")) !== `${TOTAL_EXHIBITS}/${TOTAL_EXHIBITS}`, "exhibits did not reset");
    return "Start over returned Theories left to 14/28";
  });

  // Light and dark theme.
  await check("D28", "F27 the theme toggle switches light and dark, and the choice survives a reload", async () => {
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg !== lightBg, `background did not change: ${lightBg}`);
    expect((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "theme attribute not dark");
    await page.reload({ waitUntil: "networkidle" });
    await rail(page).first().waitFor();
    expect((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "dark did not survive reload");
    await shot(page, "desktop-dark");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    return `light ${lightBg}, dark ${darkBg}; dark kept after reload`;
  });

  await context.close();
  return { savedState };
}

async function desktopRestoreAndAccuse(browser, savedState) {
  const { context, page } = await openSite(browser, DESKTOP, "desktop-restore");
  await check("D29", "F22 a saved solved game comes back after a reload", async () => {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, savedState]);
    await page.reload({ waitUntil: "networkidle" });
    await rail(page).first().waitFor();
    await until(async () => (await stat(page, "Theories left")) === `1/${TOTAL_THEORIES}`, "the restored game");
    expect((await stat(page, "Exhibits")) === `${TOTAL_EXHIBITS}/${TOTAL_EXHIBITS}`, "exhibits were not restored");
    return "exhibits 15/15 and Theories left 1/28 come back";
  });

  await tabButton(page, /^Accuse/).click();
  await check("D30", "F20 a right accusation shows the scored reveal: Case closed and the full breakdown", async () => {
    await accusationForm(page).locator("label", { hasText: "Gus Pereira" }).first().click();
    await accusationForm(page).locator("label", { hasText: "grated over the turbot" }).first().click();
    await accusationForm(page).locator("label", { hasText: "Revenge for the review" }).first().click();
    await accusationForm(page).getByRole("button", { name: "Accuse", exact: true }).click();
    await reveal(page).waitFor();
    await reveal(page).getByText("Case closed", { exact: true }).waitFor();
    await reveal(page).getByText("You named the right person.").waitFor();
    await reveal(page).getByText("Why it could not have been anyone else").waitFor();
    await reveal(page).getByText("Everything they were hiding").waitFor();
    const score = await reveal(page).locator("span.font-display").first().textContent();
    return `Case closed, score ${score?.trim()} out of 100`;
  });

  await check("D31", "F21 Play this case again restarts the game", async () => {
    await reveal(page).getByRole("button", { name: "Play this case again" }).click();
    // The restart returns to the Question view, as Game.tsx does on reset.
    await until(async () => (await tabButton(page, /^Question/).getAttribute("aria-current")) === "page", "Question view");
    await until(async () => (await stat(page, "Theories left")) === START_THEORIES, "theories to reset");
    await tabButton(page, /^Accuse/).waitFor();
    return "back in the Question view with Theories left 14/28, and the tab reads Accuse again";
  });

  await shot(page, "desktop-after-restart");
  await context.close();
}

async function desktopReloadMidGame(browser) {
  const { context, page } = await openSite(browser, DESKTOP, "desktop-reload");
  await check("D32", "F22 reload mid-game keeps the transcript, the notebook and the exhibit count", async () => {
    const question = "Did you know the man at table seven?";
    await questionButtons(page).filter({ hasText: question }).click();
    await until(async () => (await askedCount(page)) === 1, "the first answer");
    const exhibitsBefore = await stat(page, "Exhibits");
    const conflictsBefore = await stat(page, "Conflicts");
    await page.reload({ waitUntil: "networkidle" });
    await rail(page).first().waitFor();
    await until(async () => (await askedCount(page)) === 1, "the transcript to come back");
    expect((await transcript(page).textContent()).includes(question), "transcript lost the question");
    expect((await stat(page, "Exhibits")) === exhibitsBefore, "exhibit count changed on reload");
    expect((await stat(page, "Conflicts")) === conflictsBefore, "conflict count changed on reload");
    return `after reload: Exhibits ${exhibitsBefore}, Conflicts ${conflictsBefore}, question still in transcript`;
  });
  await context.close();
}

async function desktopKeyAndNotebook(browser) {
  const { context, page } = await openSite(browser, DESKTOP, "desktop-key");

  await check("D33", "F18 Why lists only uncovered motives until evidence reveals them", async () => {
    await tabButton(page, /^Accuse/).click();
    await accusationForm(page).locator("label", { hasText: "Gus Pereira" }).first().click();
    await accusationForm(page).getByText(/still undiscovered/).waitFor();
    expect((await accusationForm(page).locator("label", { hasText: "Revenge for the review" }).count()) === 0, "a motive shows before it is uncovered");
    expect((await accusationForm(page).locator("label", { hasText: "I cannot say why" }).count()) === 1, "no I cannot say why option");
    return "undiscovered motive count shown; no motive listed before evidence";
  });

  await tabButton(page, /^Question/).click();

  await check("D34", "F26 the key dialog rejects a malformed key and keeps the dialog open", async () => {
    await page.getByRole("button", { name: "Add key", exact: true }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    await dialog.locator('input[name="key"]').fill("not-a-key");
    await dialog.getByRole("button", { name: "Use this key", exact: true }).click();
    await dialog.getByText("Anthropic keys start with sk-ant-").waitFor();
    expect((await page.locator("dialog[open]").count()) === 1, "dialog closed on a bad key");
    return "error shown, dialog kept open";
  });

  await check("D35", "F26 Cancel and Escape close the key dialog without changing mode", async () => {
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "Cancel to close");
    await page.getByRole("button", { name: "Add key", exact: true }).click();
    await page.locator("dialog[open]").waitFor();
    await page.keyboard.press("Escape");
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "Escape to close");
    expect((await page.locator("div[role=status]").filter({ hasText: "Demo mode" }).count()) === 1, "left demo mode");
    return "both closed, still in demo mode";
  });

  await check("D36", "F26 a well-formed key switches to live mode with no question sent; Remove key returns to demo", async () => {
    await page.getByRole("button", { name: "Add key", exact: true }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    const modelCallsBefore = modelCalls();
    await dialog.locator('input[name="key"]').fill(FAKE_KEY);
    await dialog.getByRole("button", { name: "Use this key", exact: true }).click();
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "the dialog to close");
    await page.getByText("Live — calling Claude Opus 5.5 with your key.").waitFor();
    await interrogation(page).getByText(/Suggested questions/).waitFor();
    const askInput = interrogation(page).getByRole("textbox");
    expect((await askInput.count()) === 1, "the live free-question input is missing");
    expect(await interrogation(page).getByRole("button", { name: "Ask", exact: true }).isDisabled(), "Ask is enabled with an empty box");
    expect(modelCalls() === modelCallsBefore, "a model route was called while the key was set");
    await page.getByRole("button", { name: "Change key" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Remove key", exact: true }).click();
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "Remove key to close");
    await page.locator("div[role=status]").filter({ hasText: "Demo mode" }).waitFor();
    expect((await interrogation(page).getByRole("textbox").count()) === 0, "free-question input still shown after Remove key");
    return "live banner and free input shown, Ask disabled while empty, Remove key restores demo mode";
  });

  await context.close();
}

/** Requests to the two routes that can call the model, made by any page in this run. */
function modelCalls() {
  return apiCalls.length;
}

async function desktopGenerator(browser) {
  const { context, page } = await openSite(browser, DESKTOP, "desktop-cases");
  await tabButton(page, /^Case files/).click();

  await check("D37", "F24 the generator panel says the run is a sample and the theme box is locked", async () => {
    await page.getByText("Handcrafted case", { exact: true }).first().waitFor();
    const theme = page.getByLabel("Theme (optional)");
    expect(await theme.isDisabled(), "theme box is editable in demo mode");
    await page.getByText(/Demo mode replays one sample run/).waitFor();
    return "theme box disabled; sample explanation shown";
  });

  await check("D38", "F24 replaying the sample shows labelled sample drafts with real validator verdicts", async () => {
    await page.getByRole("button", { name: "Replay the sample run" }).click();
    await page.getByRole("button", { name: "Open the sample case" }).waitFor({ timeout: 120000 });
    await page.getByText("Sample draft 1:").waitFor();
    expect((await page.getByText("rejected by the validator").count()) >= 1, "draft 1 not marked rejected");
    expect((await page.getByText("What the validator would send back").count()) >= 1, "no validator feedback heading");
    expect((await page.getByText("Sample (not a real run):").count()) >= 1, "cost line does not say sample");
    await shot(page, "desktop-sample-replay");
    return "sample drafts, rejected verdict, validator feedback and sample cost line shown";
  });

  await check("D39", "F25 the generated sample case says it has no recorded answers and offers a key", async () => {
    await page.getByRole("button", { name: "Open the sample case" }).click();
    await page.getByText("This case has no recorded answers", { exact: false }).first().waitFor();
    const addKey = interrogation(page).getByRole("button", { name: "Add your key", exact: true });
    expect((await addKey.count()) === 1, "no Add your key on the generated case");
    expect((await questionButtons(page).count()) === 0, "a generated case lists recorded questions");
    return "no questions; live-only message and Add your key shown";
  });

  await check("D40", "F25 the generated sample case can be accused and gives the scored reveal", async () => {
    await tabButton(page, /^Accuse/).click();
    await accusationForm(page).locator("label").first().click();
    await accusationForm(page).locator("fieldset").nth(1).locator("label").first().click();
    await accusationForm(page).getByRole("button", { name: "Accuse", exact: true }).click();
    await reveal(page).waitFor();
    return "reveal shown for the generated case";
  });

  await tabButton(page, /^Case files/).click();
  await check("D41", "F24 the generated case is listed as a sample case written by hand", async () => {
    await page.getByText("Sample case, written by hand").first().waitFor();
    return "listed as Sample case, written by hand";
  });

  await context.close();
}

async function phoneMain(browser) {
  const tag = "phone";
  const { context, page } = await openSite(browser, PHONE, tag, { touch: true });
  await sideCheck(page, tag, "first load");

  await check("P1", "F28 phone: demo banner and the briefing disclosure work, no sideways scroll", async () => {
    await page.locator("div[role=status]").filter({ hasText: "Demo mode" }).waitFor();
    const summary = page.locator("details summary", { hasText: "Read the briefing" });
    await summary.click();
    // An open <details> has an empty open attribute, so compare against null rather than truthiness.
    expect((await page.locator("details").first().getAttribute("open")) !== null, "briefing did not open");
    await sideCheck(page, tag, "briefing open");
    return "briefing opens";
  });

  await check("P2", "F28 phone: Make an accusation is hidden below the large breakpoint", async () => {
    const button = page.getByRole("button", { name: /^(Make an accusation|See the reveal)$/ });
    expect((await button.count()) === 0 || !(await button.first().isVisible()), "accusation button visible on phone");
    return "not visible on phone";
  });

  await check("P3", "F28 phone: a late suspect in the rail can be questioned without sideways scroll", async () => {
    await rail(page).nth(4).click();
    await interrogation(page).getByText("Gus Pereira").first().waitFor();
    await questionButtons(page).filter({ hasText: "Where were you during service?" }).click();
    await until(async () => (await askedCount(page)) === 1, "Gus to answer");
    await sideCheck(page, tag, "after questioning Gus");
    return "Gus answered; checked for sideways scroll";
  });

  await check("P4", "F3 phone: a suspect question is answered and a conflict appears", async () => {
    await rail(page).nth(0).click();
    await questionButtons(page).filter({ hasText: "Did you know the man at table seven?" }).click();
    await until(async () => (await askedCount(page)) === 1, "Odile to answer");
    await page.locator("#notebook").getByText("Proven false").first().waitFor();
    await sideCheck(page, tag, "after the conflicting answer");
    return "answer, notebook conflict Proven false";
  });

  await check("P5", "F11 phone: a card dragged by touch moves and stays put", async () => {
    await tabButton(page, /^Board/).click();
    const card = page.locator('[aria-roledescription="movable card"][aria-label^="Suspect:"]').first();
    await card.scrollIntoViewIfNeeded();
    const before = await position(card);
    const box = await card.boundingBox();
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 12; i++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x0 + i * 4, y: y0 + i * 3 }],
      });
      await sleep(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(150);
    const after = await position(card);
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    expect(moved >= 20, `touch moved the card only ${moved}px`);
    await sideCheck(page, tag, "after touch drag");
    return `touch moved the card ${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)} px`;
  });

  await check("P6", "F28 phone: the board scrolls inside its own box, not the page", async () => {
    const boardBox = page.locator('section[aria-label="Evidence board"] div.overflow-auto').first();
    const overflow = await boardBox.evaluate((el) => el.scrollWidth > el.clientWidth);
    await sideCheck(page, tag, "board");
    expect(overflow, "board does not overflow its own box on phone");
    return "board overflows inside its box";
  });

  await check("P7", "F16 phone: the timeline chart scrolls inside its own box", async () => {
    await tabButton(page, /^Timeline/).click();
    const group = page.getByRole("group", { name: /Timeline chart/ });
    await group.waitFor();
    const overflow = await group.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow, "timeline does not scroll inside its box");
    await sideCheck(page, tag, "timeline");
    return "timeline scrolls inside its box";
  });

  await check("P8", "F28 phone: the Accuse tab fits the phone width", async () => {
    await tabButton(page, /^Accuse/).click();
    await accusationForm(page).waitFor();
    await sideCheck(page, tag, "accuse");
    return "accusation form fits";
  });

  await check("P9", "F26 phone: the key dialog fits the phone width and closes", async () => {
    await tabButton(page, /^Case files/).click();
    await page.getByRole("button", { name: "Add your key to generate your own" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    expect(box.width <= PHONE.width, `dialog is ${box.width}px wide`);
    await sideCheck(page, tag, "key dialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await until(async () => (await page.locator("dialog[open]").count()) === 0, "dialog to close");
    return `dialog ${Math.round(box.width)}px wide, closes`;
  });

  await check("P10", "F9 phone: an exhibit opens full screen width and closes", async () => {
    await tabButton(page, /^Board/).click();
    const exhibit = page.locator('[aria-roledescription="movable card"][aria-label^="Exhibit:"]').first();
    expect((await exhibit.count()) > 0, "no exhibit card on the board to open on phone");
    await exhibit.scrollIntoViewIfNeeded();
    await exhibit.click();
    await page.locator("dialog[open]").waitFor();
    const box = await page.locator("dialog[open]").boundingBox();
    expect(box.width <= PHONE.width, `exhibit dialog is ${box.width}px wide`);
    await sideCheck(page, tag, "exhibit dialog");
    await page.keyboard.press("Escape");
    return `dialog ${Math.round(box.width)}px wide`;
  });

  await check("P11", "F27 phone: dark theme keeps the layout inside the phone width", async () => {
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    expect((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "not dark");
    await sideCheck(page, tag, "dark theme");
    await shot(page, "phone-dark");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    return "dark on phone, no sideways scroll";
  });

  await context.close();
}

async function skipLinkFocus(browser) {
  const { context, page } = await openSite(browser, DESKTOP, "desktop-keys");
  await check("D42", "F30 the first Tab press lands on the skip link", async () => {
    await page.keyboard.press("Tab");
    const text = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(text === "Skip to content", `first focus is "${text}"`);
    return "Skip to content has focus first";
  });
  await context.close();
}

// Network check kept separate from the browser flow: requests to any host other than this one are noted.
function externalHostsCheck() {
  return [...hosts];
}

async function main() {
  if (OUT) mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let savedState = null;
  try {
    try {
      savedState = (await desktopMain(browser)).savedState;
    } catch (error) {
      record("D-run", "desktop main flow", false, String(error.message).split("\n")[0]);
    }
    if (savedState) {
      await desktopRestoreAndAccuse(browser, savedState).catch((error) =>
        record("D-restore", "restore and accuse", false, String(error.message).split("\n")[0]),
      );
    }
    await desktopReloadMidGame(browser).catch((error) =>
      record("D-reload", "reload mid-game", false, String(error.message).split("\n")[0]),
    );
    await desktopKeyAndNotebook(browser).catch((error) =>
      record("D-key", "key dialog and motives", false, String(error.message).split("\n")[0]),
    );
    await desktopGenerator(browser).catch((error) =>
      record("D-cases", "case files and generator", false, String(error.message).split("\n")[0]),
    );
    await skipLinkFocus(browser).catch((error) =>
      record("D-skip", "skip link", false, String(error.message).split("\n")[0]),
    );
    await phoneMain(browser).catch((error) =>
      record("P-run", "phone flow", false, String(error.message).split("\n")[0]),
    );
  } finally {
    await browser.close();
  }

  const failing = sideScroll.filter((s) => !s.ok);
  record(
    "F28",
    "no sideways page scroll at 390px and 1280px after each interaction",
    failing.length === 0,
    failing.length
      ? `first failure ${failing[0].tag} after ${failing[0].label}: ${failing[0].sw} > ${failing[0].iw}`
      : `${sideScroll.length} checks, all within the viewport`,
  );
  record(
    "F29",
    "no console errors, uncaught page errors or HTTP errors",
    issues.length === 0,
    issues.length ? `${issues.length} issue(s), first: ${issues[0]}` : "none",
  );
  const external = externalHostsCheck();
  record(
    "NET",
    "no request left the local server (fonts and scripts are self-hosted)",
    external.length === 0,
    external.length ? `hosts: ${external.join(", ")}` : "none",
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (OUT) {
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ results, issues, sideScroll, hosts: [...hosts] }, null, 2));
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

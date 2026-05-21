const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];

  page.on("console", (msg) => {
    logs.push({ t: Date.now(), type: msg.type(), text: msg.text() });
  });

  page.on("pageerror", (err) => {
    logs.push({
      t: Date.now(),
      type: "pageerror",
      text: String(err && err.stack ? err.stack : err),
    });
  });

  const start = Date.now();
  try {
    await page.goto("http://localhost:8080/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (e) {
    logs.push({ t: Date.now(), type: "goto-error", text: String(e) });
  }

  await page.waitForTimeout(300000);

  const interesting = logs.filter((l) => {
    const s = String(l.text || "").toLowerCase();
    return (
      l.type === "error" ||
      l.type === "warning" ||
      l.type === "pageerror" ||
      s.includes("react error #418") ||
      s.includes("minified react error") ||
      s.includes("@supabase/gotrue-js") ||
      s.includes('lock "lock:sb-') ||
      s.includes("coingecko") ||
      s.includes("cors") ||
      s.includes("429") ||
      s.includes("failed to fetch")
    );
  });

  const counts = {};
  for (const l of interesting) counts[l.type] = (counts[l.type] || 0) + 1;

  console.log("CAPTURE_START", new Date(start).toISOString());
  console.log("CAPTURE_END", new Date().toISOString());
  console.log("INTERESTING_COUNT", interesting.length);
  console.log("COUNTS", JSON.stringify(counts));
  console.log("---INTERESTING_LOGS_BEGIN---");
  for (const l of interesting) {
    console.log(new Date(l.t).toISOString(), `[${l.type}]`, l.text);
  }
  console.log("---INTERESTING_LOGS_END---");

  await browser.close();
})();

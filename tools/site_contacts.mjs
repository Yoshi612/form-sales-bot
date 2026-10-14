// 候補各社の公式サイトから電話・FAX・メールを集める（業者マスタ照合用）。フォームには何も入力しない
import { chromium } from "playwright";
import fs from "node:fs";
const [inFile, outFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(inFile, "utf8"));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await b.newContext({ locale: "ja-JP" });
const out = [];
for (const r of rows) {
  const p = await ctx.newPage();
  const phones = new Set((r.phones || []).map((x) => x.replace(/\D/g, "")).filter(Boolean));
  const mails = new Set((r.emails || []).map((x) => x.toLowerCase()));
  const urls = [r.officialUrl, r.officialUrl && new URL(r.officialUrl).origin + "/", r.contactUrl].filter(Boolean);
  for (const u of [...new Set(urls)]) {
    try {
      await p.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
      await p.waitForTimeout(1200);
      const { text, hrefs } = await p.evaluate(() => ({ text: document.body?.innerText || "", hrefs: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")) }));
      const t = text.normalize("NFKC");
      for (const m of t.matchAll(/0\d{1,4}[-‐ー−()（） ]?\d{1,4}[-‐ー−()（） ]?\d{3,4}/g)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 10 && d.length <= 11) phones.add(d); }
      for (const m of t.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) mails.add(m[0].toLowerCase());
      for (const h of hrefs) { if (h?.startsWith("tel:")) phones.add(h.replace(/\D/g, "")); if (h?.startsWith("mailto:")) mails.add(h.slice(7).split("?")[0].toLowerCase()); }
    } catch (e) { /* 取れないページは飛ばす */ }
  }
  let domain = ""; try { domain = new URL(r.officialUrl || r.contactUrl).hostname.replace(/^www\./, ""); } catch {}
  // フォームの記入例などに使われる仮の番号（0000000000・0123456789 など）は照合に使わない
  const dummy = (d) => /^(\d)\1+$/.test(d.slice(1)) || /0123456789|1234567|9876543/.test(d);
  out.push({ ...r, phones: [...phones].filter((d) => !dummy(d)), mails: [...mails], domain });
  await p.close();
  process.stderr.write(".");
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await b.close();

// 公式サイトから問い合わせフォームのページを探す

const LINK_POSITIVE = [
  [/お問い?合わ?せ|問合せ|問い合せ/, 6],
  [/contact|inquiry|enquiry|toiawase|otoiawase/i, 5],
  [/法人|企業|その他|一般|ご意見|ご相談/, 2],
];
const LINK_NEGATIVE = [
  [/採用|求人|recruit|entry|エントリー|応募/i, -12],
  [/査定|見積|買取申込|在庫|試乗|来店|予約|ローン|reserve|estimate|satei/i, -6],
  [/faq|よくある|privacy|プライバシー/i, -4],
];
const COMMON_PATHS = ["/contact/", "/inquiry/", "/contact.html", "/toiawase/", "/otoiawase/", "/form/", "/contact.php", "/inquiry.html"];

function scoreLink(text, href) {
  const s = `${text} ${href}`;
  let score = 0;
  for (const [re, w] of LINK_POSITIVE) if (re.test(s)) score += w;
  for (const [re, w] of LINK_NEGATIVE) if (re.test(s)) score += w;
  return score;
}

async function gotoSafe(page, url, timeout) {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    if (res && res.status() >= 400) return false;
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function collectLinks(page) {
  return page.$$eval("a[href]", (as) =>
    as.map((a) => ({ text: (a.innerText || a.getAttribute("title") || a.querySelector("img")?.alt || "").trim(), href: a.href }))
  );
}

// ページ（または iframe）に「問い合わせ用」らしいフォームがあるか
export async function findContactFormFrame(page) {
  for (const frame of page.frames()) {
    const ok = await frame
      .evaluate(() => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const tas = [...document.querySelectorAll("textarea")].filter(visible);
        const inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button])")].filter(visible);
        if (!(tas.length > 0 && inputs.length >= 2)) return false;
        // 車両情報や予約日を入れさせるフォーム（買取査定・来店予約・レンタカー）は除外
        const form = tas[0].closest("form") || document.body;
        const names = [...form.querySelectorAll("input, select, textarea")].map((el) => el.name).join(" ");
        const hits = (form.innerText + " " + names).match(
          /メーカー|車種|年式|走行距離|排気量|修復歴|グレード|ご利用予定|配車|来店希望|予約日|car_class|maker|mileage|nenshiki/gi
        );
        return new Set((hits || []).map((h) => h.toLowerCase())).size < 3;
      })
      .catch(() => false);
    if (ok) return frame;
  }
  return null;
}

/**
 * @returns {{url?:string, frame?:import('playwright').Frame, mailto?:string, reason:string}}
 */
export async function findContactPage(page, row, settings) {
  const timeout = settings.pageTimeoutMs;
  const tried = new Set();

  // 1. リストに問い合わせURLが既にあればそれを使う
  if (row.contactUrl && /^https?:/.test(row.contactUrl)) {
    if (await gotoSafe(page, row.contactUrl, timeout)) {
      const frame = await findContactFormFrame(page);
      if (frame) return { url: page.url(), frame, reason: "リスト記載URL" };
    }
    tried.add(row.contactUrl);
  }

  if (!row.officialUrl) return { reason: "公式URLなし" };
  let origin;
  try {
    origin = new URL(row.officialUrl).origin;
  } catch {
    return { reason: "公式URLが不正" };
  }

  // 2. 公式URLページとトップページのリンクを集めてスコアリング
  const candidates = new Map();
  let mailto;
  for (const start of [row.officialUrl, origin + "/"]) {
    if (!(await gotoSafe(page, start, timeout))) continue;
    for (const { text, href } of await collectLinks(page)) {
      if (href.startsWith("mailto:")) {
        if (!mailto && /問|contact|info/i.test(text + href)) mailto = href.replace("mailto:", "").split("?")[0];
        continue;
      }
      let u;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      // 外部フォームサービスは許可、その他の外部ドメインは除外
      const external = u.origin !== origin && !/form|toiawase|contact|hubspot|formrun|tayori|google\.com\/forms/i.test(u.href);
      if (external) continue;
      u.hash = "";
      const score = scoreLink(text, u.href);
      if (score <= 0) continue;
      const prev = candidates.get(u.href);
      if (!prev || prev.score < score) candidates.set(u.href, { href: u.href, score, text });
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, settings.maxCandidatesPerSite);
  const queue = [...ordered.map((c) => c.href), ...COMMON_PATHS.map((p) => origin + p)];

  for (const url of queue) {
    if (tried.has(url)) continue;
    tried.add(url);
    if (!(await gotoSafe(page, url, timeout))) continue;
    const frame = await findContactFormFrame(page);
    if (frame) return { url: page.url(), frame, reason: "自動探索" };
    // 問い合わせページにフォームがなく、店舗ごとのメールアドレスだけ載っている場合に備えて拾っておく
    if (!mailto) {
      const mails = await page.$$eval('a[href^="mailto:"]', (as) => as.map((a) => a.href.replace("mailto:", "").split("?")[0]));
      if (mails.length) mailto = [...new Set(mails)].slice(0, 3).join(", ");
    }
  }

  if (mailto) return { mailto, reason: "フォームなし（メールアドレスのみ）" };
  return { reason: "フォーム見つからず" };
}

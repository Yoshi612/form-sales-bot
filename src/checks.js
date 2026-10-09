// 営業お断りの記載と CAPTCHA の検出

const NO_SALES_PATTERNS = [
  /(営業|勧誘|セールス|売り込み|宣伝|広告)[^。\n]{0,25}(ご遠慮|お断り|禁止|お控え|受け付けて(おり|い)ません|受付(して|いたして)(おり|い)ません|対応(いた|致)しかねます|ご返信(いた|致)しかねます|返信(いた|致)しません|回答(いた|致)しかねます)/,
  /(ご遠慮|お断り)[^。\n]{0,15}(営業|勧誘|セールス|売り込み)/,
];

export async function detectNoSales(frame) {
  const text = await frame.evaluate(() => document.body?.innerText || "").catch(() => "");
  for (const re of NO_SALES_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const i = Math.max(0, m.index - 20);
      return text.slice(i, m.index + m[0].length + 20).replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

export async function detectCaptcha(page) {
  for (const frame of page.frames()) {
    const url = frame.url();
    if (/recaptcha|hcaptcha|challenges\.cloudflare|turnstile/i.test(url)) {
      if (/recaptcha/.test(url) && /size=invisible/.test(url)) return "reCAPTCHA(不可視)";
      return "あり(" + (url.match(/recaptcha|hcaptcha|turnstile|cloudflare/i)?.[0] ?? "captcha") + ")";
    }
  }
  const inPage = await page
    .evaluate(() => !!document.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]"))
    .catch(() => false);
  if (inPage) return "あり";
  const v3 = await page.evaluate(() => !!document.querySelector('script[src*="recaptcha/api.js?render="]')).catch(() => false);
  if (v3) return "reCAPTCHA v3(不可視)";
  return null;
}

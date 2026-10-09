// 営業お断りの記載と CAPTCHA の検出

const NO_SALES_PATTERNS = [
  /(営業|勧誘|セールス|売り込み|宣伝|広告)[^。\n]{0,25}(ご遠慮|お断り|禁止|お控え|受け付けて(おり|い)ません|受付(して|いたして)(おり|い)ません|対応(いた|致)しかねます|ご返信(いた|致)しかねます|返信(いた|致)しません|回答(いた|致)しかねます)/,
  /(ご遠慮|お断り)[^。\n]{0,15}(営業|勧誘|セールス|売り込み)/,
  // 「営業目的のお問い合わせではありません」に同意させるチェックボックスも、営業お断りとみなす
  /(営業|セールス|勧誘)(目的|活動)?(の|での)?(お問い?合わ?せ|ご連絡|ご利用)?では(ありません|ない|ございません)/,
];

export async function detectNoSales(frame) {
  const text = await frame
    .evaluate(() =>
      [document.body?.innerText || "", ...[...document.querySelectorAll("[placeholder]")].map((el) => el.getAttribute("placeholder"))].join("\n")
    )
    .catch(() => "");
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
  const imageAuth = await page
    .evaluate(() => /画像認証|認証コード|画像内の文字|表示されている文字/.test(document.body?.innerText || ""))
    .catch(() => false);
  if (imageAuth) return "画像認証（手入力が必要）";
  const quiz = await page
    .evaluate(() =>
      // 目に見える入力欄だけを見る（reCAPTCHA が使う hidden の欄は対象外）
      [...document.querySelectorAll('input[name*=quiz]:not([type=hidden]), input[name*=captcha]:not([type=hidden]):not([name*=recaptcha])')].length > 0 ||
      /\d\s*[+＋\-－×]\s*\d\s*(は|=|＝)/.test(document.body?.innerText || "")
    )
    .catch(() => false);
  if (quiz) return "計算クイズ（手入力が必要）";
  const v3 = await page.evaluate(() => !!document.querySelector('script[src*="recaptcha/api.js?render="]')).catch(() => false);
  if (v3) return "reCAPTCHA v3(不可視)";
  return null;
}

// 判定結果に従ってフォームに入力する。送信ボタンは押さない。

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function render(tpl, row) {
  return tpl
    .replaceAll("{{企業名}}", row.company)
    .replaceAll("{{確認できた事業}}", row.business || "事業")
    .replaceAll("{{営業切り口}}", row.angle || "ご提案");
}

const PREFERRED_OPTION = /その他|ご提案|提案|業務提携|取引|法人|お問い?合わ?せ|一般/;
const BAD_OPTION = /^(選択|--|ー|－|お選び|please|select)|採用|求人|購入|査定|買取|見積/i;

function pickOption(options) {
  const usable = options.map((o, i) => ({ o, i })).filter(({ o }) => o && !BAD_OPTION.test(o));
  return (usable.find(({ o }) => PREFERRED_OPTION.test(o)) ?? usable[0])?.i;
}

/** 同じカテゴリが複数欄ある（電話番号3分割など）場合に値を分ける */
function splitValue(category, value, count, pos) {
  if (count <= 1) return value;
  if (category === "tel" || category === "zip") {
    const parts = value.split(/[-ー－]/);
    return parts[pos] ?? "";
  }
  if (category === "emailConfirm" || category === "email") return value;
  return pos === 0 ? value : "";
}

export async function fillForm(frame, fields, classes, row, config) {
  const s = config.sender;
  const values = {
    company: s.company,
    department: s.department,
    position: s.position,
    name: `${s.lastName} ${s.firstName}`,
    lastName: s.lastName,
    firstName: s.firstName,
    kana: `${s.lastNameKana} ${s.firstNameKana}`,
    lastKana: s.lastNameKana,
    firstKana: s.firstNameKana,
    email: s.email,
    emailConfirm: s.email,
    tel: s.tel,
    zip: s.zip,
    pref: s.pref,
    address: s.address,
    url: s.url,
    subject: render(config.subject, row),
    message: render(config.message, row),
  };

  const byIdx = new Map(fields.map((f) => [f.idx, f]));
  const counts = {};
  for (const c of classes) counts[c.category] = (counts[c.category] ?? 0) + 1;
  const seen = {};
  const filled = [];
  const handledGroups = new Set();

  for (const { idx, category } of classes) {
    const f = byIdx.get(idx);
    if (!f) continue;
    const loc = frame.locator(`[data-fsb="${idx}"]`);
    const pos = (seen[category] = (seen[category] ?? -1) + 1);
    try {
      if (f.type === "radio" || (f.type === "checkbox" && category !== "agree")) {
        const key = `${f.type}:${f.name}`;
        if (handledGroups.has(key) || !(f.required || category === "inquiryType")) continue;
        handledGroups.add(key);
        const group = fields.filter((g) => g.type === f.type && g.name === f.name);
        const i = pickOption(group.map((g) => g.optionLabel));
        if (i == null) continue;
        await frame.locator(`[data-fsb="${group[i].idx}"]`).check({ force: true, timeout: 3000 });
        filled.push(`${f.label || f.name}=${group[i].optionLabel}`);
        continue;
      }
      if (category === "agree") {
        await loc.check({ force: true, timeout: 3000 });
        filled.push("同意チェック");
        continue;
      }
      if (f.tag === "select") {
        if (!(f.required || category === "inquiryType" || category === "pref")) continue;
        const i = category === "pref" ? f.options.findIndex((o) => o.includes(s.pref)) : pickOption(f.options);
        if (i == null || i < 0) continue;
        await loc.selectOption({ index: i }, { timeout: 3000 });
        filled.push(`${f.label || f.name}=${f.options[i]}`);
        continue;
      }
      if (category === "ignore" || category === "inquiryType") continue;
      let v = splitValue(category, values[category] ?? "", counts[category], pos);
      if (!v) continue;
      if ((category === "kana" || category === "lastKana" || category === "firstKana") && /ふりがな|ひらがな/.test(f.label + f.placeholder)) {
        v = toHiragana(v);
      }
      await loc.fill(v, { timeout: 3000 });
      filled.push(`${f.label || f.name || f.placeholder || category}`);
    } catch {
      // 入力できなかった欄は missingRequired 側で拾う
    }
  }

  // 必須なのに空のまま残った欄
  const missingRequired = await frame.evaluate(() =>
    [...document.querySelectorAll("[data-fsb]")]
      .filter((el) => el.required || el.getAttribute("aria-required") === "true")
      .filter((el) => {
        if (el.type === "radio" || el.type === "checkbox") {
          return !document.querySelector(`[name="${CSS.escape(el.name)}"]:checked`);
        }
        return !el.value;
      })
      .map((el) => el.name || el.id || el.placeholder)
  );
  return { filled, missingRequired: [...new Set(missingRequired)] };
}

// 判定結果に従ってフォームに入力する。送信ボタンは押さない。

// 通常の操作で入力できない欄（アニメーションで隠れている等）は、値を直接入れてイベントを発火する
async function setValue(loc, v) {
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await loc.fill(v, { timeout: 3000 });
  } catch {
    await loc.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, v);
  }
}

async function setChecked(loc) {
  try {
    await loc.check({ force: true, timeout: 3000 });
  } catch {
    await loc.evaluate((el) => {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  // React 等の部品はチェックが戻されることがあるので、そのときは見えているラベルを押す
  await new Promise((r) => setTimeout(r, 200));
  if (!(await loc.isChecked().catch(() => true))) {
    await loc.evaluate((el) => (el.closest("label") || el.parentElement).click()).catch(() => {});
  }
}

const fieldName = (f) => (f.label && f.label.length <= 30 ? f.label : f.placeholder || f.name || f.label);

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function render(tpl, row, s) {
  return tpl
    .replaceAll("{{自分の名前}}", `${s.lastName}${s.firstName}`)
    .replaceAll("{{自社名}}", s.company)
    .replaceAll("{{部署}}", s.department)
    .replaceAll("{{電話}}", s.tel)
    .replaceAll("{{メール}}", s.email)
    .replaceAll("{{企業名}}", row.company)
    .replaceAll("{{確認できた事業}}", row.business || "事業")
    .replaceAll("{{営業切り口}}", row.angle || "ご提案");
}

// 選択肢は上から順に優先する。どれにも当たらないときは選ばない（必須なら空きとして記録される）
const PREFERRED_OPTIONS = [/いいえ|該当しない/, /営業|ご提案|提案|業務提携|協業|お取引|取引|法人|ビジネス/, /その他|other/i, /一般|お問い?合わ?せ/];
const BAD_OPTION =
  /^(--|ー|－|please|select)|選択して|お選び|採用|求人|購入|査定|買取|買い取り|見積|売却|車検|整備|修理|保険|ローン|レンタ|在庫|予約|試乗|来店|部品|パーツ|メンテ|コーティング|板金|鈑金/i;

function pickOption(options) {
  const usable = options.map((o, i) => ({ o, i })).filter(({ o }) => o && !BAD_OPTION.test(o));
  for (const re of PREFERRED_OPTIONS) {
    const hit = usable.find(({ o }) => re.test(o));
    if (hit) return hit.i;
  }
  return undefined;
}

/** 同じカテゴリが複数欄ある（電話番号3分割など）場合に値を分ける */
// 電話番号の3分割・郵便番号の2分割は、欄の数が合っていて並んでいるときだけ分ける。
// それ以外で同じ種類の欄が複数あるときは、最初の欄にだけ全体を入れる
function splitValue(category, value, idxs, pos) {
  if (idxs.length <= 1) return value;
  if (category === "email" || category === "emailConfirm") return value;
  const parts = value.split(/[-ー－]/);
  const adjacent = Math.max(...idxs) - Math.min(...idxs) <= idxs.length;
  if ((category === "tel" || category === "zip") && parts.length === idxs.length && adjacent) return parts[pos] ?? "";
  // 住所欄が2つ（市区町村／番地以降）なら、最初の数字の手前で分ける
  if (category === "address" && idxs.length === 2) {
    const m = value.match(/^(\D+?)(\d.*)$/);
    return m ? [m[1], m[2]][pos] : pos === 0 ? value : "";
  }
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
    building: "",
    url: s.url,
    subject: render(config.subject, row, s),
    message: render(config.message, row, s),
  };
  const shortMessage = config.messageShort ? render(config.messageShort, row, s) : null;
  {
    const cats = new Set(classes.map((c) => c.category));
    const [street, ...rest] = s.address.split(/\s+/);
    let addr = s.address;
    if (cats.has("building") && rest.length) {
      addr = street;
      values.building = rest.join(" ");
    }
    if (cats.has("pref") && s.pref && addr.startsWith(s.pref)) addr = addr.slice(s.pref.length);
    values.address = addr;
  }

  const byIdx = new Map(fields.map((f) => [f.idx, f]));
  const idxsOf = {};
  for (const c of classes) (idxsOf[c.category] ??= []).push(c.idx);
  const seen = {};
  const filled = [];
  const handledGroups = new Set();
  const tickedIdx = [];
  const overLength = [];
  let usedShort = false;

  for (const { idx, category } of classes) {
    const f = byIdx.get(idx);
    if (!f) continue;
    const loc = frame.locator(`[data-fsb="${idx}"]`);
    const pos = (seen[category] = (seen[category] ?? -1) + 1);
    try {
      if (f.type === "radio" || (f.type === "checkbox" && category !== "agree")) {
        const key = `${f.type}:${f.name}`;
        if (handledGroups.has(key)) continue;
        const group = fields.filter((g) => g.type === f.type && g.name === f.name);
        const labels = group.map((g) => g.optionLabel);
        // 必須の印がアイコンだけで判定できないフォームもあるため、
        // 「その他」がある問い合わせ種別と、連絡方法（電話／メール）は必須でなくても選んでおく
        const isContactMethod = labels.some((o) => /メール|e-?mail/i.test(o)) && labels.some((o) => /電話|tel/i.test(o)) && labels.length <= 4;
        const hasOther = labels.some((o) => /その他|other/i.test(o));
        if (!(f.required || category === "inquiryType" || isContactMethod || hasOther)) continue;
        handledGroups.add(key);
        const i = isContactMethod ? labels.findIndex((o) => /メール|e-?mail/i.test(o)) : pickOption(labels);
        if (i == null) continue;
        await setChecked(frame.locator(`[data-fsb="${group[i].idx}"]`));
        tickedIdx.push(group[i].idx);
        filled.push(`${fieldName(f)}：${group[i].optionLabel}`);
        continue;
      }
      if (category === "agree") {
        await setChecked(loc);
        tickedIdx.push(idx);
        filled.push(`${f.optionLabel || f.label || "同意"}：チェック`);
        continue;
      }
      if (f.tag === "select") {
        const selectHasOther = f.options.some((o) => /その他|other/i.test(o)) && !/車種|メーカー|model|car/i.test(f.label + f.name);
        if (!(f.required || category === "inquiryType" || selectHasOther || (category === "pref" && s.pref))) continue;
        let i = category === "pref" ? (s.pref ? f.options.findIndex((o) => o.includes(s.pref)) : -1) : pickOption(f.options);
        // 必須の「店舗選択」は本店（なければ最初の店舗）を選ぶ
        if (i == null && f.required && /店舗|店|拠点|store|shop/i.test(f.label + f.name)) {
          const usable = f.options.map((o, k) => ({ o, k })).filter(({ o }) => o && !/選択|お選び|^-+$|please|select/i.test(o));
          i = (usable.find(({ o }) => /本店|本社/.test(o)) ?? usable[0])?.k;
        }
        if (i == null || i < 0) continue;
        await loc.selectOption({ index: i }, { timeout: 3000 });
        filled.push(`${fieldName(f)}：${f.options[i]}`);
        continue;
      }
      if (category === "ignore" || category === "inquiryType") continue;
      let v = splitValue(category, values[category] ?? "", idxsOf[category], pos);
      if (!v) continue;
      if ((category === "kana" || category === "lastKana" || category === "firstKana") && (/ふりがな|ひらがな/.test(f.label) || /^[\u3041-\u3096\u30fc\s　（）()例：:]+$/.test(f.placeholder.replace(/[a-z]/gi, "")) && /[\u3041-\u3096]/.test(f.placeholder))) {
        v = toHiragana(v);
      }
      const maxLen = await loc.getAttribute("maxlength");
      // 「ハイフンなし」指定や桁数制限のある電話・郵便番号欄は、ハイフンを除いて入れる
      if ((category === "tel" || category === "zip") && (/ハイフン(なし|無し|不要)|ハイフンを?入れず/.test(f.label + f.placeholder) || /^\d+$/.test(f.placeholder) || (maxLen && v.length > Number(maxLen)))) {
        v = v.replace(/[-ー－]/g, "");
      }
      // 本文が上限を超えるときは短縮版を使い、それでも超えるなら切り詰める
      if (category === "message" && maxLen && v.length > Number(maxLen) && shortMessage) {
        v = shortMessage;
        usedShort = true;
      }
      if (maxLen && Number(maxLen) > 0 && v.length > Number(maxLen)) {
        overLength.push(`${f.label || f.name || category}（上限${maxLen}字、文面${v.length}字）`);
        v = v.slice(0, Number(maxLen));
      }
      await setValue(loc, v);
      const shown = category === "message" ? `（本文${usedShort && v === shortMessage ? "・短縮版" : ""} ${v.length}字）` : v;
      filled.push(`${fieldName(f) || category}：${shown}`);
    } catch {
      // 入力できなかった欄は missingRequired 側で拾う
    }
  }

  // 選んだはずのチェック・ラジオが画面の仕組みで外れていないか確かめ、外れていれば押し直す
  await new Promise((r) => setTimeout(r, 800));
  const notStuck = [];
  for (const idx of tickedIdx) {
    const loc = frame.locator(`[data-fsb="${idx}"]`);
    if (await loc.isChecked().catch(() => true)) continue;
    await loc.evaluate((el) => (el.closest("label") || el.parentElement).click()).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    if (!(await loc.isChecked().catch(() => true))) notStuck.push(byIdx.get(idx)?.optionLabel || byIdx.get(idx)?.label || String(idx));
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
  return { filled, missingRequired: [...new Set([...missingRequired, ...notStuck.map((l) => `選択できず:${l}`)])], overLength, usedShort };
}

// フォーム項目の抽出と「何を入れる欄か」の判定（ルール + 任意で Claude）
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const CATEGORIES = [
  "company", "department", "position",
  "name", "lastName", "firstName",
  "kana", "lastKana", "firstKana",
  "email", "emailConfirm", "tel", "zip", "pref", "address", "url",
  "subject", "message", "inquiryType", "agree", "ignore",
];

/** フォーム内の入力欄を列挙し、data-fsb 属性で番号を振る */
export async function extractFields(frame) {
  return frame.evaluate(() => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const ta = [...document.querySelectorAll("textarea")].find(visible);
    const root = ta?.closest("form") || document;
    const clean = (s) => (s || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    const labelOf = (el) => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return clean(l.innerText);
      }
      const wrap = el.closest("label");
      if (wrap && el.type !== "radio" && el.type !== "checkbox") return clean(wrap.innerText);
      const tr = el.closest("tr");
      const th = tr?.querySelector("th");
      if (th) return clean(th.innerText);
      const dd = el.closest("dd");
      if (dd?.previousElementSibling?.tagName === "DT") return clean(dd.previousElementSibling.innerText);
      // その欄だけを含む一番近い囲み（1行分）の文字をラベルとみなす
      let anc = el.parentElement;
      for (let i = 0; i < 5 && anc && anc !== root && anc !== document.body; i++) {
        if (anc.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) break;
        const c = anc.cloneNode(true);
        c.querySelectorAll("select, option, textarea, input, script, style").forEach((e) => e.remove());
        const t = clean(c.textContent);
        if (t) return t;
        anc = anc.parentElement;
      }
      let node = el;
      for (let i = 0; i < 4 && node; i++) {
        const prev = node.previousElementSibling;
        if (prev && clean(prev.innerText)) return clean(prev.innerText);
        node = node.parentElement;
      }
      return "";
    };
    // 「必須」バッジが入力欄と別のセルにある表（あそう自動車商会型）も必須とみなす
    const rowSaysRequired = (el) => {
      const tr = el.closest("tr");
      if (tr) return /必須/.test(tr.innerText);
      let anc = el.parentElement;
      for (let i = 0; i < 5 && anc && anc !== root; i++) {
        if (anc.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) break;
        anc = anc.parentElement;
      }
      return false;
    };
    const els = [...root.querySelectorAll("input, textarea, select")].filter((el) => {
      if (el.tagName === "INPUT" && /^(hidden|submit|button|image|reset|file|search)$/i.test(el.type)) return false;
      return el.type === "radio" || el.type === "checkbox" ? true : visible(el);
    });
    return els.map((el, idx) => {
      el.setAttribute("data-fsb", String(idx));
      const label = labelOf(el);
      const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : "";
      const own =
        el.type === "radio" || el.type === "checkbox"
          ? [el.closest("label")?.innerText, forLabel, el.nextSibling?.textContent, el.nextElementSibling?.innerText, el.value].map(clean).find(Boolean) || ""
          : "";
      return {
        idx,
        tag: el.tagName.toLowerCase(),
        type: (el.type || "").toLowerCase(),
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
        label,
        optionLabel: own,
        required: el.required || el.getAttribute("aria-required") === "true" || /必須|\*|※/.test(label) || rowSaysRequired(el),
        options: el.tagName === "SELECT" ? [...el.options].map((o) => clean(o.text)) : [],
      };
    });
  });
}

const RULES = [
  ["ignore", (f) => /画像認証|認証コード|認証文字|captcha|spam-?block|画像内の文字/i.test(f.label + f.name + f.placeholder)],
  ["agree", (f) => f.type === "checkbox" && /同意|プライバシー|個人情報|privacy|agree|確認しました|acceptance/i.test(f.label + f.optionLabel + f.name)],
  ["inquiryType", (f) => (f.tag === "select" || f.type === "radio" || f.type === "checkbox") && /種別|種類|項目|内容|区分|用件|type|category|subject/i.test(f.label + f.name)],
  ["emailConfirm", (f) => /確認|再入力|confirm|again|re_?mail|mail2|email2/i.test(f.label + f.name + f.placeholder) && /mail|メール/i.test(f.label + f.name + f.type)],
  ["email", (f) => f.type === "email" || /e-?mail|メール/i.test(f.label + f.name + f.placeholder)],
  ["lastKana", (f) => /(セイ|せい)/.test(f.label + f.placeholder) || /(last|sei).*(kana|furi)|(kana|furi).*(last|sei)/i.test(f.name)],
  ["firstKana", (f) => /(メイ|めい)/.test(f.label + f.placeholder) || /(first|mei).*(kana|furi)|(kana|furi).*(first|mei)/i.test(f.name)],
  ["kana", (f) => /フリガナ|ふりがな|カナ|かな|kana|furigana|ruby/i.test(f.label + f.name + f.placeholder)],
  ["company", (f) => /会社|企業|法人|団体|組織|社名|貴社|御社|company|corp|organization/i.test(f.label + f.name + f.placeholder) && !/部署|役職|url|サイト/i.test(f.label)],
  ["department", (f) => /部署|部門|所属|department|division/i.test(f.label + f.name)],
  ["position", (f) => /役職|position|title/i.test(f.label + f.name) && f.tag !== "textarea"],
  ["zip", (f) => /郵便|〒|zip|postal|post_?code/i.test(f.label + f.name + f.placeholder)],
  ["tel", (f) => f.type === "tel" || /電話|tel|phone/i.test(f.label + f.name + f.placeholder)],
  ["pref", (f) => /都道府県|pref/i.test(f.label + f.name)],
  ["address", (f) => /住所|所在地|address|addr/i.test(f.label + f.name + f.placeholder)],
  ["url", (f) => f.type === "url" || /url|ホームページ|ウェブサイト|website/i.test(f.label + f.name)],
  ["lastName", (f) => /^姓|姓$|（姓）|\(姓\)/.test(f.label + f.placeholder) || /last_?name|family|sei$|name_?1|name1/i.test(f.name)],
  ["firstName", (f) => /^名$|（名）|\(名\)/.test(f.label + f.placeholder) || /first_?name|given|mei$|name_?2|name2/i.test(f.name)],
  ["name", (f) => /氏名|名前|担当者|your-?name|^name$|fullname/i.test(f.label + f.name + f.placeholder)],
  ["subject", (f) => f.tag === "input" && /件名|タイトル|subject/i.test(f.label + f.name)],
  ["message", (f) => f.tag === "textarea"],
];

// ラベルはレイアウトによって隣の欄のものを拾うことがあるので、
// まず name 属性・type・placeholder だけで判定し、決まらないときにラベルを使う
const ADDRESSY = /住所|郵便|〒|fax|ファックス|ＦＡＸ/i;
const STRONG = [
  ["ignore", (f) => /captcha|quiz|spam|token|honeypot/i.test(f.name)],
  ["ignore", (f) => /fax/i.test(f.name) || /fax|ファックス|ＦＡＸ/i.test(f.label + f.placeholder)],
  ["pref", (f) => f.tag === "select" && f.options.includes("東京都") && f.options.includes("大阪府")],
  ["agree", (f) => f.type === "checkbox" && /agree|accept|privacy|consent|doui/i.test(f.name)],
  ["message", (f) => f.tag === "textarea"],
  ["emailConfirm", (f) => (f.type === "email" || /mail/i.test(f.name)) && /conf|check|again|re_?mail|mail_?2|mail2|確認/i.test(f.name + f.placeholder)],
  ["email", (f) => f.type === "email" || /e-?mail|^mail/i.test(f.name)],
  ["zip", (f) =>
    /zip|post_?code|postal|yubin/i.test(f.name) ||
    (!/address|addr|住所/i.test(f.name + f.label) && /〒|郵便|^\D{0,3}\d{3}-?\d{4}\D{0,12}$/.test(f.placeholder)) ||
    ((f.type === "tel" || f.type === "number") && /郵便|〒/.test(f.label))],
  ["tel", (f) => (f.type === "tel" && !ADDRESSY.test(f.label + f.name + f.placeholder)) || /tel|phone/i.test(f.name)],
  ["lastKana", (f) => /^(セイ|せい)$/.test(f.placeholder) || /(kana|ruby|furi).*(1|sei|last)|(1|sei|last).*(kana|ruby|furi)/i.test(f.name)],
  ["firstKana", (f) => /^(メイ|めい)$/.test(f.placeholder) || /(kana|ruby|furi).*(2|mei|first)|(2|mei|first).*(kana|ruby|furi)/i.test(f.name)],
  ["kana", (f) => /kana|ruby|furi/i.test(f.name)],
  ["zip", (f) => /zip|post_?code|postal|yubin/i.test(f.name)],
  ["pref", (f) => /pref/i.test(f.name)],
  ["company", (f) => /company|corp|kaisha|organization|会社/i.test(f.name)],
  ["lastName", (f) => /^姓$/.test(f.placeholder) || /last_?name|family_?name|^sei$|name_?1$|name\[?(sei|last)/i.test(f.name)],
  ["firstName", (f) => /^名$/.test(f.placeholder) || /first_?name|given_?name|^mei$|name_?2$|name\[?(mei|first)/i.test(f.name)],
  ["name", (f) => /^(your-?)?name$|full_?name|^namae$|contact_?name|onamae/i.test(f.name)],
  ["address", (f) => /address|addr|jusho/i.test(f.name)],
];

export function classifyByRules(fields) {
  const classes = fields.map((f) => {
    const hit = STRONG.find(([, test]) => test(f)) ?? RULES.find(([, test]) => test(f));
    return { idx: f.idx, category: hit ? hit[0] : "ignore" };
  });
  // 「姓」だけ・「セイ」だけで対になる欄がなければ、1欄にフルネームを入れる
  const has = (c) => classes.some((x) => x.category === c);
  for (const [a, b, whole] of [["lastName", "firstName", "name"], ["lastKana", "firstKana", "kana"]]) {
    if (has(a) !== has(b)) for (const x of classes) if (x.category === a || x.category === b) x.category = whole;
  }
  return classes;
}

const ClaudeResult = z.object({
  fields: z.array(z.object({ idx: z.number(), category: z.enum(CATEGORIES) })),
});

let client;
export function claudeAvailable() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function classifyByClaude(fields, model) {
  client ??= new Anthropic();
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(ClaudeResult) },
    system:
      "日本企業のWebサイトにある問い合わせフォームの入力欄を分類します。各欄が何を入力する欄かを categories から1つ選んでください。" +
      "姓と名が別欄なら lastName/firstName、フリガナが別欄なら lastKana/firstKana、1欄なら name/kana。" +
      "メールアドレス確認用の欄は emailConfirm。お問い合わせ種別の select/radio は inquiryType。プライバシーポリシー等への同意チェックは agree。" +
      "本文の textarea は message。判断できない欄や、性別・年齢・購入希望車種など営業連絡に関係ない欄は ignore。",
    messages: [{ role: "user", content: JSON.stringify(fields) }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude の分類結果を取得できませんでした");
  return response.parsed_output.fields;
}

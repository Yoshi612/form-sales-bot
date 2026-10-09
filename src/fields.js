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
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 60);
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
      let node = el;
      for (let i = 0; i < 4 && node; i++) {
        const prev = node.previousElementSibling;
        if (prev && clean(prev.innerText)) return clean(prev.innerText);
        node = node.parentElement;
      }
      return "";
    };
    const els = [...root.querySelectorAll("input, textarea, select")].filter((el) => {
      if (el.tagName === "INPUT" && /^(hidden|submit|button|image|reset|file|search)$/i.test(el.type)) return false;
      return el.type === "radio" || el.type === "checkbox" ? true : visible(el);
    });
    return els.map((el, idx) => {
      el.setAttribute("data-fsb", String(idx));
      const label = labelOf(el);
      const own = el.type === "radio" || el.type === "checkbox" ? clean(el.closest("label")?.innerText || el.nextSibling?.textContent || el.value) : "";
      return {
        idx,
        tag: el.tagName.toLowerCase(),
        type: (el.type || "").toLowerCase(),
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
        label,
        optionLabel: own,
        required: el.required || el.getAttribute("aria-required") === "true" || /必須|\*|※/.test(label),
        options: el.tagName === "SELECT" ? [...el.options].map((o) => clean(o.text)) : [],
      };
    });
  });
}

const RULES = [
  ["agree", (f) => f.type === "checkbox" && /同意|プライバシー|個人情報|privacy|agree/i.test(f.label + f.optionLabel + f.name)],
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

export function classifyByRules(fields) {
  return fields.map((f) => {
    const hit = RULES.find(([, test]) => test(f));
    return { idx: f.idx, category: hit ? hit[0] : "ignore" };
  });
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

#!/usr/bin/env node
// 担当者が「営業利用可否＝利用可」にした会社だけ、問い合わせフォームから送信する。
//
//   node src/send.js --input リスト.xlsx --only 3,4 [--output 結果.xlsx] [--dry-run]
//
// 送信の直前に、営業お断りの記載・見える認証・入力内容（担当者が確認したときと同じか）を
// もう一度確かめ、1つでも合わなければ送らずに止める。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadList, saveList, approvedFilled, writeSend } from "./excel.js";
import { findContactFormFrame } from "./findForm.js";
import { detectNoSales, detectCaptcha, cf7SendBlocked } from "./checks.js";
import { extractFields, classifyByRules } from "./fields.js";
import { fillForm } from "./fill.js";

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    config: { type: "string", default: "config.json" },
    only: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!args.input || !args.only) {
  console.error("使い方: node src/send.js --input リスト.xlsx --only 3,4 [--output 結果.xlsx] [--dry-run]");
  console.error("送信する会社を --only で必ず指定してください。");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
const settings = config.settings;
const maxPerRun = settings.maxSendPerRun ?? 10;
const dryRun = args["dry-run"];
const outPath = args.output ?? args.input;
const shotDir = path.join(path.dirname(outPath), "send_screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const list = await loadList(args.input);
const nos = new Set(args.only.split(",").map((s) => s.trim()));
const picked = list.rows.filter((r) => nos.has(String(r.no)));

// 送ってよい会社だけに絞る
const targets = [];
for (const row of picked) {
  const why =
    row.saRegistered ? `SA登録が「${row.saRegistered}」（すでに登録済みの会社には送りません）`
    : row.salesOk !== "利用可" ? `営業利用可否が「${row.salesOk || "空欄"}」（担当者がフォームを確認して「利用可」にした会社だけ送ります）`
    : row.sendStatus && row.sendStatus !== "未送信" ? `送信ステータスが「${row.sendStatus}」`
    : !row.contactUrl ? "問い合わせURLが空欄"
    : !approvedFilled(list, row.no) ? "入力内容の確認記録がない（先に自動チェックを実行してください）"
    : null;
  if (why) console.log(`No.${row.no} ${row.company} → 送りません：${why}`);
  else targets.push(row);
}
if (!dryRun && targets.length > maxPerRun) {
  console.error(`1回に送れるのは ${maxPerRun} 社までです（指定 ${targets.length} 社）。`);
  process.exit(1);
}
console.log(`\n送信対象 ${targets.length} 社${dryRun ? "（ドライラン：ボタンは押しません）" : ""}`);

// 「入力した項目」の比較用。本文は文面修正で文字数が変わるので比べない
const normalize = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/（本文/.test(l))
    .sort();

// 完了の表示。「ありがとうございます」だけは確認画面にも出るので、送信ボタンが残っていないときだけ完了とみなす
const STRONG_DONE = /送信(が)?完了|送信(いた)?しました|送信されました|受け付けました|受付(を)?完了|承りました/;
const WEAK_DONE = /ありがとうございま|thank\s*you|thanks/i;
const FAILED = /送信(が)?できませんでした|送信に失敗|エラーが発生|入力してください|必須項目を入力|最大\s*\d+\s*文字|\d+\s*文字(以内|まで)で|入力されていません|必須項目です|正しく入力|形式が正しくありません|確認してください/;
const SEND_BUTTON = /送信|確認|次へ|submit|send|confirm|next/i;
const NOT_SEND = /戻る|修正|リセット|クリア|取り消|キャンセル|back|reset|clear|cancel|検索|search/i;

// 埋め込みフォーム（iframe）の中の表示も見るため、全フレームの文字をつなげる
const pageText = async (p) =>
  (await Promise.all(p.frames().map((f) => f.evaluate(() => document.body?.innerText || "").catch(() => "")))).join("\n");
const BLOCKED = /403 Forbidden|Access Denied|アクセスが拒否|不正なアクセス|Request Rejected/i;

/** フォーム（なければページ全体）から、押してよい送信系のボタンを探す */
async function findButton(frame) {
  const handles = await frame.$$(
    'form:has(textarea) button, form:has(textarea) input[type=submit], form:has(textarea) input[type=image], form:has(textarea) [role=button], button[type=submit], input[type=submit], button, input[type=button]'
  );
  for (const h of handles) {
    // 「送 信」のように字間を空けたボタンもあるので、空白を除いて判定する
    const label = await h.evaluate((el) => (el.innerText || el.value || el.alt || el.getAttribute("aria-label") || "").replace(/\s+/g, "")).catch(() => "");
    const visible = await h.isVisible().catch(() => false);
    const enabled = await h.isEnabled().catch(() => false);
    // 「お問合せ」だけのボタンは、問い合わせフォームの中にあるときだけ送信ボタンとみなす
    const inquiryButton = /^お問い?合わ?せ(する|を送信)?$/.test(label) && (await h.evaluate((el) => !!el.closest("form")?.querySelector("textarea")).catch(() => false));
    if (visible && enabled && (SEND_BUTTON.test(label) || inquiryButton) && !NOT_SEND.test(label)) return { handle: h, label };
  }
  // 文字のない画像ボタンなど: 問い合わせフォームに送信用のボタンが1つしかなければ、それを使う
  const only = await frame.$$('form:has(textarea) input[type=submit], form:has(textarea) input[type=image], form:has(textarea) button[type=submit], form:has(textarea) button:not([type])');
  if (only.length === 1 && (await only[0].isVisible().catch(() => false)) && (await only[0].isEnabled().catch(() => false))) {
    const label = await only[0].evaluate((el) => (el.innerText || el.value || el.alt || "").replace(/\s+/g, "")).catch(() => "");
    if (!NOT_SEND.test(label)) return { handle: only[0], label: label || "（文字のないボタン）" };
  }
  return null;
}

// 押す前に見えていたボタンに印を付けておき、押したあとに新しく現れた「送信」ボタン（確認の小窓など）を探す
async function markVisibleButtons(page) {
  for (const f of page.frames())
    await f.evaluate(() => document.querySelectorAll("button, input[type=submit], input[type=button], input[type=image], [role=button]").forEach((el) => el.getClientRects().length && el.setAttribute("data-fsb-seen", "1"))).catch(() => {});
}
async function findNewSendButton(page) {
  for (const f of page.frames()) {
    for (const h of await f.$$("button:not([data-fsb-seen]), input[type=submit]:not([data-fsb-seen]), input[type=button]:not([data-fsb-seen]), input[type=image]:not([data-fsb-seen]), [role=button]:not([data-fsb-seen])")) {
      const label = await h.evaluate((el) => (el.innerText || el.value || el.alt || el.getAttribute("aria-label") || "").replace(/\s+/g, "")).catch(() => "");
      if ((await h.isVisible().catch(() => false)) && (await h.isEnabled().catch(() => false)) && /送信|send/i.test(label) && !NOT_SEND.test(label)) return { handle: h, label };
    }
  }
  return null;
}

async function clickAndWait(page, handle) {
  await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const nav = page.waitForNavigation({ timeout: 15000 }).catch(() => {});
  try {
    await handle.click({ timeout: 8000 });
  } catch (e) {
    // ほかの要素に隠れて押せなかったときだけ、同じボタンを直接押す。
    // 押したあとの画面遷移で待ちきれなかっただけの場合に押し直すと二重送信になるため、それ以外は押し直さない
    if (!/intercepts pointer events|not visible|outside of the viewport|not stable/i.test(e.message)) throw e;
    await handle.evaluate((el) => el.click());
  }
  await nav;
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ locale: "ja-JP", viewport: { width: 1280, height: 900 } });
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // 2026-10-09 の形

for (const [i, row] of targets.entries()) {
  const label = `[${i + 1}/${targets.length}] No.${row.no} ${row.company}`;
  const base = path.join(shotDir, `${String(row.no).padStart(2, "0")}_${row.company.replace(/[\\/:*?"<>|（）() ]/g, "")}`);
  const page = await context.newPage();
  // 「送信しますか？」などの確認ダイアログは OK を押す（担当者が承認した送信のため）。何もしないとキャンセル扱いになる
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message().slice(0, 60)); d.accept().catch(() => {}); });
  const res = { result: "", detail: "" };
  const clicked = []; // 押したボタン（1つでも押したあとのエラーは「結果不明」にする）
  try {
    await page.goto(row.contactUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const frame = await findContactFormFrame(page);
    if (!frame) throw Object.assign(new Error("フォームが見つからない"), { stop: true });

    // 1. 送信直前の再確認
    const noSales = (await detectNoSales(frame)) ?? (await detectNoSales(page.mainFrame()));
    if (noSales) {
      Object.assign(res, { result: "送らず（営業お断り）", detail: noSales, salesOk: "禁止", note: `送信直前に営業お断りの記載を検出:「${noSales}」` });
      throw Object.assign(new Error(res.result), { recorded: true });
    }
    const captcha = await detectCaptcha(page);
    if (captcha && !/不可視/.test(captcha)) {
      Object.assign(res, { result: "送らず（手動送信へ）", detail: `認証あり: ${captcha}`, note: `認証（${captcha}）があるため手動で送信してください` });
      throw Object.assign(new Error(res.result), { recorded: true });
    }

    // Contact Form 7 の送信窓口（wp-json）が海外からの通信を拒否するサーバー（XSERVER の国外IPアクセス制限など）では、
    // ボタンを押しても届かず結果不明になるため、押さずに手動へ回す
    const blocked = await cf7SendBlocked(frame);
    if (blocked) {
      Object.assign(res, { result: "送らず（手動送信へ）", detail: blocked, note: `${blocked}ため、自動では送れません。手動で送信してください` });
      throw Object.assign(new Error(res.result), { recorded: true });
    }

    // 2. 入力して、担当者が確認したときと同じ内容か照合
    const fields = await extractFields(frame);
    const filled = await fillForm(frame, fields, classifyByRules(fields), row, config);
    const now = normalize(filled.filled.join("\n"));
    const before = normalize(approvedFilled(list, row.no));
    const diff = [...now.filter((l) => !before.includes(l)).map((l) => "＋" + l), ...before.filter((l) => !now.includes(l)).map((l) => "－" + l)];
    if (diff.length || filled.missingRequired.length) {
      Object.assign(res, {
        result: "送らず（要確認）",
        detail: [diff.length && `確認時と入力内容が違う: ${diff.join(" / ")}`, filled.missingRequired.length && `未入力の必須: ${filled.missingRequired.join(",")}`].filter(Boolean).join(" ／ "),
        note: "確認時とフォームの状態が変わったため送信を止めました。画面を確認してください",
      });
      throw Object.assign(new Error(res.result), { recorded: true });
    }
    await frame.evaluate(() => document.querySelectorAll("textarea").forEach((t) => (t.scrollTop = 0))).catch(() => {});
    await page.screenshot({ path: `${base}_送信前.png`, fullPage: true }).catch(() => {});
    res.beforeShot = path.relative(path.dirname(outPath), `${base}_送信前.png`);
    // 担当者の確認用に、フォーム部分だけの画像も残す
    await frame.locator("form:has(textarea)").first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await frame.locator("form:has(textarea)").first().screenshot({ path: `${base}_送信前_フォーム.png`, timeout: 5000 }).catch(() => {});

    if (dryRun) {
      Object.assign(res, { result: "ドライラン（未送信）", detail: "再確認・入力まで実施。ボタンは押していません" });
      throw Object.assign(new Error(res.result), { recorded: true, dry: true });
    }

    // 3. 送信（確認画面があれば、確認画面の送信ボタンまで押す）
    const textBefore = await pageText(page);
    let prevText = textBefore;
    let done = null;
    const messageStillThere = async () =>
      (await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll("textarea")].some((t) => t.value.length > 50 && t.getClientRects().length > 0 && getComputedStyle(t).visibility !== "hidden")).catch(() => false)))).some(Boolean);
    let forcedNext = null; // 確認の小窓に新しく現れた送信ボタン
    for (let step = 0; step < 3 && !done; step++) {
      let target = forcedNext ?? (await findButton(frame).catch(() => null));
      forcedNext = null;
      for (const f of page.frames()) target ??= await findButton(f).catch(() => null);
      if (!target) break;
      const urlBefore = page.url();
      clicked.push(target.label);
      await markVisibleButtons(page);
      await clickAndWait(page, target.handle);
      const text = await pageText(page);
      const fresh = text.split("\n").filter((l) => l.trim() && !textBefore.includes(l.trim())).join("\n");
      // 確認画面で初めて出てくる認証（「私はロボットではありません」など）があれば、そこで止めて手動へ
      const laterCaptcha = await detectCaptcha(page);
      if (laterCaptcha && !/不可視/.test(laterCaptcha)) {
        Object.assign(res, { result: "送らず（手動送信へ）", detail: `押したボタン: ${clicked.join(" → ")} ／ 確認画面に認証あり: ${laterCaptcha}`, note: `確認画面に認証（${laterCaptcha}）があるため送信していません。手動で送信してください` });
        break;
      }
      if (BLOCKED.test(fresh)) {
        Object.assign(res, { result: "送信できず（サイトに拒否された）", detail: `押したボタン: ${clicked.join(" → ")} ／ 画面の表示: ${fresh.match(BLOCKED)[0]}`, note: "相手サイトが自動送信を受け付けませんでした（送信はされていません）。手動で送信してください" });
        break;
      }
      let sendLeft = null;
      for (const f of page.frames()) sendLeft ??= await findButton(f).catch(() => null);
      done = fresh.match(STRONG_DONE)?.[0] ?? (!sendLeft || !/送信|send|submit/i.test(sendLeft.label) ? fresh.match(WEAK_DONE)?.[0] : null) ?? null;
      if (done) break;
      // 押す前と画面が変わっていなければ、同じボタンを押し直さない（二重送信の防止）
      if (text === prevText) break;
      prevText = text;
      // 画面が変わらず入力も残っているなら、同じボタンをもう一度押さない（二重送信の防止）
      // ブラウザの入力チェック（書式・必須）で止まっていれば、送信されていない
      const invalid = (await Promise.all(page.frames().map((f) => f.evaluate(() => [...document.querySelectorAll("[data-fsb]")].filter((el) => el.getClientRects().length && el.willValidate && !el.checkValidity()).map((el) => `${el.name}: ${el.validationMessage}`.slice(0, 60))).catch(() => [])))).flat();
      if (invalid.length) {
        Object.assign(res, { result: "送信できず（手動送信へ）", detail: `押したボタン: ${clicked.join(" → ")} ／ 入力チェックで停止: ${invalid.join(" / ")}`, note: "ブラウザの入力チェックで止まり、送信されていません。手動で送信してください" });
        break;
      }
      // 画面が変わらず入力も残っているときは、同じボタンを押し直さない（二重送信の防止）。
      // ただし、同じページ上に確認の小窓が開き、前と違う送信ボタンが現れた場合はそれを押す
      if (page.url() === urlBefore && (await messageStillThere()) && !FAILED.test(fresh)) {
        forcedNext = await findNewSendButton(page);
        if (!forcedNext) break;
      }
      if (FAILED.test(fresh)) {
        Object.assign(res, { result: "送信できず（手動送信へ）", detail: `押したボタン: ${clicked.join(" → ")} ／ 画面の表示: ${fresh.match(FAILED)[0]}`, note: "入力エラーで送信できませんでした。手動で送信してください" });
        break;
      }
    }
    await page.screenshot({ path: `${base}_送信後.png`, fullPage: true }).catch(() => {});
    res.afterShot = path.relative(path.dirname(outPath), `${base}_送信後.png`);
    if (dialogs.length) res.detail = `${res.detail ? res.detail + " ／ " : ""}ダイアログ: ${dialogs.join(" / ")}`;

    if (done) {
      Object.assign(res, { result: "送信完了", detail: `押したボタン: ${clicked.join(" → ")} ／ 完了表示:「${done}」`, sendStatus: "送信済み", contactDate: today, note: `${today} フォームから送信（完了画面を確認）` });
    } else if (!res.result) {
      // ボタンは押したが完了表示を確認できない。二重送信を避けるため再送しない
      Object.assign(res, { result: "結果不明", detail: `押したボタン: ${clicked.join(" → ") || "なし"} ／ 完了表示を確認できず`, sendStatus: clicked.length ? "送信結果不明" : undefined, contactDate: clicked.length ? today : undefined, note: clicked.length ? "完了画面を確認できませんでした。自動では再送しません。手動で状況を確認してください" : "送信ボタンが見つかりませんでした。手動で送信してください" });
    }
  } catch (e) {
    const msg = e.message.split("\n")[0];
    if (!e.recorded && clicked.length) {
      // ボタンを押したあとのエラーは、届いたかどうか分からない。二重送信を避けるため再送しない
      await page.screenshot({ path: `${base}_送信後.png`, fullPage: true }).catch(() => {});
      Object.assign(res, { result: "結果不明", detail: `押したボタン: ${clicked.join(" → ")} ／ その後エラー: ${msg}`, sendStatus: "送信結果不明", contactDate: today, afterShot: path.relative(path.dirname(outPath), `${base}_送信後.png`), note: `ボタンを押したあとにエラー（${msg}）。届いたか分からないため自動では再送しません。手動で状況を確認してください` });
    } else if (!e.recorded) Object.assign(res, { result: "エラー（送らず）", detail: msg, note: `送信処理でエラー（${msg}）。手動で確認してください` });
  } finally {
    await page.close();
  }
  console.log(`${label} → ${res.result}${res.detail ? "：" + res.detail : ""}`);
  writeSend(list, row, res);
  await saveList(list, outPath);
  if (i < targets.length - 1) await new Promise((r) => setTimeout(r, settings.delayMs * 3));
}

await browser.close();
console.log(`\n完了: ${outPath}`);

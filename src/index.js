#!/usr/bin/env node
// 営業リスト(xlsx)の各社について、問い合わせフォームを探して入力までを行う（送信はしない）。
//
//   node src/index.js --input リスト.xlsx [--output 結果.xlsx] [--only 1,5,7] [--limit 10] [--headed]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadList, writeResult, saveList } from "./excel.js";
import { findContactPage } from "./findForm.js";
import { detectNoSales, detectCaptcha } from "./checks.js";
import { extractFields, classifyByRules, classifyByClaude, claudeAvailable } from "./fields.js";
import { fillForm } from "./fill.js";

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    config: { type: "string", default: "config.json" },
    only: { type: "string" },
    limit: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});

if (!args.input) {
  console.error("使い方: node src/index.js --input リスト.xlsx [--output 結果.xlsx] [--only 1,5] [--limit 10] [--headed]");
  process.exit(1);
}
if (!fs.existsSync(args.config)) {
  console.error(`${args.config} がありません。config.example.json をコピーして自社情報を入れてください。`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
const settings = config.settings;
const outPath = args.output ?? args.input.replace(/\.xlsx$/i, "") + "_チェック結果.xlsx";
const shotDir = path.join(path.dirname(outPath), "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const list = await loadList(args.input);
let targets = list.rows.filter((r) => !/送信済/.test(r.sendStatus));
if (args.only) {
  const nos = new Set(args.only.split(",").map((s) => s.trim()));
  targets = targets.filter((r) => nos.has(String(r.no)));
}
if (args.limit) targets = targets.slice(0, Number(args.limit));

const useClaude = settings.useClaude && claudeAvailable();
console.log(`対象 ${targets.length} 社 / 項目判定: ${useClaude ? "Claude" : "ルール"} / 送信: しない`);

const browser = await chromium.launch({
  headless: !args.headed,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const context = await browser.newContext({ locale: "ja-JP", viewport: { width: 1280, height: 900 } });

for (const [i, row] of targets.entries()) {
  const label = `[${i + 1}/${targets.length}] No.${row.no} ${row.company}`;
  const page = await context.newPage();
  const result = { pageCheck: "", salesOk: "", status: "" };
  try {
    const found = await findContactPage(page, row, settings);
    if (!found.frame) {
      result.pageCheck = "ページなし";
      result.status = found.reason;
      result.salesOk = "未確認";
      result.noteAppend = found.mailto ? `問い合わせメール: ${found.mailto}` : "問い合わせフォームを自動で見つけられず。手動確認が必要。";
      console.log(`${label} → ${result.status}`);
    } else {
      result.contactUrl = found.url;
      result.noSalesText = await detectNoSales(found.frame) ?? (found.frame !== page.mainFrame() ? await detectNoSales(page.mainFrame()) : null);
      result.captcha = await detectCaptcha(page);

      if (result.noSalesText) {
        result.pageCheck = "確認済";
        result.status = "営業お断り";
        result.salesOk = "禁止";
        result.noteAppend = `営業お断りの記載あり:「${result.noSalesText}」→ 送信対象外`;
      } else {
        const fields = await extractFields(found.frame);
        let classes;
        result.classifier = "ルール";
        if (useClaude) {
          try {
            classes = await classifyByClaude(fields, settings.claudeModel);
            result.classifier = "Claude";
          } catch (e) {
            console.warn(`  Claude 判定に失敗、ルール判定に切替: ${e.message}`);
          }
        }
        classes ??= classifyByRules(fields);
        const { filled, missingRequired, overLength } = await fillForm(found.frame, fields, classes, row, config);
        result.filled = filled;
        result.missingRequired = missingRequired;
        result.pageCheck = "確認済";
        result.status = missingRequired.length ? "入力済（必須項目に空きあり）" : overLength.length ? "入力済（文字数オーバー）" : "入力済（送信待ち）";
        // 「利用可」は人が利用規約・ページを見て判断する。自動では付けない
        result.salesOk = "未確認";
        result.noteAppend = ["営業お断りの記載は自動検出されず（送信前に目視確認）", result.captcha && `CAPTCHA: ${result.captcha}`, missingRequired.length && `未入力の必須: ${missingRequired.join(",")}`, overLength.length && `文字数オーバーで切り詰め: ${overLength.join(",")}`].filter(Boolean).join(" / ");
      }

      const shot = path.join(shotDir, `${String(row.no).padStart(2, "0")}_${row.company.replace(/[\\/:*?"<>|（）() ]/g, "")}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      result.screenshot = path.relative(path.dirname(outPath), shot);
      console.log(`${label} → ${result.status} / 営業利用可否=${result.salesOk}${result.captcha ? " / CAPTCHA " + result.captcha : ""}`);
    }
  } catch (e) {
    result.pageCheck = "未確認";
    result.status = "エラー";
    result.salesOk = "未確認";
    result.noteAppend = `自動チェックでエラー: ${e.message.split("\n")[0]}`;
    console.log(`${label} → エラー: ${e.message.split("\n")[0]}`);
  } finally {
    await page.close();
  }
  writeResult(list, row, result);
  await saveList(list, outPath); // 途中で止めても結果が残るよう毎回保存
  if (i < targets.length - 1) await new Promise((r) => setTimeout(r, settings.delayMs));
}

await browser.close();
console.log(`\n完了: ${outPath}`);

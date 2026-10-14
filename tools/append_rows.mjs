// 追加調査した会社を営業リストの末尾（No.の続き）に足す。業者マスタ照合シートにも記録する
import ExcelJS from "exceljs";
import fs from "node:fs";
const [path, jsonFile] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const ws = wb.worksheets[0];
const names = new Set();
let lastNo = 0;
ws.eachRow((r, n) => { if (n > 1 && r.getCell(2).value) { lastNo = Math.max(lastNo, Number(r.getCell(1).value) || 0); names.add(String(r.getCell(2).value).replace(/\s/g, "")); } });
const ms = wb.getWorksheet("業者マスタ照合");
const map = {};
for (const it of items) {
  if (names.has(it.company.replace(/\s/g, ""))) { console.log("既にあり:", it.company); continue; }
  const no = ++lastNo;
  map[it.tmp] = no;
  ws.addRow([no, it.company, it.area, it.business, it.scale, it.angle, it.officialUrl, it.contactUrl || null, "未確認",
    it.blocked ? "対象外" : "未確認", it.blocked ? "対象外" : "未送信", null, "未返信", null, it.sa || null, null, it.note], "i");
  for (const m of it.master) ms.addRow([no, it.company, m.区分, m.根拠, m.業者コード, m.業者名, m.住所, m.電話, m.メール, m.Smart, m.アクティブ, m.登録日時, m.最新ログイン], "i");
}
await wb.xlsx.writeFile(path);
fs.writeFileSync(jsonFile.replace(/\.json$/, "_nos.json"), JSON.stringify(map));
console.log("追加:", Object.keys(map).length, "件 / No.", Math.min(...Object.values(map)), "〜", lastNo);

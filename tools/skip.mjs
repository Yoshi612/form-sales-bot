// 担当者が「手動でも送らない」と決めた会社を「見送り」にする（今後も自動では送らない）
import { loadList, saveList } from "../src/excel.js";
const [path, date, nos] = process.argv.slice(2);
const list = await loadList(path);
for (const no of nos.split(",")) {
  const row = list.rows.find((r) => r.no === no); const r = list.ws.getRow(row.rowNumber);
  r.getCell(list.header["送信ステータス"]).value = "見送り";
  const c = r.getCell(list.header["備考"]); c.value = `${c.value || ""}\n[担当者] ${date} 手動送信はしないと判断（見送り）`; r.commit();
  console.log("見送り:", no, row.company);
}
await saveList(list, path);

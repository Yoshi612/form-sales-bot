import { loadList, writeSend, saveList } from "../src/excel.js";
const [path, date, ...nos] = process.argv.slice(2);
const list = await loadList(path);
for (const no of nos) {
  const row = list.rows.find((r) => r.no === no);
  writeSend(list, row, { sendStatus: "送信済み", contactDate: date, note: `${date} 担当者がフォームから手動で送信（担当者申告）`, result: "手動送信（担当者申告）" });
  console.log(no, row.company, "→ 送信済み");
}
await saveList(list, path);

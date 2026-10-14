// 担当者が画面を確認して承認した会社を「利用可」にする（登録あり・要確認・送信済みの会社は変えない）
import { loadList, saveList } from "../src/excel.js";
const [path, date, nos] = process.argv.slice(2);
const list = await loadList(path);
const want = new Set(nos.split(","));
for (const row of list.rows.filter((r) => want.has(r.no))) {
  if (row.saRegistered || row.sendStatus !== "未送信" || ["禁止", "対象外"].includes(row.salesOk)) { console.log("変更しない:", row.no, row.company, row.salesOk, row.sendStatus, row.saRegistered); continue; }
  const r = list.ws.getRow(row.rowNumber);
  r.getCell(list.header["営業利用可否"]).value = "利用可";
  const c = r.getCell(list.header["備考"]); c.value = `${c.value || ""}\n[承認] ${date} 担当者がフォーム画面を確認し送信を承認`;
  r.commit(); console.log("利用可:", row.no, row.company);
}
await saveList(list, path);

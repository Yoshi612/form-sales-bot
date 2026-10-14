// 画面で「届いていない」と確認できた会社を未送信に戻す（確認画面に進めず止まった・確認の小窓で止まった）
import { loadList, saveList } from "../src/excel.js";
const [path, date, spec] = process.argv.slice(2);
const list = await loadList(path);
for (const item of spec.split(";")) {
  const [no, why] = item.split("=");
  const row = list.rows.find((r) => r.no === no); const r = list.ws.getRow(row.rowNumber); const c = (k) => r.getCell(list.header[k]);
  c("送信ステータス").value = "未送信"; c("接触日").value = null;
  c("備考").value += `\n[送信] ${date} 調査: ${why}。最後の送信ボタンは押しておらず届いていないため未送信に戻した`;
  r.commit(); console.log("未送信に戻す:", no, row.company);
}
await saveList(list, path);

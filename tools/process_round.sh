#!/bin/bash
# 調査結果（1行1社の JSON = jsonl）を受け取り、重複除外 → 公式サイトから電話・メール収集 → 業者マスタ照合 まで行う
#
#   tools/process_round.sh <候補.jsonl> <作業フォルダ/接頭辞> <仮番号の開始値> <除外リスト.txt> <業者マスタ.csv>
#
# 除外リスト.txt は「社名 | 地域 | ドメイン」を1行ずつ（営業リストにある会社）。tools/export_existing.py で作れる
set -e
cd "$(dirname "$0")/.."
IN=$1; P=$2; BASE=$3; EX=$4; MASTER=$5
python3 - "$IN" "$P" "$BASE" "$EX" <<'PY'
import json, sys
from urllib.parse import urlparse
inp, p, base, ex = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
exl = [l.split(" | ") for l in open(ex) if " | " in l]
exdom = {e[2].strip().removeprefix("www.") for e in exl if len(e) > 2 and e[2].strip()}
exname = {e[0].strip().replace(" ", "") for e in exl}
a = [json.loads(l) for l in open(inp) if l.strip()]
keep = []
for i, x in enumerate(a):
    d = {urlparse(u).netloc.removeprefix("www.") for u in (x.get("officialUrl", ""), x.get("contactUrl", "")) if u}
    if d & exdom or x["name"].replace(" ", "") in exname: print("重複で除外:", x["name"]); continue
    x["no"] = base + i; keep.append(x)
json.dump(keep, open(f"{p}.json", "w"), ensure_ascii=False, indent=1)
print(len(keep), "社を処理")
PY
node tools/site_contacts.mjs $P.json ${P}_sites.json
python3 -c "
import json,re
d=json.load(open('${P}_sites.json'))
for x in d: x['mails']=[m for m in x['mails'] if not re.search(r'\.(png|jpe?g|gif|webp|svg)$',m)]
json.dump(d,open('${P}_sites.json','w'),ensure_ascii=False,indent=1)"
ALIAS=""; [ -f ${P}_alias.json ] && ALIAS="--alias ${P}_alias.json"
python3 tools/match_master.py --master "$MASTER" --sites ${P}_sites.json --out ${P}_match.json $ALIAS > ${P}_照合結果.txt
echo "照合結果: ${P}_照合結果.txt"

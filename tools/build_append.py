"""照合結果と判断（decide.json）から、営業リストに足す行（append.json）を作る"""
import json, sys
sites_f, match_f, dec_f, drop_f, out_f = sys.argv[1:6]
sites = {str(x['no']): x for x in json.load(open(sites_f))}
m = json.load(open(match_f)); dec = json.load(open(dec_f)); drop = json.load(open(drop_f)) if drop_f != "-" else {}
weak = {}
for r in m:
    k = str(r['no'])
    if k not in dec: weak.setdefault(k, []).append(f"{r['業者名']}（{r['住所'][:8]}）")
out = []
for k, s in sites.items():
    if k in drop: continue
    d = dec.get(k)
    mrows = [r for r in m if str(r['no']) == k and d and r['業者コード'] in d[2]]
    note = "[追加] 2026-10-13 Claudeが追加調査（公式サイトの検索結果をもとに作成。規模・事業内容は送信前に画面で確認）"
    if s.get('note'): note += f"\n[調査メモ] {s['note']}"
    if d:
        sa = ("登録あり：" if d[0].startswith("登録あり") else "要確認：") + " / ".join(f"{r['業者コード']} {r['業者名']}" for r in mrows)
        note += f"\n[照合] 業者マスタ（2026-10-09）: {d[0]}／{d[1]}"
    else:
        sa = ""
        note += "\n[照合] 業者マスタ（2026-10-09）: 該当なし（電話・メール・社名で照合）"
        if k in weak: note += "。名前の一部が似た別業者あり（" + "、".join(weak[k][:3]) + "）だが社名・電話・地域が違うため別会社と判断"
    out.append(dict(tmp=k, company=s['name'], area=s['area'], business=s.get('business', ''), scale=s.get('scale', ''), angle=s.get('angle', ''),
        officialUrl=s.get('officialUrl', ''), contactUrl=s.get('contactUrl', ''), blocked=bool(d), sa=sa, note=note,
        master=[dict(区分=d[0], 根拠=d[1], **{k2: r[k2] for k2 in ['業者コード', '業者名', '住所', '電話', 'メール', 'Smart', 'アクティブ', '登録日時', '最新ログイン']}) for r in mrows] if d else []))
json.dump(out, open(out_f, 'w'), ensure_ascii=False, indent=1)
print(len(out), "件（うち送信しない", sum(o['blocked'] for o in out), "件）")

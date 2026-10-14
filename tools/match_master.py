"""営業候補を業者マスタ（SA登録業者のCSV）と照合する。

  python3 tools/match_master.py --master 業者マスタ.csv --sites 候補_sites.json --out 照合結果.json [--alias 別名.json]

- 厳しめの照合: 電話・FAX番号、メールのドメイン/アドレス、社名（同じ地域）、別名（ブランド名）
- ゆるめの照合: 社名の一部（地域を問わない）、電話の下8桁、メールのドメインの一部
結果は「厳しめ」を JSON に、両方を画面に出す。どの会社を送らないかは、画面の結果を見て人が決める。
業者マスタは個人情報を含むので、リポジトリには入れないこと。
"""
import pandas as pd, json, re, unicodedata, sys, argparse
from difflib import SequenceMatcher

ap = argparse.ArgumentParser()
ap.add_argument("--master", required=True); ap.add_argument("--sites", required=True)
ap.add_argument("--out", required=True); ap.add_argument("--alias")
a = ap.parse_args()
df = pd.read_csv(a.master, encoding="cp932", dtype=str).fillna("")
sites = json.load(open(a.sites))
ALIAS = json.load(open(a.alias)) if a.alias else {}
def norm(s):
    s = unicodedata.normalize("NFKC", str(s)).lower()
    s = re.sub(r"[（(][^）)]*[）)]", "", s)  # 括弧の注記を除く
    s = re.sub(r"株式会社|有限会社|合同会社|合資会社|一般社団法人|\(株\)|\(有\)|㈱|㈲|co\.?,?\s*ltd\.?|inc\.?|llc|グループ|ホールディングス|holdings", "", s)
    return re.sub(r"[\s・.,&＆'’\-‐ー_/]", "", s)
def digits(s): return re.sub(r"\D", "", str(s))
FREE = re.compile(r"gmail|yahoo|outlook|hotmail|icloud|docomo|ezweb|au\.com|softbank|i\.softbank|nifty|biglobe|ocn\.ne|so-net|plala|live\.|me\.com|aol|excite|goo\.jp|infoseek")
PREFS = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split()
KANTO = {"茨城","栃木","群馬","埼玉","千葉","東京","神奈川"}
def prefs_of(area):
    p = {x for x in PREFS if x in str(area)}
    if "関東" in str(area): p |= KANTO
    return p
df["core"] = df["業者名"].map(norm)
df["tel"] = df["電話番号"].map(digits); df["fax"] = df["FAX番号"].map(digits)
df["mail"] = df["メールアドレス"].str.lower().str.strip()
df["mdom"] = df["mail"].str.split("@").str[-1]
df["pref"] = df["住所"].map(lambda a: next((x for x in PREFS if str(a).startswith(x)), ""))

# 会社ごとの追加の呼び名（サイト・ブランド名）

results = []
for s in sites:
    no = str(s["no"]); core = norm(s["name"]); area = prefs_of(s["area"])
    sdoms = {s["domain"]} | {m.split("@")[1] for m in s["mails"] if "@" in m and "example" not in m and re.search(r"\.(jp|com|net|co)", m)}
    sdoms = {d.removeprefix("www.") for d in sdoms if d and not FREE.search(d)}
    smails = {m for m in s["mails"] if "example" not in m}
    hits = {}
    def add(i, why, level):
        cur = hits.get(i)
        if not cur or level > cur[1]: hits[i] = [why, level]
        elif why not in cur[0]: cur[0] += " / " + why
    for i, t in df.iterrows():
        tel_hit = bool(set(s["phones"]) & ({t.tel, t.fax} - {"", "0000000000", "00000000000", "0123456789"}))
        dom_hit = t.mdom and not FREE.search(t.mdom) and any(t.mdom == d or t.mdom.endswith("." + d) or d.endswith("." + t.mdom) for d in sdoms)
        mail_hit = t.mail and t.mail in smails
        same_pref = t.pref in area if area else False
        if tel_hit: add(i, "電話/FAX番号が一致", 3)
        if dom_hit or mail_hit: add(i, "メールのドメイン/アドレスが一致", 3)
        if t.core and core and t.core == core:
            add(i, "社名が一致" + ("（同じ地域）" if same_pref else "（地域は違う）"), 3 if same_pref else 1)
        elif t.core and core and len(core) >= 4 and (core in t.core or (len(t.core) >= 4 and t.core in core)) and same_pref:
            add(i, "社名の一部が一致（同じ地域）", 2)
        elif t.core and core and len(core) >= 3 and same_pref and SequenceMatcher(None, core, t.core).ratio() >= 0.8:
            add(i, "社名が似ている（同じ地域）", 2)
        for a in ALIAS.get(no, []):
            if t.core and (t.core == norm(a) or (len(norm(a)) >= 3 and norm(a) in t.core)) and (same_pref or not area):
                add(i, f"ブランド名「{a}」を含む（同じ地域）", 2)
    for i, (why, level) in hits.items():
        t = df.loc[i]
        results.append(dict(no=int(no), 社名=s["name"], 地域=s["area"], 判定=level, 理由=why, 業者コード=t["業者コード"], 業者名=t["業者名"], 住所=t["住所"],
                            電話=t["tel"], メール=t["mail"], Smart=t["Smart"], アクティブ=t["アクティブ状況"], 登録日時=t["登録日時"], 最新ログイン=t["ログイン日時"], 取引停止=t["取引停止"], 反社会的=t["反社会的"], 重大トラブル=t["重大トラブル"]))
r = pd.DataFrame(results)
if len(r): r = r.sort_values(["no", "判定"], ascending=[True, False])
r.to_json(a.out, force_ascii=False, orient="records", indent=1)
for no, g in (r.groupby("no") if len(r) else []):
    print(f"\n## No.{no} {g.iloc[0]['社名']}（{g.iloc[0]['地域']}）")
    for _, x in g.head(6).iterrows():
        print(f"  [{x.判定}] {x.業者コード} {x.業者名} | {x.住所[:22]} | {x.理由} | Smart{x.Smart} {x.アクティブ}")
print("\nヒットなし:", sorted(set(int(s['no']) for s in sites) - set(r.no if len(r) else [])))


# ---- ゆるめの照合 ----
print("\n==== ゆるめの照合（地域を問わない社名の一部・電話の下8桁・ドメインの一部） ====")
out = []
for s in sites:
    s.setdefault("listno", s["no"])
    core = norm(s["name"]); doms = {s["domain"]}
    fu = s.get("contactUrl", "")
    if fu: doms.add(re.sub(r"^www\.", "", fu.split("/")[2]))
    tails = {p[-8:] for p in s["phones"] if len(p) >= 10 and len(set(p[-8:])) > 2}  # 0000000000 などの仮の番号は使わない
    hits = []
    for _, t in df.iterrows():
        why = []
        if tails & ({t.tel[-8:], t.fax[-8:]} - {"", "00000000"}): why.append("電話の下8桁が一致")
        if t.mdom and not FREE.search(t.mdom) and any(d.split(".")[0] in t.mdom for d in doms if len(d.split(".")[0]) >= 4): why.append("メールのドメインが似ている")
        if t.core and len(core) >= 3 and (core in t.core or (len(t.core) >= 3 and t.core in core)): why.append("社名の一部が一致（地域問わず）")
        elif t.core and len(core) >= 3 and SequenceMatcher(None, core, t.core).ratio() >= 0.85: why.append("社名がほぼ同じ（地域問わず）")
        if why: hits.append(f"{t['業者コード']} {t['業者名']}｜{t['住所'][:14]}｜{'・'.join(why)}")
    out.append((s["listno"], s["name"], hits))
for no, name, hits in sorted(out):
    print(f"No.{no} {name}: {len(hits)}件")
    for h in hits[:8]: print("   ", h)

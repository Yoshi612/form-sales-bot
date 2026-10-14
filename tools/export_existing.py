"""営業リストにある会社を「社名 | 地域 | ドメイン」の形で書き出す（新しい候補の重複チェック用）

  python3 tools/export_existing.py <営業リスト.xlsx> <出力.txt>
"""
import sys, openpyxl
from urllib.parse import urlparse
wb = openpyxl.load_workbook(sys.argv[1])
rows = [r for r in wb.worksheets[0].iter_rows(min_row=2, values_only=True) if r[1]]
open(sys.argv[2], "w").write("\n".join(f"{r[1]} | {r[2]} | {urlparse(str(r[6] or r[7] or '')).netloc}" for r in rows) + "\n")
print(len(rows), "社を書き出し")

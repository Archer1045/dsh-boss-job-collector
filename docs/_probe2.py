import re
import pathlib

root = pathlib.Path(r"D:\workSpace\code\「北京招聘」-2026年北京人才招聘信息 - BOSS直聘_files")

print("--- 所有 CSS 里的 unicode-range ---")
for f in root.glob("*.css"):
    s = f.read_text(encoding="utf-8", errors="ignore")
    ur = re.findall(r"unicode-range\s*:\s*([^;}]+)", s)
    if ur:
        print(f.name, "->", ur[:4])

print()
print("--- 所有 CSS 里的 font-family 取值（去重） ---")
names = set()
for f in root.glob("*.css"):
    s = f.read_text(encoding="utf-8", errors="ignore")
    for m in re.findall(r"font-family\s*:\s*([^;}]{1,120})", s):
        names.add(m.strip()[:100])
for n in sorted(names):
    print(n)

print()
print("--- 所有 CSS 里的 src: url(...) ---")
for f in root.glob("*.css"):
    s = f.read_text(encoding="utf-8", errors="ignore")
    for m in re.findall(r"src\s*:\s*url\(([^)]{1,200})\)", s):
        print(f.name, "->", m[:160])

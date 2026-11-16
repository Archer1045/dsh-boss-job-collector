import re
import pathlib

p = pathlib.Path(r"D:\workSpace\code\「北京招聘」-2026年北京人才招聘信息 - BOSS直聘.html")
t = p.read_text(encoding="utf-8", errors="replace")

print("--- 含 salary 的 JSON 键或属性 ---")
pat = re.compile(r"[\"']?(salary|salaryDesc|jobSalary)[\"']?\s*[:=]\s*([^,}\n]{0,60})")
for m in list(pat.finditer(t))[:10]:
    print(repr(m.group(0)[:100]))

print()
print("--- window.__ 初始化数据 ---")
for m in list(re.finditer(r"window\.__[A-Za-z_]+__\s*=", t))[:5]:
    print(m.group(0), "at", m.start())

print()
print("--- script 标签数量 ---")
print(len(re.findall(r"<script", t)))

print()
print("--- job-salary 的属性形态 ---")
for m in list(re.finditer(r"<span[^>]*class=\"job-salary\"[^>]*>", t))[:3]:
    print(m.group(0))

print()
print("--- job-name 的属性形态 ---")
for m in list(re.finditer(r"<a[^>]*class=\"job-name\"[^>]*>", t))[:2]:
    print(m.group(0))

print()
print("--- 页面上是否出现明文 K 的薪资（如 20-30K） ---")
for m in list(re.finditer(r">(\d{1,2}-\d{1,2}K[^<]{0,10})<", t))[:5]:
    print(repr(m.group(1)))

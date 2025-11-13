from pathlib import Path
text = Path('3D planning.html').read_text(encoding='utf-8')
needle = "function dmsToDec"
start = text.find(needle)
if start == -1:
    raise SystemExit('start not found')
end_marker = "/* ===== Plan dims"
end = text.find(end_marker, start)
if end == -1:
    raise SystemExit('end marker not found')
old_block = text[start:end]
replacement = "function dmsToDec(d,m,s,h){var v=Math.abs(d)+(m or 0)/60+(s or 0)/3600; if(/[SW]/i.test(h)) v=-v; return v}\n"

from pathlib import Path
text = Path('README.md').read_text(encoding='latin-1')
idx = text.index('"radiusMiles": 15')
segment = text[idx-40:idx+120]
print(segment.encode('unicode_escape').decode('ascii'))

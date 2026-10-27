from pathlib import Path
import re, subprocess, tempfile
root=Path(__file__).resolve().parent.parent
for page in root.glob('*.html'):
    text=page.read_text()
    ids=re.findall(r'\bid="([^"]+)"',text)
    assert len(ids)==len(set(ids)),f'duplicate IDs: {page.name}'
    for ref in re.findall(r'(?:href|src)="([^"#]+)"',text):
        if ref.startswith(('https:','http:','data:','mailto:')): continue
        target=ref.split('#')[0].split('?')[0]
        if target: assert (root/target).exists(),f'{page.name}: missing {ref}'
    for script in re.findall(r'<script[^>]*>(.*?)</script>',text,re.S):
        if not script.strip(): continue
        with tempfile.NamedTemporaryFile(suffix='.mjs',mode='w') as file:
            file.write(script);file.flush()
            subprocess.run(['node','--check',file.name],check=True,capture_output=True)
    print(f'{page.name}: local links, unique IDs, JavaScript syntax OK')
for module in root.glob('*.mjs'):
    subprocess.run(['node','--check',str(module)],check=True,capture_output=True)
print('Local JavaScript modules: syntax OK')

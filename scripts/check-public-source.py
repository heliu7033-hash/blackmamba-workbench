"""Check only tracked source paths; never inspect or print untracked user data."""
import pathlib,re,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().strip('\0').split('\0')
blocked={'data','build','local-dist','dist','node_modules','out','.openai','.codex','.sites-runtime','__pycache__'}
patterns={
 'private key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'GitHub token':r'\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b',
 'service key':r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b',
 'AWS credential':r'\bAKIA[A-Z0-9]{16}\b',
 'personal Mac path':r'/Users/(?!Shared(?:/|\b)|<|\$)[A-Za-z0-9_.-]+/',
}
errors=[]
for name in files:
 if not name:continue
 p=pathlib.PurePosixPath(name)
 if set(p.parts)&blocked or p.name.startswith('.env') and p.name!='.env.example' or p.suffix.lower() in {'.db','.sqlite','.pem','.key','.p12','.pfx','.log','.png','.jpg','.jpeg','.icns','.mp4','.mov','.wav','.mp3','.zip'}:
  errors.append((name,'runtime, credential, or media path'));continue
 f=root/name
 if f.is_symlink():errors.append((name,'symlink'));continue
 try:text=f.read_text()
 except UnicodeDecodeError:errors.append((name,'non-text source'));continue
 for label,pattern in patterns.items():
  if re.search(pattern,text):errors.append((name,label))
for name,reason in errors:print(f'BLOCKED {name}: {reason}')
if errors:sys.exit(1)
print(f'PASS: {len(files)} tracked paths checked; no blocked runtime/media paths or known credential patterns')

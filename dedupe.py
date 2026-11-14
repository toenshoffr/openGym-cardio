import re,subprocess,glob,os
KEY=re.compile(r'^\s*("(?:[^"\\]|\\.)*")\s*:')
removed=0;changed=0
for f in sorted(glob.glob('src/locales/*.js')):
    name=os.path.basename(f)
    try: cardio=subprocess.run(['git','show','origin/feature/cardio:frontend/src/locales/'+name],capture_output=True,text=True,check=True).stdout.split('\n')
    except Exception: continue
    mc=next((i for i,l in enumerate(cardio) if '--- Cardio (runs and rides) ---' in l),None)
    if mc is None: continue
    # block runs to the closing brace of the file
    end=max(i for i,l in enumerate(cardio) if l.startswith('}'))
    L=end-mc
    lines=open(f).read().split('\n')
    M=next(i for i,l in enumerate(lines) if '--- Cardio (runs and rides) ---' in l)
    cnt={}
    for l in lines:
        m=KEY.match(l)
        if m: cnt[m.group(1)]=cnt.get(m.group(1),0)+1
    out=[];r=0
    for i,l in enumerate(lines):
        m=KEY.match(l)
        if M<=i<M+L and m and cnt[m.group(1)]>1:
            r+=1;continue
        out.append(l)
    if r:
        open(f,'w').write('\n'.join(out));removed+=r;changed+=1
print('entfernt',removed,'Zeilen in',changed,'Dateien')

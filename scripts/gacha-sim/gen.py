#!/usr/bin/env python3
"""Build gacha-sim data.json (+ optional portrait images).
usage: gen.py <srcdir with gacha.json char.json cn.json> <outdata.json> [<image outdir>]
"""
import json, sys, os, datetime as dt, re, urllib.request, io

here = os.path.dirname(os.path.abspath(__file__))
src, outjson = sys.argv[1], sys.argv[2]
imgdir = sys.argv[3] if len(sys.argv) > 3 else None

en = json.load(open(f'{src}/char.json'))
cn = json.load(open(f'{src}/cn.json'))
gacha_all = json.load(open(f'{src}/gacha.json'))
gacha = gacha_all['gachaPoolClient']

CLS = {'PIONEER': 'Vanguard', 'WARRIOR': 'Guard', 'TANK': 'Defender', 'SNIPER': 'Sniper',
       'CASTER': 'Caster', 'MEDIC': 'Medic', 'SUPPORT': 'Supporter', 'SPECIAL': 'Specialist'}
RAR = {'TIER_3': 3, 'TIER_4': 4, 'TIER_5': 5, 'TIER_6': 6}

# Operators newer than the EN data mirror: wiki name -> CN character id (rarity/class come from the CN table)
MANUAL = {
 'Bellone': 'char_4037_demetr', 'Cairn': 'char_4214_cairn', "Ch'en the Dawnstreak": 'char_1050_chen3',
 'Haruka': 'char_4202_haruka', 'Hoshiguma the Breacher': 'char_1044_hsgma2', 'Kichisei': 'char_4203_kichi',
 'Leizi the Thunderbringer': 'char_1043_leizi2', 'Mantra': 'char_4204_mantra', 'Mutsumi Wakaba': 'char_4183_mortis',
 'Nasti': 'char_4212_nasti', 'Perfumer the Distilled': 'char_1022_flwr2', 'Pramanix the Prerita': 'char_1046_sbell2',
 'Record Keeper': 'char_4196_reckpr', 'Ripresa': 'char_4031_liesel', 'Sakiko Togawa': 'char_4182_oblvns',
 'SilverAsh the Reignfrost': 'char_1045_svash2', 'Snegurochka': 'char_4208_wintim', 'Snow Hunter': 'char_4211_snhunt',
 'Taraxacum': 'char_4222_taraxa', 'Titi': 'char_4056_titi', 'Uika Misumi': 'char_4184_dolris',
 'Ukusik': 'char_4224_turdus', 'Vetochki': 'char_4207_branch', 'Wang': 'char_2027_wang',
 'Zima the Raging Tide': 'char_1051_headb2',
}

ops = {}      # id -> dict(n, r, c)
byname = {}
for k, v in en.items():
    if k.startswith('char_'):
        byname.setdefault(v['name'].lower(), k)
for name, cid in MANUAL.items():
    v = cn[cid]
    assert v['rarity'] in RAR and v['profession'] in CLS, (name, cid)
    byname[name.lower()] = cid


def info(cid):
    v = en.get(cid) or cn[cid]
    return v


def add(cid, name=None):
    v = info(cid)
    ops[cid] = {'n': name or v['name'], 'r': RAR[v['rarity']], 'c': CLS[v['profession']]}


# ---------- banners
rows = [l.rstrip('\n').split('|') for l in open(f'{here}/banners.txt') if l.strip() and l[0] != '#']
release = {}
for l in open(f'{here}/release.txt'):
    n, d, lim = l.strip().split('|')
    release[n.lower()] = (d, lim == 'Y')

# game-data limited ops
limited = set()
gamepool = {}
for x in gacha:
    lp = x.get('limitParam')
    if lp and lp.get('limitedCharId'):
        limited.add(lp['limitedCharId'])
    s = dt.datetime.fromtimestamp(x['openTime'], dt.timezone.utc).date()
    gamepool.setdefault(s, []).append(x)

first_seen = {}
banners = []
for t, name, s, e, oplist in rows:
    ids = []
    for o in [x.strip() for x in oplist.split(', ')]:
        cid = byname[o.lower()]
        add(cid, o if cid in MANUAL.values() else None)
        ids.append(cid)
        first_seen[cid] = min(first_seen.get(cid, s), s)
    b = {'id': re.sub(r'[^a-z0-9]+', '-', f'{s}-{name}'.lower()).strip('-'), 'name': name, 'type': t,
         'start': s, 'end': e, 'ops': ids}
    # tie to game data
    sd = dt.date.fromisoformat(s)
    gp = None
    for d in (0, -1, 1):
        for x in gamepool.get(sd + dt.timedelta(days=d), []):
            if x['gachaPoolId'].startswith(('NORM', 'SINGLE', 'LIMITED', 'LINKAGE')) and not x['gachaPoolName'].startswith(('Joint', 'Rare')):
                gp = gp or x
    # Focused Selection (150-pull rate-up guarantee) applies to Limited-Time banners from "As In My Adumbration" on
    b['focused'] = (t == 'lt' and s >= '2023-10-24')
    if gp:
        assert b['focused'] == (gp.get('guaranteeName') == 'Focused Selection'), name
    if t == 'link':
        b['guarantee'] = (gp or {}).get('linkageParam', {}) and (gp['linkageParam'] or {}).get('guaranteeTarget6Count') or 120
    banners.append(b)

# ---------- limited ops from release page
for n, (d, lim) in release.items():
    if lim and n in byname:
        limited.add(byname[n])
for b in banners:
    if b['type'] == 'link':
        for cid in b['ops']:
            limited.add(cid)

# ---------- full pool candidates
for k, v in en.items():
    if not k.startswith('char_') or v['rarity'] not in RAR or v.get('isNotObtainable'):
        continue
    if 'Headhunting' in (v.get('itemObtainApproach') or ''):
        add(k)

# ---------- availability date
known = {}
# operators in the very first (Starter) pool are available from launch
boot = gacha_all['newbeeGachaPoolClient'][0]['gachaPoolDetail']
for line in boot.split('\n'):
    if '/' in line and not line.startswith('<'):
        for n in line.split(' / '):
            cid = byname.get(n.strip().lower())
            if cid:
                known[cid] = '2020-01-16'
for cid, d in first_seen.items():
    known[cid] = min(known.get(cid, d), d)
for l in open(f'{here}/stdpools.txt'):
    d, names = l.strip().split('|')
    for n in names.split(', '):
        cid = byname.get(n.lower())
        if cid:
            known[cid] = min(known.get(cid, d), d)
for n, (d, lim) in release.items():
    cid = byname.get(n)
    if cid:
        known[cid] = min(known.get(cid, d), d)


def num(cid):
    return int(cid.split('_')[1])


avail = {}
LAUNCH = '2020-01-16'
for cid in ops:
    if cid in known:
        avail[cid] = known[cid]
for cid in sorted(ops, key=lambda c: (num(c) // 1000, num(c))):
    if cid in avail:
        continue
    n = num(cid)
    if n <= 300:
        avail[cid] = LAUNCH
    else:
        series = n // 1000
        prior = [avail[c] for c in avail if num(c) // 1000 == series and num(c) < n]
        avail[cid] = max(prior) if prior else LAUNCH
for cid, o in ops.items():
    o['a'] = avail[cid]
    o['l'] = 1 if cid in limited else 0
    appr = (en.get(cid) or cn[cid]).get('itemObtainApproach') or ''
    o['p'] = 1 if ('Headhunting' in appr or '招募寻访' in appr) else 0

# ---------- sanity: rate-up ops must be listed with right availability
for b in banners:
    for cid in b['ops']:
        assert ops[cid]['a'] <= b['start'], (b['name'], cid, ops[cid]['a'])

# ---------- split ops per rarity; limited banners: primary 6* guess
for b in banners:
    b['up6'] = [c for c in b['ops'] if ops[c]['r'] == 6]
    b['up5'] = [c for c in b['ops'] if ops[c]['r'] == 5]
    b['up4'] = [c for c in b['ops'] if ops[c]['r'] == 4]
    del b['ops']
    if b['type'] == 'lim':
        lim6 = [c for c in b['up6'] if ops[c]['l'] and first_seen[c] == b['start']]
        new6 = [c for c in b['up6'] if first_seen[c] == b['start']]
        b['primary'] = new6
        b['limited6'] = lim6

json.dump({'banners': banners, 'ops': ops}, open(outjson, 'w'), ensure_ascii=False, separators=(',', ':'))

print('banners', len(banners), 'ops', len(ops))
for b in banners:
    if b['type'] == 'lim':
        print(b['name'], '| primary:', [ops[c]['n'] for c in b['primary']], '| limited:', [ops[c]['n'] for c in b['limited6']], '| up6:', [ops[c]['n'] for c in b['up6']])
    elif not b['up6'] or b['type'] == 'link':
        print(b['type'], b['name'], 'up6', [ops[c]['n'] for c in b['up6']], 'up5', [ops[c]['n'] for c in b['up5']], b.get('guarantee'))

# ---------- images
if imgdir:
    from PIL import Image
    os.makedirs(imgdir, exist_ok=True)
    base = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/'
    miss = []
    for cid in ops:
        out = f'{imgdir}/{cid}.webp'
        if os.path.exists(out):
            continue
        im = None
        for rel in (f'portrait/{cid}_1.png', f'portrait/{cid}_2.png', f'portrait/{cid}.png'):
            try:
                data = urllib.request.urlopen(base + rel, timeout=30).read()
                im = Image.open(io.BytesIO(data)).convert('RGBA')
                break
            except Exception:
                continue
        if im is None:
            try:
                data = urllib.request.urlopen(base + f'avatar/{cid}.png', timeout=30).read()
                im = Image.open(io.BytesIO(data)).convert('RGBA')
                miss.append(cid + ' (avatar only)')
            except Exception:
                miss.append(cid)
                continue
        w, h = im.size
        im = im.resize((110, int(110 * h / w)), Image.LANCZOS)
        im.save(out, 'WEBP', quality=72, method=6)
    print('image problems:', miss)

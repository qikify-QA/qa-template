#!/usr/bin/env python3
"""Ghi mốc thời gian theo từng bước QA của một issue, và tổng hợp thời gian trung bình.

Mỗi issue một file runs/<KEY>/timeline.jsonl, chỉ ghi nối thêm (an toàn khi chạy song song).

  python3 scripts/issue_timing.py start <KEY> <phase> [--note ...] [--at ISO]
  python3 scripts/issue_timing.py end   <KEY> <phase> [--note ...] [--at ISO]
  python3 scripts/issue_timing.py wait-start <KEY> <reason> [--note ...] [--at ISO]
  python3 scripts/issue_timing.py wait-end   <KEY> <reason> [--note ...] [--at ISO]
  python3 scripts/issue_timing.py show <KEY>
  python3 scripts/issue_timing.py report [KEY ...] [--all]

Bước làm (phase): analysis, testcase, data, preflight, execute, report
Lý do chờ (reason): po-dev-reply, user-action, deploy, render-review, staging-job
Một bước làm lại nhiều lần (vd execute bổ sung sau khi PO trả lời) → nhiều cặp start/end, cộng dồn.
Thời gian chờ có thể chồng lên thời gian làm (Gate 1 không chặn case độc lập), nên báo riêng.
--at dùng khi mốc thật xảy ra trước lúc ghi (vd "Dev trả lời lúc 14:05"): 2026-11-01T14:05 (giờ máy).
"""
import argparse, json, os, statistics, sys
from datetime import datetime, timezone


def load_env():
    """Nạp .env ở gốc repo. Biến đã đặt trong shell được giữ nguyên."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')) as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        k, sep, v = line.strip().partition('=')
        if not sep or k.startswith('#'):
            continue
        v = v.strip()
        if v and v[0] in '"\'' and v[0] in v[1:]:
            v = v[1:v.index(v[0], 1)]
        else:
            v = v.split(' #')[0].strip()
        os.environ.setdefault(k.strip(), v)


load_env()
ROOT = os.environ.get('QA_TIMING_ROOT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runs')
PHASES = ['analysis', 'testcase', 'data', 'preflight', 'execute', 'report']
WAITS = ['po-dev-reply', 'user-action', 'deploy', 'render-review', 'staging-job']


def parse_at(s):
    if not s:
        return datetime.now(timezone.utc).astimezone()
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.astimezone()


def path(key):
    return os.path.join(ROOT, key, 'timeline.jsonl')


def load(key):
    try:
        with open(path(key)) as f:
            return [json.loads(l) for l in f if l.strip()]
    except FileNotFoundError:
        return []


def append(key, ev):
    os.makedirs(os.path.dirname(path(key)), exist_ok=True)
    with open(path(key), 'a') as f:
        f.write(json.dumps(ev, ensure_ascii=False) + '\n')


def intervals(events):
    """-> {('work'|'wait', name): [(start, end|None, note)]}"""
    open_, out = {}, {}
    for e in sorted(events, key=lambda e: e['at']):
        k = (e['kind'], e['name'])
        t = datetime.fromisoformat(e['at'])
        if e['edge'] == 'start':
            if k in open_:  # start lặp mà chưa end: đóng cái cũ tại mốc này
                out.setdefault(k, []).append((open_[k][0], t, open_[k][1] + ' (đóng tự động)'))
            open_[k] = (t, e.get('note', ''))
        elif k in open_:
            s, note = open_.pop(k)
            out.setdefault(k, []).append((s, t, ' / '.join(x for x in (note, e.get('note', '')) if x)))
    for k, (s, note) in open_.items():
        out.setdefault(k, []).append((s, None, note))
    return out


def secs(iv):
    return sum((e - s).total_seconds() for s, e, _ in iv if e)


def fmt(sec):
    if sec is None:
        return '—'
    m = round(sec / 60)
    return f'{m // 60}h{m % 60:02d}' if m >= 60 else f'{m}m'


def mark(a, kind, edge):
    names = PHASES if kind == 'work' else WAITS
    if a.name not in names:
        sys.exit(f'{a.name} không hợp lệ. Chọn: {", ".join(names)}')
    at = parse_at(a.at)
    if edge == 'end' and not any(e['kind'] == kind and e['name'] == a.name and e['edge'] == 'start' for e in load(a.key)):
        sys.exit(f'{a.key}: chưa có mốc start cho {a.name}')
    append(a.key, {'kind': kind, 'name': a.name, 'edge': edge, 'at': at.isoformat(timespec='seconds'),
                   'note': a.note or '', 'recorded': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')})
    print(f'OK {a.key} {kind}:{a.name} {edge} @ {at:%Y-%m-%d %H:%M}')


def summarize(key):
    ev = load(key)
    if not ev:
        return None
    iv = intervals(ev)
    times = [datetime.fromisoformat(e['at']) for e in ev]
    done = any(e['kind'] == 'work' and e['name'] == 'report' and e['edge'] == 'end' for e in ev)
    return {'key': key, 'iv': iv, 'first': min(times), 'last': max(times), 'done': done,
            'work': {p: secs(iv.get(('work', p), [])) for p in PHASES},
            'wait': {w: secs(iv.get(('wait', w), [])) for w in WAITS},
            'open': [f'{k[0]}:{k[1]}' for k, v in iv.items() if any(e is None for _, e, _ in v)]}


def cmd_show(a):
    s = summarize(a.key)
    if not s:
        sys.exit(f'{a.key}: chưa có timeline')
    print(f'## {a.key} — {"xong" if s["done"] else "đang chạy"} — {s["first"]:%m-%d %H:%M} → {s["last"]:%m-%d %H:%M} (lịch {fmt((s["last"] - s["first"]).total_seconds())})\n')
    print('| Loại | Bước | Bắt đầu | Kết thúc | Thời lượng | Ghi chú |\n|---|---|---|---|---|---|')
    rows = [(s_, e_, k, n) for k, v in s['iv'].items() for s_, e_, n in v]
    for st, en, (kind, name), note in sorted(rows, key=lambda r: r[0]):
        print(f'| {"làm" if kind == "work" else "chờ"} | {name} | {st:%m-%d %H:%M} | {en:%m-%d %H:%M}' if en else
              f'| {"làm" if kind == "work" else "chờ"} | {name} | {st:%m-%d %H:%M} | (đang mở)', end='')
        print(f' | {fmt((en - st).total_seconds()) if en else "—"} | {note} |')
    print(f'\nTổng làm: {fmt(sum(s["work"].values()))} · Tổng chờ: {fmt(sum(s["wait"].values()))}')
    if s['open']:
        print('Mốc còn mở: ' + ', '.join(s['open']))


def cmd_report(a):
    keys = a.keys or sorted(d for d in os.listdir(ROOT) if os.path.exists(path(d)))
    sums = [s for s in (summarize(k) for k in keys) if s]
    if not sums:
        sys.exit('Chưa có issue nào có timeline.')
    used = sums if a.all else [s for s in sums if s['done']]
    print('| Issue | Trạng thái | ' + ' | '.join(PHASES) + ' | Tổng làm | ' + ' | '.join('chờ ' + w for w in WAITS) + ' | Lịch (đầu→cuối) |')
    print('|' + '---|' * (len(PHASES) + len(WAITS) + 4))
    for s in sums:
        print(f'| {s["key"]} | {"xong" if s["done"] else "đang chạy"} | ' + ' | '.join(fmt(s['work'][p]) if s['work'][p] else '—' for p in PHASES)
              + f' | {fmt(sum(s["work"].values()))} | ' + ' | '.join(fmt(s['wait'][w]) if s['wait'][w] else '—' for w in WAITS)
              + f' | {fmt((s["last"] - s["first"]).total_seconds())} |')
    opened = [f'{s["key"]} ({", ".join(s["open"])})' for s in sums if s['open']]
    if opened:
        print('\n⚠ Mốc còn mở (chưa end, không được tính): ' + '; '.join(opened))
    if not used:
        print('\nChưa có issue nào xong (có mốc report end). Dùng --all để tính cả issue đang chạy.')
        return
    print(f'\n### Trung bình trên {len(used)} issue {"(gồm cả đang chạy)" if a.all else "đã xong"}')
    print('| Bước | Trung bình | Trung vị | Số issue có bước này |\n|---|---|---|---|')
    def line(label, vals):
        v = [x for x in vals if x]
        if v:
            print(f'| {label} | {fmt(statistics.mean(v))} | {fmt(statistics.median(v))} | {len(v)} |')
    for p in PHASES:
        line(p, [s['work'][p] for s in used])
    line('**Tổng làm**', [sum(s['work'].values()) for s in used])
    for w in WAITS:
        line('chờ ' + w, [s['wait'][w] for s in used])
    line('**Lịch (đầu→cuối)**', [(s['last'] - s['first']).total_seconds() for s in used])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest='cmd', required=True)
    for c in ('start', 'end', 'wait-start', 'wait-end'):
        s = sp.add_parser(c); s.add_argument('key'); s.add_argument('name'); s.add_argument('--note'); s.add_argument('--at')
    s = sp.add_parser('show'); s.add_argument('key')
    s = sp.add_parser('report'); s.add_argument('keys', nargs='*'); s.add_argument('--all', action='store_true')
    a = p.parse_args()
    if a.cmd in ('start', 'end'):
        mark(a, 'work', a.cmd)
    elif a.cmd in ('wait-start', 'wait-end'):
        mark(a, 'wait', a.cmd.split('-')[1])
    else:
        globals()['cmd_' + a.cmd](a)


if __name__ == '__main__':
    main()

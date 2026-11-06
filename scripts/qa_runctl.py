#!/usr/bin/env python3
"""Quản lý lượt chạy test: giữ quyền tài nguyên dùng chung + nhật ký thay đổi tạm thời.

Giữ quyền dựa trên os.mkdir (atomic): hai lượt cùng acquire thì chỉ một lượt thành công.
  - write: mkdir <lock>/writer      -> chỉ 1 lượt; thất bại nếu đang có reader
  - read : mkdir <lock>/readers/<run> -> nhiều lượt; thất bại nếu đang có writer
Cả hai phía "đăng ký trước rồi kiểm phía kia", nên không bao giờ có writer và reader cùng giữ.

Exit code: 0 = OK, 2 = tài nguyên đang bận / không được phép, 1 = lỗi dùng lệnh.
"""
import argparse, json, os, re, sys, time
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
ROOT = os.environ.get('QA_RUNCTL_ROOT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.claude', 'runctl')
LOCKS = os.path.join(ROOT, 'locks')
JOURNALS = os.path.join(ROOT, 'journals')
HISTORY = os.path.join(ROOT, 'lock-history.log')


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def slug(resource):
    return re.sub(r'[^a-zA-Z0-9._-]+', '_', resource).strip('_')


def lock_dir(resource):
    return os.path.join(LOCKS, slug(resource))


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path, data):
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def history(line):
    os.makedirs(ROOT, exist_ok=True)
    with open(HISTORY, 'a') as f:
        f.write(f'{now()} {line}\n')


def journal_path(run):
    return os.path.join(JOURNALS, f'{slug(run)}.json')


def load_journal(run):
    j = read_json(journal_path(run))
    if j is None:
        sys.exit(f'Run {run} chưa start. Gọi: start {run} ...')
    return j


def save_journal(j):
    write_json(journal_path(j['run']), j)


def readers_of(d):
    rd = os.path.join(d, 'readers')
    return sorted(os.listdir(rd)) if os.path.isdir(rd) else []


def writer_of(d):
    return read_json(os.path.join(d, 'writer', 'meta.json'))


# ---------- lệnh ----------

def cmd_start(a):
    os.makedirs(JOURNALS, exist_ok=True)
    if os.path.exists(journal_path(a.run)):
        sys.exit(f'Run {a.run} đã tồn tại. Dùng run-id khác.')
    save_journal({'run': a.run, 'ticket': a.ticket, 'server': a.server, 'account': a.account,
                  'store': a.store, 'started': now(), 'state': 'running',
                  'changes': [], 'kept': [], 'locks': []})
    print(f'OK started {a.run}')
    cmd_pending(argparse.Namespace(server=a.server))


def cmd_acquire(a):
    j = load_journal(a.run)
    d = lock_dir(a.resource)
    os.makedirs(os.path.join(d, 'readers'), exist_ok=True)
    meta = {'resource': a.resource, 'run': a.run, 'ticket': j['ticket'], 'mode': a.mode,
            'purpose': a.purpose, 'original': a.original, 'status': 'in-use', 'since': now()}
    if a.mode == 'write':
        try:
            os.mkdir(os.path.join(d, 'writer'))
        except FileExistsError:
            w = writer_of(d) or {}
            print(f'BUSY {a.resource}: đang bị {w.get("run")} giữ ({w.get("status")}, mục đích: {w.get("purpose")})')
            sys.exit(2)
        write_json(os.path.join(d, 'writer', 'meta.json'), meta)
        rs = readers_of(d)
        if rs:
            os.remove(os.path.join(d, 'writer', 'meta.json'))
            os.rmdir(os.path.join(d, 'writer'))
            print(f'BUSY {a.resource}: đang có lượt đọc phụ thuộc: {", ".join(rs)}')
            sys.exit(2)
    else:
        r = os.path.join(d, 'readers', slug(a.run))
        try:
            os.mkdir(r)
        except FileExistsError:
            pass
        write_json(os.path.join(r, 'meta.json'), meta)
        if os.path.isdir(os.path.join(d, 'writer')):
            w = writer_of(d) or {}
            os.remove(os.path.join(r, 'meta.json'))
            os.rmdir(r)
            print(f'BUSY {a.resource}: đang bị {w.get("run")} thay đổi ({w.get("purpose")}); kết quả phụ thuộc sẽ không đáng tin')
            sys.exit(2)
    j['locks'].append({'resource': a.resource, 'mode': a.mode, 'original': a.original, 'since': now(), 'released': None})
    save_journal(j)
    history(f'ACQUIRE {a.mode} {a.resource} by {a.run} purpose="{a.purpose}" original="{a.original}"')
    print(f'OK acquired {a.mode} {a.resource}')


def cmd_set_status(a):
    d = lock_dir(a.resource)
    w = writer_of(d)
    if not w or w['run'] != a.run:
        sys.exit(f'{a.run} không giữ write lock của {a.resource}')
    w['status'] = a.status
    write_json(os.path.join(d, 'writer', 'meta.json'), w)
    history(f'STATUS {a.resource} {a.status} by {a.run}')
    print(f'OK {a.resource} -> {a.status}')


def cmd_release(a):
    j = load_journal(a.run)
    d = lock_dir(a.resource)
    held = next((l for l in j['locks'] if l['resource'] == a.resource and not l['released']), None)
    if not held:
        sys.exit(f'{a.run} không giữ {a.resource}')
    if held['mode'] == 'write':
        if not a.restored or not a.verify:
            sys.exit('Release write lock cần --restored (giá trị sau khôi phục) và --verify (cách đã xác minh)')
        os.remove(os.path.join(d, 'writer', 'meta.json'))
        os.rmdir(os.path.join(d, 'writer'))
    else:
        r = os.path.join(d, 'readers', slug(a.run))
        if os.path.exists(os.path.join(r, 'meta.json')):
            os.remove(os.path.join(r, 'meta.json'))
        if os.path.isdir(r):
            os.rmdir(r)
    held.update(released=now(), restored=a.restored, verify=a.verify)
    save_journal(j)
    history(f'RELEASE {held["mode"]} {a.resource} by {a.run} restored="{a.restored}" verify="{a.verify}"')
    print(f'OK released {a.resource}')


def cmd_takeover(a):
    """Tiếp quản lock của lượt đã bị ngắt. KHÔNG dựa vào thời gian: phải khai trạng thái thực tế đã kiểm."""
    d = lock_dir(a.resource)
    w = writer_of(d)
    if not w:
        sys.exit(f'{a.resource} không có write lock')
    old = read_json(journal_path(w['run'])) or {}
    if old.get('state') == 'running' and not a.confirm_interrupted:
        print(f'REFUSED: run {w["run"]} vẫn ở trạng thái running. Chỉ tiếp quản khi chắc lượt đó đã dừng '
              f'(thêm --confirm-interrupted) và đã kiểm trạng thái thực tế (--actual).')
        sys.exit(2)
    j = load_journal(a.run)
    w.update(run=a.run, ticket=j['ticket'], status='restoring', taken_over_from=w['run'],
             actual_at_takeover=a.actual, since=now())
    write_json(os.path.join(d, 'writer', 'meta.json'), w)
    j['locks'].append({'resource': a.resource, 'mode': 'write', 'original': w['original'], 'since': now(),
                       'released': None, 'taken_over_from': w['taken_over_from']})
    save_journal(j)
    if old:
        old['state'] = 'interrupted'
        for l in old['locks']:
            if l['resource'] == a.resource and not l['released']:
                l.update(released=now(), restored=None, verify=f'tiếp quản bởi {a.run}')
        save_journal(old)
    history(f'TAKEOVER {a.resource} {w["taken_over_from"]} -> {a.run} actual="{a.actual}"')
    print(f'OK {a.run} tiếp quản {a.resource} ở trạng thái restoring. Giá trị gốc cần trả về: {w["original"]}')


def cmd_status(a):
    d = lock_dir(a.resource)
    w = writer_of(d) if os.path.isdir(d) else None
    rs = readers_of(d) if os.path.isdir(d) else []
    if not w and not rs:
        print(f'FREE {a.resource}')
        return
    if w:
        print(f'WRITE {a.resource}: {w["run"]} ({w["status"]}) mục đích="{w["purpose"]}" gốc="{w["original"]}" từ {w["since"]}')
    if rs:
        print(f'READ {a.resource}: {", ".join(rs)}')
    if w and not a.quiet:
        sys.exit(2)


def cmd_list(a):
    if not os.path.isdir(LOCKS):
        print('(không có lock)')
        return
    for s in sorted(os.listdir(LOCKS)):
        d = os.path.join(LOCKS, s)
        w, rs = writer_of(d), readers_of(d)
        if w or rs:
            print(f'- {w["resource"] if w else s}: writer={w["run"] + " (" + w["status"] + ")" if w else "-"} readers={rs or "-"}')


def cmd_change(a):
    j = load_journal(a.run)
    j['changes'].append({'id': len(j['changes']) + 1, 'kind': a.kind, 'target': a.target,
                         'before': a.before, 'after': a.after, 'at': now(), 'restore': None})
    save_journal(j)
    print(f'OK change #{len(j["changes"])} ghi nhận (ghi TRƯỚC khi thay đổi thật)')


def cmd_restored(a):
    j = load_journal(a.run)
    c = next((c for c in j['changes'] if c['id'] == a.id), None)
    if not c:
        sys.exit(f'Không có change #{a.id}')
    c['restore'] = {'result': a.result, 'verify': a.verify, 'at': now()}
    save_journal(j)
    print(f'OK change #{a.id} -> {a.result}')


def cmd_keep(a):
    j = load_journal(a.run)
    j['kept'].append({'type': a.type, 'id': a.id, 'link': a.link, 'owner': a.owner or j['ticket'], 'note': a.note})
    save_journal(j)
    print(f'OK kept {a.type} {a.id}')


def unrestored(j):
    return [c for c in j['changes'] if not c['restore'] or c['restore']['result'] != 'ok']


def cmd_pending(a):
    """Đầu lượt: liệt kê thay đổi tạm thời chưa khôi phục và lock chưa trả của MỌI lượt."""
    found = False
    if os.path.isdir(JOURNALS):
        for f in sorted(os.listdir(JOURNALS)):
            j = read_json(os.path.join(JOURNALS, f))
            for c in unrestored(j):
                if a.server and c['kind'] == 'browser' and j.get('server') != a.server:
                    continue
                found = True
                st = c['restore']['result'] if c['restore'] else 'chưa khôi phục'
                print(f'PENDING change {j["run"]}#{c["id"]} [{c["kind"]}] {c["target"]}: gốc="{c["before"]}" đã đổi="{c["after"]}" ({st}; run {j["state"]}, server {j.get("server")})')
    if os.path.isdir(LOCKS):
        for s in sorted(os.listdir(LOCKS)):
            w = writer_of(os.path.join(LOCKS, s))
            if w:
                found = True
                print(f'HELD lock {w["resource"]} by {w["run"]} ({w["status"]}) gốc="{w["original"]}"')
    if not found:
        print('Không có thay đổi tồn đọng.')


def cmd_finish(a):
    j = load_journal(a.run)
    open_locks = [l for l in j['locks'] if not l['released']]
    j['state'] = 'finished' if not open_locks and not unrestored(j) else 'finished-with-pending'
    j['finished'] = now()
    save_journal(j)
    cmd_report(a)


def cmd_report(a):
    j = load_journal(a.run)
    print(f'## Run {j["run"]} — {j["ticket"]} — server {j["server"]}, account {j["account"]}, store {j["store"]} — {j["state"]}')
    print('\n### Dữ liệu giữ lại để review')
    for k in j['kept'] or []:
        print(f'- {k["type"]} {k["id"]} {k["link"] or ""} (owner: {k["owner"]}) {k["note"] or ""}')
    if not j['kept']:
        print('- (không có)')
    print('\n### Thay đổi tạm thời đã khôi phục')
    ok = [c for c in j['changes'] if c['restore'] and c['restore']['result'] == 'ok']
    for c in ok:
        print(f'- [{c["kind"]}] {c["target"]}: "{c["after"]}" -> về "{c["before"]}" (xác minh: {c["restore"]["verify"]})')
    if not ok:
        print('- (không có)')
    print('\n### CHƯA khôi phục được')
    bad = unrestored(j)
    for c in bad:
        st = c['restore'] or {}
        print(f'- [{c["kind"]}] {c["target"]}: đang là "{c["after"]}", gốc "{c["before"]}" — {st.get("result", "chưa khôi phục")} {st.get("verify", "")}')
    for l in j['locks']:
        if not l['released']:
            print(f'- lock {l["resource"]} ({l["mode"]}) chưa trả — chặn các lượt phụ thuộc tài nguyên này')
    if not bad and all(l['released'] for l in j['locks']):
        print('- (không có)')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('start'); s.add_argument('run'); s.add_argument('--ticket', required=True)
    s.add_argument('--server', required=True); s.add_argument('--account', required=True); s.add_argument('--store', required=True)
    s = sp.add_parser('acquire'); s.add_argument('resource'); s.add_argument('--run', required=True)
    s.add_argument('--mode', choices=['write', 'read'], default='write'); s.add_argument('--purpose', required=True)
    s.add_argument('--original', default='')
    s = sp.add_parser('set-status'); s.add_argument('resource'); s.add_argument('--run', required=True)
    s.add_argument('status', choices=['in-use', 'restoring'])
    s = sp.add_parser('release'); s.add_argument('resource'); s.add_argument('--run', required=True)
    s.add_argument('--restored'); s.add_argument('--verify')
    s = sp.add_parser('takeover'); s.add_argument('resource'); s.add_argument('--run', required=True)
    s.add_argument('--actual', required=True, help='giá trị thực tế vừa kiểm trên môi trường')
    s.add_argument('--confirm-interrupted', action='store_true')
    s = sp.add_parser('status'); s.add_argument('resource'); s.add_argument('--quiet', action='store_true')
    sp.add_parser('list')
    s = sp.add_parser('change'); s.add_argument('run'); s.add_argument('--kind', choices=['browser', 'shared-config', 'preexisting-data'], required=True)
    s.add_argument('--target', required=True); s.add_argument('--before', required=True); s.add_argument('--after', required=True)
    s = sp.add_parser('restored'); s.add_argument('run'); s.add_argument('--id', type=int, required=True)
    s.add_argument('--result', choices=['ok', 'failed'], required=True); s.add_argument('--verify', required=True)
    s = sp.add_parser('keep'); s.add_argument('run'); s.add_argument('--type', required=True); s.add_argument('--id', required=True)
    s.add_argument('--link'); s.add_argument('--owner'); s.add_argument('--note')
    s = sp.add_parser('pending'); s.add_argument('--server')
    s = sp.add_parser('finish'); s.add_argument('run')
    s = sp.add_parser('report'); s.add_argument('run')
    a = p.parse_args()
    globals()['cmd_' + a.cmd.replace('-', '_')](a)


if __name__ == '__main__':
    main()

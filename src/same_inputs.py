"""Same inputs for a pair's two searches: the pages and the AI answers one search got are the ones the other gets (by-hand tool, tools/persona-search/same-inputs.mjs).
Why (owner, 14 Nov 2026: "let's commit it open a PR and get this merged... For now it still remains a by hand, local tool, but I want to store the implementation"; evidence: PR body):
a pair's two searches differ by what the sites answered a second apart and by what the AI answered, so a difference of one job was not told from noise. One folder, shared by both
searches' processes for one run; nothing is kept after it (the tool deletes it unless --keep).
Env (all under the TAPE_ prefix the app's engine env passes, desktop/lib/pipeline-env.js, which drops them in an installed build; never set by the app):
  JOBADABRA_TAPE_SHARED=<folder>   pages: the first search to ask an address fetches it and writes status, body and seconds; the other gets the same bytes after the same seconds, counted from
                                   its own ask, so it is not faster inside the 3-minute clock. An address only one search asks, and a search's own second ask, are live (a real run refetches).
  JOBADABRA_TAPE_SHARED_AI=1       AI answers: the same rule for a byte-identical request (dates normalised, as src/search_tape.py keys it).
  JOBADABRA_TAPE_SHARED_REPLAY=1   serve a finished run's folder (`_SCALE` times its seconds): nothing is asked of any site or AI; what the folder lacks fails like an unreachable site.
Invariant: install() refuses unless the engine's data folder and the shared folder are both under the OS temp folder, so the owner's app folder can never be read through it.
Not covered: reads that do not go through urllib (the page browser, the extension). Uses src/search_tape.py's reply and key helpers (one definition of a request's key and of a replayed reply)."""
import atexit
import hashlib
import io
import json
import os
import tempfile
import time
import urllib.error
import urllib.request

from . import search_tape

SIDE = hashlib.sha1(os.path.dirname(os.path.abspath(__file__)).encode()).hexdigest()[:8]   # this checkout's src folder: one id per search, no env needed
REPLAY = os.environ.get('JOBADABRA_TAPE_SHARED_REPLAY') == '1'
SCALE = float(os.environ.get('JOBADABRA_TAPE_SHARED_REPLAY_SCALE', '1'))
WAIT_PAGE_S, WAIT_AI_S = 150, 240   # the other search never finished an address: ask live
counts = {}
folder = ''


def _count(name, amount=1):
    counts[name] = counts.get(name, 0) + amount


def _write(path, data):
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'wb') as file:
        file.write(data)
    os.replace(tmp, path)


def _log(kind, what, seconds):
    try:
        with open(os.path.join(folder, f'log-{SIDE}.jsonl'), 'a', encoding='utf-8') as file:
            file.write(json.dumps({'kind': kind, 'url': what[:200], 'seconds': round(seconds, 2), 't': round(time.time(), 1)}) + '\n')
    except OSError:
        pass


def _role(base):
    """'first' = this search asks first and fetches; 'own' = it asked before (it refetches); 'other' = the other search asked first (wait for its answer)."""
    try:
        fd = os.open(base + '.lock', os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        for _ in range(200):   # the creator writes its id just after creating the file: an empty file is not "the other search" yet
            with open(base + '.lock', encoding='utf-8') as file:
                owner = file.read().strip()
            if owner:
                return 'own' if owner == SIDE else 'other'
            time.sleep(0.01)
        return 'other'
    os.write(fd, SIDE.encode())
    os.close(fd)
    return 'first'


def _await(base, asked, limit):
    """The other search's record at `base`, after the seconds its live ask took (counted from `asked`), or None when it never came."""
    while not os.path.exists(base + '.json') and time.monotonic() < asked + limit:
        time.sleep(0.05)
    if not os.path.exists(base + '.json'):
        return None
    with open(base + '.json', encoding='utf-8') as file:
        record = json.load(file)
    waited = time.monotonic() - asked
    time.sleep(max(0.0, record.get('seconds', 0) - waited))   # the same delay the live ask took
    _count('wait_s', waited)
    return record


def _served(url, meta, body):
    """The reply a record stands for: the page, or the failure the live ask ended in."""
    if meta.get('error'):
        if meta.get('status'):
            raise urllib.error.HTTPError(url, meta['status'], meta['error'], {}, io.BytesIO(body))
        raise search_tape._error(meta)
    return search_tape._Reply(body, meta)


def _fetch(real, request, data, timeout, args, kwargs, base, url):
    """The first ask of an address: live, then written for the other search. Returns the reply or raises the live failure."""
    started, meta, body = time.monotonic(), {'url': url}, b''
    failure = None
    try:
        reply = real(request, data, timeout, *args, **kwargs) if timeout is not None else real(request, data, *args, **kwargs)
        body = reply.read()
        meta.update(status=getattr(reply, 'status', 200), final=reply.geturl(), type=(reply.headers.get('Content-Type') or '') if getattr(reply, 'headers', None) else '')
    except urllib.error.HTTPError as error:
        body = error.read() if hasattr(error, 'read') else b''
        meta.update(status=error.code, error=str(error.reason)[:200], exc='HTTPError')
        failure = error
    except Exception as error:   # any failure is written too: the other search must not wait out its limit for a record that never comes
        meta.update(error=f'{type(error).__name__}: {error}'[:200], exc=type(error).__name__)
        failure = error
    meta['seconds'] = round(time.monotonic() - started, 3)
    _write(base + '.body', body)
    _write(base + '.json', json.dumps(meta).encode())
    _log('live', url, meta['seconds'])
    if failure is not None:
        raise failure
    return search_tape._Reply(body, meta)


def _urlopen(real):
    def urlopen(request, data=None, timeout=None, *args, **kwargs):
        url, _, key = search_tape._request_key(request, data)
        base = os.path.join(folder, key)
        if REPLAY:
            if not os.path.exists(base + '.json'):
                _count('missing')
                _log('missing', url, 0)
                raise urllib.error.URLError(f'not in the shared folder: {url}')
            meta, body = json.load(open(base + '.json', encoding='utf-8')), open(base + '.body', 'rb').read()
            time.sleep(meta.get('seconds', 0) * SCALE)
            _count('replayed')
            return _served(url, meta, body)
        asked, role = time.monotonic(), _role(base)
        if role == 'first':
            _count('live')
            return _fetch(real, request, data, timeout, args, kwargs, base, url)
        record = _await(base, asked, WAIT_PAGE_S) if role == 'other' else None
        if record is None:   # its own second ask, or the other search never finished: a real run asks the site
            _count('own_again' if role == 'own' else 'live')
            _log('own_again' if role == 'own' else 'live_after_wait', url, 0)
            return real(request, data, timeout, *args, **kwargs) if timeout is not None else real(request, data, *args, **kwargs)
        _count('shared')
        _log('shared', url, time.monotonic() - asked)
        return _served(url, record, open(base + '.body', 'rb').read())
    urlopen.same_inputs = True
    return urlopen


class _Messages:
    def __init__(self, live):
        self.live = live

    def create(self, **params):
        key = 'ai-' + search_tape._key('ai', search_tape.DATE.sub('DATE', json.dumps(params, sort_keys=True, default=str)))
        base = os.path.join(folder, key)
        if REPLAY:
            if not os.path.exists(base + '.json'):
                _count('ai_missing')
                raise RuntimeError('not in the shared folder: an AI request')
            record = json.load(open(base + '.json', encoding='utf-8'))
            time.sleep(record['seconds'] * SCALE)
            _count('ai_replayed')
            if record.get('error'):
                raise RuntimeError(record['error'])
            return search_tape._response(record)
        asked, role = time.monotonic(), _role(base)
        if role == 'first':
            _count('ai_live')
            try:
                answer = self.live().messages.create(**params)
            except Exception as error:   # the failure is written too, so the other search raises it at once instead of waiting out its limit
                _write(base + '.json', json.dumps({'error': f'{type(error).__name__}: {error}'[:300], 'seconds': round(time.monotonic() - asked, 3)}).encode())
                _log('ai_failed', key, time.monotonic() - asked)
                raise
            usage = getattr(answer, 'usage', None)
            record = {'model': getattr(answer, 'model', ''), 'stop_reason': getattr(answer, 'stop_reason', 'end_turn'), 'engine': getattr(answer, 'engine', ''),
                      'texts': [block.text for block in answer.content if getattr(block, 'type', 'text') == 'text'], 'seconds': round(time.monotonic() - asked, 3),
                      'usage': {k: getattr(usage, k) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'billing', 'provider', 'model') if hasattr(usage, k)}}
            _write(base + '.json', json.dumps(record).encode())
            _log('ai_live', key, record['seconds'])
            return answer
        record = _await(base, asked, WAIT_AI_S) if role == 'other' else None
        if record is None:
            _count('ai_own_again' if role == 'own' else 'ai_live')
            return self.live().messages.create(**params)
        _count('ai_shared')
        _log('ai_shared', key, time.monotonic() - asked)
        if record.get('error'):
            raise RuntimeError(record['error'])
        return search_tape._response(record)


class _Client:
    """The engine's AI client with the shared `messages`; anything else (a label, the engine's name) is the live client's."""
    def __init__(self, build):
        self._build, self._live = build, None
        self.messages = _Messages(self.live)

    def live(self):
        if self._live is None:
            self._live = self._build()
        return self._live

    def __getattr__(self, name):
        return getattr(self.live(), name)


def _under_temp(path):
    base = os.path.realpath(tempfile.gettempdir())
    return os.path.commonpath([base, os.path.realpath(path)]) == base


def install():
    """Put the shared folder in front of the web (and the AI when asked) for this process, once. Refuses an engine whose data folder or shared folder is outside the OS temp folder."""
    global folder
    if getattr(urllib.request.urlopen, 'same_inputs', False):
        return
    folder = os.environ['JOBADABRA_TAPE_SHARED']
    data = os.environ.get('JOBADABRA_DATA_DIR', '')
    if not data or not _under_temp(data) or not _under_temp(folder):
        raise RuntimeError('same inputs: only a throwaway run (data folder and shared folder under the OS temp folder) may share pages or AI answers')
    os.makedirs(folder, exist_ok=True)
    urllib.request.urlopen = _urlopen(urllib.request.urlopen)
    if os.environ.get('JOBADABRA_TAPE_SHARED_AI') == '1' or REPLAY:
        from .ai import providers
        real_build = providers.build
        providers.build = lambda env=None, action='', log=None: _Client(lambda: real_build(env, action, log))
    atexit.register(lambda: _log('exit', json.dumps(counts), 0))

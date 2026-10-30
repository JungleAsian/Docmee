"""Replay the synthetic menu corpus against the installed LAYA service, one request at a time.

Usage (on the Docmee host): python3 run_menu_corpus.py CORPUS.json MENUS.json > results.csv
Builds candidates and language buckets exactly like Docmee's live path
(packages/agents/src/laya/observations.ts: menuBranchCandidates, layaLanguageOf).
Only contacts 127.0.0.1:8767. Prints one compact CSV row per case.
"""
import http.client
import json
import sys
import time
import uuid

SPANISH = ['hola', 'buenos', 'buenas', 'quiero', 'necesito', 'cita', 'gracias', 'por favor', 'tengo',
           'puedo', 'cuánto', 'cuanto', 'cuándo', 'cuando', 'dónde', 'donde', 'precio', 'horario', 'cancelar', 'seguro']
ENGLISH = ['hello', 'hi', 'want', 'need', 'appointment', 'book', 'thanks', 'please', 'price', 'how much',
           'when', 'where', 'hours', 'cancel', 'change', 'insurance', 'doctor', 'secretary']


def language_of(text):
    """Port of layaLanguageOf: keep letters and whitespace, pad, match whole words."""
    cleaned = ''.join(ch if ch.isalpha() or ch.isspace() else ' ' for ch in text.lower())
    padded = ' ' + ' '.join(cleaned.split()) + ' '
    es = any(f' {w} ' in padded for w in SPANISH)
    en = any(f' {w} ' in padded for w in ENGLISH)
    return 'mixed' if es and en else 'es' if es else 'en' if en else 'unknown'


def candidates_for(options, labels='full'):
    """Port of menuBranchCandidates. labels='title' drops descriptions (experiment)."""
    usable = [o for o in options if o.get('id') and o.get('title') and o['id'] != '__more__']
    def label(o):
        if labels == 'title' or not o.get('description'):
            return o['title']
        return f"{o['title']} — {o['description']}"
    return [{'id': o['id'][:128], 'label': label(o)[:1200]} for o in usable]


def decide(text, language, candidates):
    body = json.dumps({'schemaVersion': 1, 'requestId': str(uuid.uuid4()), 'task': 'workflow_branch',
                       'language': language, 'text': text, 'candidates': candidates})
    started = time.monotonic()
    conn = http.client.HTTPConnection('127.0.0.1', 8767, timeout=6)
    try:
        conn.request('POST', '/v1/decision', body, {'Content-Type': 'application/json'})
        response = conn.getresponse()
        data = response.read()
        elapsed = round((time.monotonic() - started) * 1000)
        if response.status != 200:
            return response.status, elapsed, None
        return 200, elapsed, json.loads(data)
    except Exception:
        return 0, round((time.monotonic() - started) * 1000), None
    finally:
        conn.close()


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    """Options: --labels full|title, --lang bucket|true, --split all|calibration|heldout, --menus a,b"""
    labels, lang_mode, split = arg('--labels', 'full'), arg('--lang', 'bucket'), arg('--split', 'all')
    only = set(arg('--menus', '').split(',')) - {''}
    labelmap = json.load(open(arg('--labelmap', ''), encoding='utf-8')) if '--labelmap' in sys.argv else None
    cases = json.load(open(sys.argv[1], encoding='utf-8'))
    menus = {m['id']: m['options'] for m in json.load(open(sys.argv[2], encoding='utf-8'))}
    print('id,status,ms,choice,score,abstain,bucket', flush=True)
    for case in cases:
        if (split != 'all' and case['split'] != split) or (only and case['menu'] not in only):
            continue
        candidates = candidates_for(menus[case['menu']], labels)
        if labelmap:  # experiment: replace option labels from a {menu: {optionId: label}} file
            candidates = [{'id': x['id'], 'label': labelmap[case['menu']][x['id']]} for x in candidates]
        bucket = language_of(case['text']) if lang_mode == 'bucket' else case['lang']
        status, elapsed, out = decide(case['text'], bucket, candidates)
        if status in (0, 503):
            time.sleep(3)  # the single inference slot may still be busy; retry once
            status, elapsed, out = decide(case['text'], bucket, candidates)
        out = out or {}
        score = out.get('rawScore')
        print(f"{case['id']},{status},{elapsed},{out.get('choiceId') or ''},"
              f"{'' if score is None else round(score, 4)},{int(bool(out.get('abstain')))},{bucket}", flush=True)
        time.sleep(0.2)


if __name__ == '__main__':
    main()

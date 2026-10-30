"""Score the menu corpus locally with the runtime's own decision logic (backend.PinnedBackend.decide).

Usage: python local_menu_eval.py MODEL_DIR CORPUS.json MENUS.json OUT.csv [--device cuda|cpu]
       [--split calibration|heldout|fresh|all] [--labels title|full] [--verify-manifest]
Writes the same CSV columns as run_menu_corpus.py so menu_report.py can read it.
"""
import csv
import json
import os
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'laya-runtime'))
sys.path.insert(0, HERE)

from run_menu_corpus import candidates_for, language_of  # noqa: E402


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    model_dir, corpus_path, menus_path, out_path = sys.argv[1:5]
    device, split, labels = arg('--device', 'cuda'), arg('--split', 'calibration'), arg('--labels', 'title')
    import backend  # the runtime's adapter: same rendering, validation and probability checks
    from laya import Agent

    def factory(**kwargs):
        kwargs['device'] = device
        return Agent(**kwargs)

    if '--verify-manifest' in sys.argv:
        pinned = backend.PinnedBackend(model_dir, agent_factory=factory)
    else:  # a fine-tuned checkpoint has new hashes; skip only the manifest check, keep decide() identical
        real_verify = backend.verify_artifacts
        backend.verify_artifacts = lambda _dir: None
        try:
            pinned = backend.PinnedBackend(model_dir, agent_factory=factory)
        finally:
            backend.verify_artifacts = real_verify
    menus = {m['id']: m['options'] for m in json.load(open(menus_path, encoding='utf-8'))}
    cases = [c for c in json.load(open(corpus_path, encoding='utf-8')) if split == 'all' or c['split'] == split]
    with open(out_path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'status', 'ms', 'choice', 'score', 'abstain', 'bucket'])
        for c in cases:
            bucket = language_of(c['text'])
            request = {'schemaVersion': 1, 'requestId': str(uuid.uuid4()), 'task': 'workflow_branch', 'language': bucket,
                       'text': c['text'], 'candidates': candidates_for(menus[c['menu']], labels)}
            t = time.monotonic()
            out = pinned.decide(request)
            ms = round((time.monotonic() - t) * 1000)
            w.writerow([c['id'], 200, ms, out['choiceId'] or '', '' if out['abstain'] else round(out['rawScore'], 4),
                        int(out['abstain']), bucket])
    print(json.dumps({'cases': len(cases), 'out': out_path}))


if __name__ == '__main__':
    main()

"""Turn the Automation Center simulator export into LAYA fine-tune input.

The export comes from LAYA settings -> "Download training examples (JSON)"
(GET /clinics/:id/laya/training-examples). Every example was typed by clinic staff in the
simulator and labelled by their own tap or clear YES, so it is ground truth for that menu.

Usage:
  python simulation_training_rows.py EXPORT.json TRAIN_OUT.json MENUS_OUT.json [--exclude FROZEN.json ...]

TRAIN_OUT rows use the same {menu, lang, text, expected} shape as menu_training_data*.py and
MENUS_OUT uses the {id, options:[{id, title}]} shape finetune_menus.py reads, so:
  python finetune_menus.py prepare TRAIN_OUT.json MENUS_OUT.json train-sim.jsonl
and concatenate train-sim.jsonl with the other training JSONL.

--exclude drops any text that also appears in a frozen evaluation file (after normalisation), so a
held-out test set stays unseen.
"""
import json
import sys

import menu_training_data as v1


def main(argv):
    if len(argv) < 4:
        raise SystemExit(__doc__)
    export_path, train_out, menus_out = argv[1:4]
    excluded = set()
    rest = argv[4:]
    while rest:
        flag, path, *rest = rest
        if flag != '--exclude':
            raise SystemExit(f'unknown option {flag}')
        excluded |= {v1.norm(case['text']) for case in json.load(open(path, encoding='utf-8'))}

    export = json.load(open(export_path, encoding='utf-8'))
    if export.get('source') != 'simulation':
        raise SystemExit('not a simulator training export')
    menus, rows, seen = {}, [], set()
    skipped = {'untitled_option': 0, 'frozen_overlap': 0, 'duplicate': 0}
    for example in export['examples']:
        options = example['options']
        if any(not option.get('title') for option in options) or not example.get('labelTitle'):
            skipped['untitled_option'] += 1  # the menu changed since; the label no longer matches a title
            continue
        text = example['text'].strip()
        key = v1.norm(text)
        if key in excluded:
            skipped['frozen_overlap'] += 1
            continue
        menu_id = f"{example['workflowId'][:8]}:{example['nodeId']}"
        if (menu_id, key) in seen:
            skipped['duplicate'] += 1
            continue
        seen.add((menu_id, key))
        menus.setdefault(menu_id, [{'id': option['id'], 'title': option['title']} for option in options])
        rows.append({'menu': menu_id, 'lang': example['language'], 'text': text, 'expected': example['labelChoiceId'],
                     'source': f"simulation:{example['labelSource']}"})

    json.dump(rows, open(train_out, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
    json.dump([{'id': menu_id, 'options': options} for menu_id, options in menus.items()],
              open(menus_out, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
    print(json.dumps({'rows': len(rows), 'menus': len(menus), 'skipped': skipped}))


if __name__ == '__main__':
    main(sys.argv)

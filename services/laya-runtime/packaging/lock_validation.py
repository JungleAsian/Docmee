"""Fail-closed validation for this lock's PEP 440/508 subset; no third-party code.

This is deliberately not a general resolver. Unsupported versions, requirements,
markers, or tags fail rather than guessing. The target never uses host markers.
"""
import ast
import email
import hashlib
import itertools
import re
import zipfile

TARGET = {
    'implementation_name': 'cpython', 'implementation_version': '3.12.0',
    'os_name': 'posix', 'platform_machine': 'aarch64',
    'platform_python_implementation': 'CPython', 'platform_system': 'Linux',
    'python_full_version': '3.12.0', 'python_version': '3.12', 'sys_platform': 'linux',
}
VERSION_KEYS = {'python_version', 'python_full_version', 'implementation_version'}


def canonical(name):
    if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9]+(?:[A-Za-z0-9._-]*[A-Za-z0-9])?',name):
        raise ValueError('invalid distribution name')
    return re.sub(r'[-_.]+','-',name).lower()


def version_parts(text):
    match = re.fullmatch(r'(\d+(?:\.\d+)*)(?:\+([a-z0-9.]+))?',text)
    if not match:
        raise ValueError('unsupported version')
    numbers = tuple(int(n) for n in match[1].split('.'))
    return numbers + (0,) * (8-len(numbers)), match[2] or ''


def satisfies(version, spec):
    actual, local = version_parts(version)
    for clause in spec.strip().split(','):
        if not clause.strip():
            continue
        match = re.fullmatch(r'\s*(~=|==|!=|<=|>=|<|>)\s*(\d+(?:\.\d+)*(?:\+[a-z0-9.]+)?(?:\.\*)?)\s*',clause)
        if not match:
            raise ValueError('unsupported version specifier')
        op, expected = match.groups()
        if expected.endswith('.*'):
            if op not in ('==','!='):
                raise ValueError('unsupported version wildcard')
            prefix = tuple(int(n) for n in expected[:-2].split('.'))
            equal = actual[:len(prefix)] == prefix
            passed = equal if op == '==' else not equal
        else:
            wanted, wanted_local = version_parts(expected)
            if wanted_local and op not in ('==','!='):
                raise ValueError('unsupported local version comparison')
            equal = actual == wanted and (not wanted_local or local == wanted_local)
            if op == '~=':
                parts = expected.split('.')
                if len(parts) < 2 or wanted_local:
                    raise ValueError('unsupported compatible release')
                prefix = tuple(int(n) for n in parts[:-1])
                passed = actual >= wanted and actual[:len(prefix)] == prefix
            else:
                passed = {'==':equal,'!=':not equal,'<':actual<wanted,'<=':actual<=wanted,
                          '>':actual>wanted,'>=':actual>=wanted}[op]
        if not passed:
            return False
    return True


def marker_applies(text, extra):
    """Parse data with ast; never eval/execute it. Visit even inactive branches."""
    def operand(node):
        if isinstance(node,ast.Name):
            if node.id == 'extra':
                return extra, node.id
            if node.id not in TARGET:
                raise ValueError('unresolved target marker')
            return TARGET[node.id], node.id
        if isinstance(node,ast.Constant) and isinstance(node.value,str):
            return node.value, None
        raise ValueError('unsupported marker operand')

    def visit(node):
        if isinstance(node,ast.BoolOp) and isinstance(node.op,(ast.And,ast.Or)):
            values = [visit(v) for v in node.values]
            return all(values) if isinstance(node.op,ast.And) else any(values)
        if not isinstance(node,ast.Compare) or len(node.ops) != 1:
            raise ValueError('unsupported marker expression')
        left, key = operand(node.left)
        right, other_key = operand(node.comparators[0])
        op = node.ops[0]
        if isinstance(op,(ast.In,ast.NotIn)):
            passed = left in right
            return passed if isinstance(op,ast.In) else not passed
        operators = {ast.Eq:'==',ast.NotEq:'!=',ast.Lt:'<',ast.LtE:'<=',ast.Gt:'>',ast.GtE:'>='}
        operator = operators.get(type(op))
        if operator is None:
            raise ValueError('unsupported marker operator')
        if key in VERSION_KEYS or other_key in VERSION_KEYS:
            return satisfies(left,operator+right)
        if operator not in ('==','!='):
            raise ValueError('unsupported non-version marker comparison')
        return (left == right) if operator == '==' else (left != right)
    try:
        return visit(ast.parse(text.strip(),mode='eval').body)
    except (SyntaxError,TypeError,RecursionError):
        raise ValueError('invalid conditional dependency') from None


def requirement(text):
    base, sep, marker = text.partition(';')
    match = re.fullmatch(r'\s*([A-Za-z0-9_.-]+)\s*(?:\[([A-Za-z0-9_,. -]+)\])?\s*(.*?)\s*',base)
    if not match:
        raise ValueError('unsupported requirement')
    name, extras, spec = match.groups()
    if spec.startswith('(') and spec.endswith(')'):
        spec = spec[1:-1]
    if '@' in spec or ';' in marker or (sep and not marker.strip()):
        raise ValueError('unsupported requirement')
    return canonical(name), {canonical(e.strip()) for e in extras.split(',')} if extras else set(), spec, marker


def wheel_compatible(filename):
    match = re.fullmatch(r'([A-Za-z0-9_]+)-([A-Za-z0-9_.+]+)-([A-Za-z0-9_.]+)-([A-Za-z0-9_.]+)-([A-Za-z0-9_.]+)\.whl',filename)
    if not match:
        raise ValueError('not a supported wheel filename')
    for python, abi, platform in itertools.product(*(p.split('.') for p in match.groups()[2:])):
        linux = re.fullmatch(r'manylinux_2_(\d+)_aarch64',platform)
        platform_ok = (platform in ('any','manylinux2014_aarch64') or linux and 17 <= int(linux[1]) <= 39)
        stable = re.fullmatch(r'cp3(\d+)',python)
        python_ok = (python in ('py3','py312') and abi == 'none' or
                     python == 'cp312' and abi in ('cp312','none') or
                     stable and abi == 'abi3' and 2 <= int(stable[1]) <= 12)
        if platform_ok and python_ok:
            return canonical(match[1]),match[2]
    raise ValueError('wheel incompatible with Ubuntu 24.04 ARM64 CPython 3.12')


def inspect_wheel(path_or_stream,record):
    """Read only root distribution METADATA, never extract or import a wheel."""
    with zipfile.ZipFile(path_or_stream) as archive:
        entries = [i for i in archive.infolist() if i.filename.count('/') == 1 and i.filename.endswith('.dist-info/METADATA')]
        if len(entries) != 1 or entries[0].file_size > 1024*1024:
            raise ValueError('invalid wheel metadata')
        with archive.open(entries[0]) as stream:
            raw = stream.read(1024*1024+1)
    if len(raw) > 1024*1024 or hashlib.sha256(raw).hexdigest() != record['metadata_sha256']:
        raise ValueError('wheel metadata mismatch')
    metadata = email.message_from_bytes(raw)
    for field in ('Name','Version'):
        if len(metadata.get_all(field,[])) != 1:
            raise ValueError('invalid wheel identity')
    if len(metadata.get_all('Requires-Python',[])) > 1:
        raise ValueError('invalid Python requirement')
    actual = {'name':canonical(metadata['Name']), 'version':metadata['Version'],
              'requires_python':metadata['Requires-Python'],
              'requires_dist':metadata.get_all('Requires-Dist',[]),
              'provides_extra':metadata.get_all('Provides-Extra',[])}
    if any(record[key] != value for key,value in actual.items()):
        raise ValueError('wheel metadata mismatch')
    if wheel_compatible(record['filename']) != (actual['name'],actual['version']):
        raise ValueError('wheel filename identity mismatch')


def verify_closure(records,roots):
    by_name = {}
    for record in records:
        name = canonical(record['name'])
        if name in by_name or name != record['name'] or name.startswith(('nvidia','cuda','triton')):
            raise ValueError('invalid or prohibited dependency')
        if wheel_compatible(record['filename']) != (name,record['version']):
            raise ValueError('wheel identity mismatch')
        if record['requires_python'] is not None and not satisfies('3.12.0',record['requires_python']):
            raise ValueError('unsupported Python requirement')
        by_name[name] = record
    active = {canonical(root):set() for root in roots}
    changed = True
    while changed:
        changed = False
        for name, extras in list(active.items()):
            if name not in by_name:
                raise ValueError('missing dependency: '+name)
            record = by_name[name]
            if not extras <= {canonical(e) for e in record['provides_extra']}:
                raise ValueError('unknown requested extra: '+name)
            for text in record['requires_dist']:
                dep, requested, spec, marker = requirement(text)
                # Do not short circuit parsing any marker, including unused extras.
                results = [marker_applies(marker,e) for e in ['']+sorted(extras)] if marker else [True]
                if not any(results):
                    continue
                if dep not in by_name or not satisfies(by_name[dep]['version'],spec):
                    raise ValueError('missing or incompatible dependency: '+dep)
                if dep not in active:
                    active[dep] = set()
                    changed = True
                added = requested-active[dep]
                active[dep].update(added)
                changed = changed or bool(added)
    if set(active) != set(by_name):
        raise ValueError('unreachable lock dependency')

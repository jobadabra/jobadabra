"""Every response schema lists every property as required, at every level (the Codex CLI behind the broker refuses one that does not).
Why (6 Nov 2026): the who-is-hiring search listed `employers` as required but also declared `portals`; Codex answered 400 "'schema.required' is
required to include every key in properties. Missing 'portals'" and 3 of 40 central-scout AI calls were lost. An answer that may be empty is an
empty list or "" in the schema, never an absent key. Covers the schemas written as module-level constants and every schema literal in src/."""
import ast
import importlib
import json
import pathlib
import unittest

SRC = pathlib.Path(__file__).resolve().parents[3] / 'src'


def missing(schema, where='$'):
    """[(path, [keys])] of objects whose `required` leaves out a declared property, at every level."""
    found = []
    if isinstance(schema, dict):
        props = schema.get('properties')
        if isinstance(props, dict):
            left = [key for key in props if key not in (schema.get('required') or [])]
            if left:
                found.append((where, left))
            for key, sub in props.items():
                found += missing(sub, f'{where}.{key}')
        for key in ('items', 'anyOf', 'oneOf', 'allOf'):
            if key in schema:
                found += missing(schema[key], f'{where}.{key}')
    elif isinstance(schema, list):
        for index, sub in enumerate(schema):
            found += missing(sub, f'{where}[{index}]')
    return found


def schema_files():
    return [path for path in sorted(SRC.rglob('*.py')) if '"properties"' in path.read_text() or "'properties'" in path.read_text()]


class EverySchemaListsEveryKeyTest(unittest.TestCase):
    def test_the_checker_sees_a_missing_key_at_any_level(self):
        deep = {'type': 'object', 'required': ['a'], 'properties': {'a': {'type': 'array', 'items': {
            'type': 'object', 'required': ['x'], 'properties': {'x': {}, 'y': {}}}}}}
        self.assertEqual(missing(deep), [('$.a.items', ['y'])])

    def test_module_level_schemas_list_every_key(self):
        checked, bad = 0, []
        for path in schema_files():
            module = importlib.import_module('src.' + '.'.join(path.relative_to(SRC).with_suffix('').parts))
            for name, value in vars(module).items():
                if isinstance(value, dict) and not name.startswith('__') and isinstance(value.get('properties'), dict):
                    checked += 1
                    bad += [(f'{module.__name__}.{name}{where[1:]}', keys) for where, keys in missing(value)]
        self.assertGreater(checked, 30, 'the discovery found the schemas')
        self.assertEqual(bad, [])

    def test_schema_files_list_every_key(self):
        files = sorted(SRC.parent.glob('tools/*.schema.json'))
        self.assertTrue(files, 'the discovery found the schema files')
        self.assertEqual([(f.name, missing(json.loads(f.read_text()))) for f in files if missing(json.loads(f.read_text()))], [])

    def test_schema_literals_inside_functions_list_every_key(self):
        bad = []
        for path in schema_files():
            for node in ast.walk(ast.parse(path.read_text())):
                if not isinstance(node, ast.Dict):
                    continue
                fields = {key.value: value for key, value in zip(node.keys, node.values) if isinstance(key, ast.Constant)}
                props, required = fields.get('properties'), fields.get('required')
                if not isinstance(props, ast.Dict) or 'type' not in fields or not isinstance(required, (ast.List, ast.Tuple)):
                    continue   # a Notion property map has no `type`/`required`; a computed `required` is covered by the module-level test
                declared = {key.value for key in props.keys if isinstance(key, ast.Constant)}
                listed = {item.value for item in required.elts if isinstance(item, ast.Constant)}
                if declared - listed and not any(not isinstance(item, ast.Constant) for item in required.elts):
                    bad.append((f'{path.relative_to(SRC)}:{node.lineno}', sorted(declared - listed)))
        self.assertEqual(bad, [])


if __name__ == '__main__':
    unittest.main()

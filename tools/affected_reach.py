"""What a file imports, transitively, and a memo of it per graph. Split out of tools/affected-tests.py (a pure move, 500-line rule, 7 Nov 2026, ts 8/8).
The graphs are built once per process (tools/affected-tests.py js_graph, py_graph), so what a file reaches, and what a test file is, does not change while the process runs."""


def closure(start, edges):
    """Every file `start` reaches through `edges` ({file: set of files it imports, or None when its imports cannot be read}); None when one of them cannot be read."""
    seen, stack = set(), [start]
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        deps = edges.get(p, set())
        if deps is None:
            return None
        stack.extend(deps)
    return seen


_BY_GRAPH = {}   # (kind, key, id(graph)) -> (graph, value): the entry holds the graph, so its id is never reused


def by_graph(kind, key, graph, make):
    """make() once per (kind, key, graph) (ts 8/8: select() asked again on every call, 77 calls in the picks test)."""
    entry = _BY_GRAPH.get((kind, key, id(graph)))
    if entry is None:
        entry = _BY_GRAPH[(kind, key, id(graph))] = (graph, make())
    return entry[1]


def reach_of(start, edges):
    """closure(start, edges), remembered for this graph."""
    return by_graph('reach', start, edges, lambda: closure(start, edges))

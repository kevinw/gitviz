import sys
import xmlrpclib
import time
import dulwich
import pydot
import subprocess
import tempfile

vertices = {}
edges = {}

def node_opts(**opts):
    opts.update(
        fontname='consolas',
        fontsize='11'
    )
    return opts

def edge_opts(**opts):
    opts.update(
        labelfontsize='11',
        labelfloat="True",
    )
    return opts

def q(s):
    return s.replace(':', r'\:')

def vertex_opts_for_obj(obj, **opts):
    opts = node_opts(**opts)

    if obj.type_name == 'commit':
        opts.update(
            label=q(obj.message),
            style='filled',
            fillcolor='#ccffcc'
        )
    elif obj.type_name == 'tree':
        opts.update(
            shape='folder',
            label='tree',
            fontsize='9',
            #shape='cube'
        )
    elif obj.type_name == 'blob':
        opts.update(
            shape='egg',
            label=q(str(obj))
        )
    else:
        opts.update(
            label=q(repr(obj))
        )

    if 'label' in opts:
        opts['label'] = opts['label'].strip()

    return opts

graph = pydot.Graph(verbose=True)

def vert_for_sha(objstore, sha, **opts):
    if isinstance(sha, pydot.Node):
        sha = sha.sha

    vert = vertices.get(sha)
    obj = objstore[sha]

    if obj.type_name == 'commit':
        shape = 'note'
    else:
        shape = 'ellipse'

    if vert is None:
        vertex_opts = vertex_opts_for_obj(obj, shape=shape)
        vert = vertices[sha] = pydot.Node(sha, **vertex_opts)
        vert.sha = sha
        graph.add_node(vert)

    vert.obj = obj
    return vert

def add_edge(a, b, **opts):
    if not isinstance(a, str): a = a.obj.sha().hexdigest()
    if not isinstance(b, str): b = b.obj.sha().hexdigest()

    edge = pydot.Edge(a, b, **edge_opts(**opts))
    graph.add_edge(edge)

    if False:
        opts.update(
            oriented = True,
            arrow = True
        )
        edge.set(**opts)

    return edge

def walk_node(objstore, seen, sha):
    vert = vert_for_sha(objstore, sha)
    if vert in seen: return

    seen.add(vert)
    obj = vert.obj

    if obj.type_name == 'tree':
        for stat, filename, sha in vert.obj.entries():
            child = vert_for_sha(objstore, sha)
            seen.add(child)
            add_edge(vert, child, label=q(filename))
            walk_node(objstore, seen, child)

    elif obj.type_name == 'commit':
        tree = obj.tree
        tree_vert = vert_for_sha(objstore, obj.tree)
        walk_node(objstore, seen, tree)
        add_edge(vert, tree_vert)

        for parent_sha in obj.parents:
            parent_vert = vert_for_sha(objstore, parent_sha)
            add_edge(vert, parent_vert)
            walk_node(objstore, seen, parent_sha)

def sync_shas(repo):
    objstore = repo.object_store

    seen = set()

    for sha in objstore:
        walk_node(objstore, seen, sha)

    for sha, vert in vertices.items():
        if vert not in seen:
            assert vertices[sha] is vert
            del vertices[sha]
            vert.destroy()

    for ref in repo.refs.keys():
        if ref.startswith('refs/heads'):
            label = ref[11:]
        else:
            label = ref
        nopts = node_opts(label=label, shape='diamond', style='filled')
        if ref == 'HEAD':
            nopts['fillcolor'] = '#ff3333'
        head_node = pydot.Node(ref, **nopts)
        graph.add_node(head_node)
        try:
            graph.add_edge(pydot.Edge(head_node, repo.refs[ref], **edge_opts(style='dotted')))
        except KeyError:
            if ref == 'HEAD':
                pass

    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(graph.to_string())

    subprocess.call(['dot', '-Txdot', f.name])

def emit_git_tree(repo_dir):
    repo = dulwich.repo.Repo(repo_dir)

    sync_shas(repo)

def main(repo_Dir):
    emit_git_tree(repo_dir)

if __name__ == '__main__':
    repo_dir = sys.argv[1]
    main(repo_dir)

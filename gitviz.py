import sys
import xmlrpclib
import time
import dulwich
import pydot
import subprocess
import tempfile

vertices = {}
edges = {}

def q(s):
    return s.replace(':', r'\:')

def vertex_opts_for_obj(obj):
    opts = dict(
    )

    if obj.type_name == 'commit':
        opts.update(
            label=q(obj.type_name + ': ' + obj.message)
        )
    elif obj.type_name == 'tree':
        opts.update(
            label='tree',
            #shape='cube'
        )
    else:
        opts.update(
            #shape='sphere',
            label=q('blob:'+obj.sha().hexdigest()[:7])
        )

    if 'label' in opts:
        opts['label'] = opts['label'].strip()

    return opts

graph = pydot.Graph(verbose=True)

def vert_for_sha(objstore, sha):
    if isinstance(sha, pydot.Node):
        sha = sha.sha

    vert = vertices.get(sha)
    obj = objstore[sha]
    if vert is None:
        vertex_opts = vertex_opts_for_obj(obj)
        vert = vertices[sha] = pydot.Node(sha, **vertex_opts)
        vert.sha = sha
        graph.add_node(vert)

    vert.obj = obj
    return vert

def add_edge(a, b, **opts):
    if not isinstance(a, str): a = a.obj.sha().hexdigest()
    if not isinstance(b, str): b = b.obj.sha().hexdigest()

    edge = pydot.Edge(a, b, **opts)
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
            add_edge(parent_vert, vert)
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

    head = repo.head()
    head_node = pydot.Node('HEAD', label='HEAD', shape='box', style='filled')
    graph.add_node(head_node)
    graph.add_edge(pydot.Edge(head_node, head, style='dotted'))


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

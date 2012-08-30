import sys
import xmlrpclib
import time
import ubigraph
import pydot

U = ubigraph.Ubigraph()
U.clear()

vertices = {}
edges = {}

def vertex_opts_for_obj(obj):
    opts = dict(
        size = 2.0,
        fontsize = 15
    )

    if obj.type_name == 'commit':
        opts.update(
            color="#ff0000",
            shape='octahedron',
            label=obj.message
        )
    elif obj.type_name == 'tree':
        opts.update(
            label='',
            shape='cube'
        )
    else:
        opts.update(
            shape='sphere',
            label=repr(obj)
        )

    return opts

def vert_for_sha(objstore, sha):
    if isinstance(sha, ubigraph.Vertex):
        sha = sha.obj.sha().hexdigest()

    vert = vertices.get(sha)
    obj = objstore[sha]
    if vert is None:
        vert = vertices[sha] = U.newVertex(**vertex_opts_for_obj(obj))

    vert.obj = obj
    return vert

def add_edge(a, b, **opts):
    edge_key = a.obj.sha().hexdigest() + '_' + b.obj.sha().hexdigest()
    edge = edges.get(edge_key)
    if edge is None:
        edge = U.newEdge(a, b)

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
            add_edge(vert, child, label=filename)
            walk_node(objstore, seen, child)

    elif obj.type_name == 'commit':
        for parent_sha in obj.parents:
            parent_vert = vert_for_sha(objstore, parent_sha)
            add_edge(parent_vert, vert)
            walk_node(objstore, seen, parent_sha)

            tree = obj.tree
            tree_vert = vert_for_sha(objstore, obj.tree)
            walk_node(objstore, seen, tree)
            add_edge(vert, tree_vert)

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

    render_dot()

def emit_git_tree(repo_dir):
    import dulwich
    repo = dulwich.repo.Repo(repo_dir)

    sync_shas(repo)

def main(repo_Dir):
    emit_git_tree(repo_dir)

if __name__ == '__main__':
    repo_dir = sys.argv[1]
    main(repo_dir)

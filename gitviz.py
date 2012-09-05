'''
Reads the contents of a git repository and write a DOT graph file to stdout.
'''

import sys
import dulwich.repo
import pydot
import subprocess
import tempfile

MAX_NODES = 50
MAX_BLOB = 200

vertices = {}

def node_opts(**opts):
    '''Display options for vertices.'''

    opts.update(
        fontname='consolas',
        fontsize='11'
    )
    return opts

def edge_opts(**opts):
    '''Display options for edges.'''

    opts.update(
        labelfontsize='11',
        labelfloat="False",
    )
    return opts

def q(s):
    '''pydot seems to not be quoting colons in labels, even though not doing
    so apparently results in invalid DOT files. quote them here.'''

    return s.replace(':', r'\:')

def vertex_opts_for_obj(obj, **opts):
    '''Return pydot display options for a git repository object.'''

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
        label = q(str(obj).decode('ascii', 'ignore').replace('\0', '').replace('\n', '\\n')[:MAX_BLOB])
        opts.update(
            shape='egg',
            label=label
        )
    else:
        opts.update(
            label=q(repr(obj))
        )

    if 'label' in opts:
        opts['label'] = opts['label'].strip()

    return opts

graph = pydot.Graph(verbose=True) # TODO: globals are bad mmmmkay

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

def to_sha(vert):
    if not isinstance(vert, str):
        return vert.obj.sha().hexdigest()

    return vert

def add_edge(a, b, **opts):
    edge = pydot.Edge(to_sha(a), to_sha(b), **edge_opts(**opts))
    graph.add_edge(edge)
    return edge

def walk_node(objstore, seen, sha):
    vert = vert_for_sha(objstore, sha)
    if vert in seen: return

    seen.add(vert)
    obj = vert.obj

    # TODO: visitor pattern with polymorphism instead plz
    if obj.type_name == 'tree':
        for stat, filename, sha in vert.obj.entries():
            child = vert_for_sha(objstore, sha)
            seen.add(child)
            add_edge(vert, child, label=q(filename))
            walk_node(objstore, seen, child)

    elif obj.type_name == 'commit':
        tree = obj.tree
        tree_vert = vert_for_sha(objstore, obj.tree)
        seen.add(tree_vert)
        walk_node(objstore, seen, tree)
        add_edge(vert, tree_vert)

        for parent_sha in obj.parents:
            parent_vert = vert_for_sha(objstore, parent_sha)
            seen.add(parent_vert)
            add_edge(vert, parent_vert)
            walk_node(objstore, seen, parent_sha)

def emit_repo_as_xdot(repo):
    '''emit xdot on stdout'''

    objstore = repo.object_store
    seen = set()

    # walk everything in the object store. (this means orphaned nodes will show.)
    for sha in objstore:
        walk_node(objstore, seen, sha)

    for ref in repo.refs.keys():
        if ref == 'HEAD':
            continue # TODO: let this loop handle symbolic refs too

        nopts = node_opts(label=nice_ref_label(ref), shape='diamond', style='filled')
        head_node = pydot.Node(ref, **nopts)
        graph.add_node(head_node)
        graph.add_edge(pydot.Edge(head_node, repo.refs[ref], **edge_opts(style='dotted')))

    # do HEAD as a special case
    ref = 'HEAD'
    nopts = node_opts(label=ref, shape='diamond', style='filled', fillcolor='#ff3333', fontcolor='white')
    head_node = pydot.Node(ref, **nopts)
    graph.add_node(head_node)
    symref = repo.refs.read_ref(ref)
    if symref.startswith('ref: '):
        symref = symref[5:]
    graph.add_edge(pydot.Edge(head_node, symref, **edge_opts(style='dotted')))

    # invoke dot -Txdot to turn out DOT file into an xdot file, which canviz is expecting
    subprocess.Popen(['dot', '-Txdot'], stdin=subprocess.PIPE).communicate(graph.to_string())

def nice_ref_label(ref):
    if ref.startswith('refs/heads'):
        label = ref[11:]
    elif ref.startswith('refs/remotes'):
        label = 'remote: ' + ref[13:]
    else:
        label = ref

    return label

def main(repo_dir):
    emit_repo_as_xdot(dulwich.repo.Repo(repo_dir))

if __name__ == '__main__':
    repo_dir = sys.argv[1]
    main(repo_dir)

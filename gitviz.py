'''
Reads the contents of a git repository and write a DOT graph file to stdout.
'''

import sys
import dulwich.repo
import dulwich.index
import dulwich.objects
import pydot
import subprocess
import tempfile

MAX_NODES = 50
MAX_BLOB = 200

vertices = {}

def node_opts(**opts):
    '''Display options for vertices.'''

    opts.update(
        fontname='Monaco',
        fontsize='8'
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
            shape='note',
            fillcolor='#ccffcc'
        )
    elif obj.type_name == 'tree':
        opts.update(
            shape='folder',
            label='tree',
            fontsize='9',
        )
    elif obj.type_name == 'blob':
        label = q(str(obj).decode('ascii', 'ignore').replace('\0', '').replace('\n', '\\n')[:MAX_BLOB])
        opts.update(
            labeljust='L',
            shape='egg',
            label=label
        )
    else:
        opts.update(
            shape='ellipse',
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

    if vert is None:
        vertex_opts = vertex_opts_for_obj(obj)
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

def walk_node(objstore, seen, sha, options):
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
            walk_node(objstore, seen, child, options)

    elif obj.type_name == 'commit':
        tree = obj.tree
        tree_vert = vert_for_sha(objstore, obj.tree)
        seen.add(tree_vert)
        walk_node(objstore, seen, tree, options)
        add_edge(vert, tree_vert)

        for parent_sha in obj.parents:
            parent_vert = vert_for_sha(objstore, parent_sha)
            seen.add(parent_vert)
            add_edge(vert, parent_vert)
            walk_node(objstore, seen, parent_sha, options)

def emit_repo_as_xdot(repo, options):
    '''emit xdot on stdout'''

    objstore = repo.object_store
    seen = set()

    # walk everything in the object store. (this means orphaned nodes will show.)
    for sha in objstore:
        if not options.blobs and objstore[sha].type_name == 'blob':
            continue
        walk_node(objstore, seen, sha, options)

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

    # index
    try:
        head_tree = repo['HEAD'].tree
    except KeyError:
        head_tree = None

    index = repo.open_index()

    try:
        changes = list(index.changes_from_tree(objstore, head_tree))
    except TypeError:
        # the official dulwich repo throws a TypeError changes_from_tree is
        # called against an empty tree (None)
        if head_tree is not None: raise
        changes = []

    if changes:
        index_node = pydot.Node('index', shape='invtriangle', style='filled', fillcolor='#33ff33')
        graph.add_node(index_node)
        for (oldpath, newpath), (oldmode, newmode), (oldsha, newsha) in changes:
            graph.add_edge(pydot.Edge(index_node, vert_for_sha(objstore, newsha), label=q(newpath)))

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

def main(repo_dir, options):
    emit_repo_as_xdot(dulwich.repo.Repo(repo_dir), options)


if __name__ == '__main__':
    from optparse import OptionParser
    parser = OptionParser()
    parser.add_option("--no-blobs",
                      action="store_false", dest="blobs", default=True,
                      help="don't show blobs")
    options, args = parser.parse_args()

    repo_dir = args[0]
    main(repo_dir, options)

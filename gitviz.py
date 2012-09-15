'''
Reads the contents of a git repository and write a DOT graph file to stdout.
'''

import dulwich.repo
import dulwich.index
import dulwich.objects
import pydot
import subprocess

DEFAULT_FONTNAME = 'Monaco'
DEFAULT_FONTSIZE = '8'

BLOB_CONTENT_LIMIT = 200 # show at most this many bytes of blob content

DEFAULT_FONT = dict(fontname=DEFAULT_FONTNAME, fontsize=DEFAULT_FONTSIZE)


def emit_repo_as_xdot(repo, options):
    '''Emits xdot for the given repo on stdout.'''

    global graph # TODO: globals are bad mmmmkay
    global vertices

    vertices = {}

    graph = pydot.Graph(verbose=True)
    graph.set_bgcolor('#00000000') # transparent background

    objstore = repo.object_store
    seen = set()

    # walk everything in the object store. (this means orphaned nodes will show.)
    for sha in objstore:
        if not options.blobs and objstore[sha].type_name in ('blob', 'tree'):
            continue
        walk_node(objstore, seen, sha, options)

    for ref in repo.refs.keys():
        if ref == 'HEAD': continue # TODO: let this loop handle symbolic refs too
        branch_node = add_branch_node(ref)
        graph.add_edge(pydot.Edge(branch_node, repo.refs[ref], **edge_opts(style='dotted')))

    # do HEAD as a special case
    ref = 'HEAD'
    nopts = node_opts(label=ref, shape='diamond', style='filled', fillcolor='#ff3333', fontcolor='white', tooltip='Symbolic Ref: HEAD')
    head_node = pydot.Node(ref, **nopts)
    graph.add_node(head_node)

    symref = repo.refs.read_ref(ref)
    if symref.startswith('ref: '):
        symref = symref[5:]
    points_to = add_branch_node(symref)
    graph.add_node(points_to)
    graph.add_edge(pydot.Edge(head_node, add_branch_node(symref), **edge_opts(style='dotted')))

    # index
    if options.index:
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
        index_node = pydot.Node('index', shape='invtriangle', style='filled', fillcolor='#33ff33', fontname=DEFAULT_FONTNAME, fontsize=DEFAULT_FONTSIZE)
        graph.add_node(index_node)
        for (oldpath, newpath), (oldmode, newmode), (oldsha, newsha) in changes:
            graph.add_edge(pydot.Edge(index_node, vert_for_sha(objstore, newsha), label=q('  ' + newpath), fontname=DEFAULT_FONTNAME, fontsize=DEFAULT_FONTSIZE))

    # invoke dot -Txdot to turn out DOT file into an xdot file, which canviz is expecting
    subprocess.Popen(['dot', '-Txdot'], stdin=subprocess.PIPE).communicate(graph.to_string())

def vert_for_sha(objstore, sha, **opts):
    if isinstance(sha, pydot.Node):
        sha = sha.sha

    vert = vertices.get(sha)

    try:
        obj = objstore[sha]
    except KeyError:
        return None

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
    if vert is None or vert in seen: return

    seen.add(vert)
    obj = vert.obj

    # TODO: visitor pattern with polymorphism instead plz
    if obj.type_name == 'tree':
        if options.blobs:
            for stat, filename, sha in vert.obj.entries():
                child = vert_for_sha(objstore, sha)
                if child is not None:
                    add_edge(vert, child, label=q('  ' + filename))
                    walk_node(objstore, seen, child, options)

    elif obj.type_name == 'commit':
        if options.blobs:
            tree = obj.tree
            tree_vert = vert_for_sha(objstore, obj.tree)
            if tree_vert is not None:
                walk_node(objstore, seen, tree, options)
                seen.add(tree_vert)
                add_edge(vert, tree_vert, weight='1')

        num_parents=len(obj.parents)
        for i, parent_sha in enumerate(obj.parents):
            parent_vert = vert_for_sha(objstore, parent_sha)
            weight = num_parents - i + 1
            add_edge(vert, parent_vert, weight='%s' % weight)
            walk_node(objstore, seen, parent_sha, options)

def add_branch_node(ref):
    nopts = node_opts(
        label=nice_ref_label(ref),
        shape='diamond',
        style='filled',
        tooltip='Branch: %s' % nice_ref_label(ref))

    node = pydot.Node(ref, **nopts)
    graph.add_node(node)
    return node

def node_opts(**opts):
    'Display options for vertices.'

    opts.update(DEFAULT_FONT)
    return opts

def edge_opts(**opts):
    'Display options for edges.'

    opts.update(labelfontsize='11', labelfloat="False", **DEFAULT_FONT)
    return opts

def q(s):
    '''pydot seems to not be quoting colons in labels, even though not doing
    so apparently results in invalid DOT files. quote them here.'''

    return s.replace(':', r'\:')

def get_blob_content(obj):
    "Return the first part of a blob's content for its the label."

    blob_content = str(obj).decode('ascii', 'ignore') # TODO: does utf8 just work?
    blob_content = blob_content.replace('\0', '').replace('\n', '\\n')
    return blob_content[:BLOB_CONTENT_LIMIT]

def vertex_opts_for_obj(obj, **opts):
    'Return pydot display options for a git repository object.'

    opts = node_opts(**opts)

    def shortsha():
        return q(obj.sha().hexdigest()[:20])

    if obj.type_name == 'commit':
        opts.update(
            label=q(obj.message),
            style='filled',
            shape='note',
            fillcolor='#ccffcc',
            tooltip='Commit: ' + shortsha()
        )
    elif obj.type_name == 'tree':
        opts.update(
            shape='folder',
            label='tree',
            fontcolor='#a0a0a0',
            style='filled',
            fillcolor='#ffffff',
            tooltip='Tree: ' + shortsha()
        )
    elif obj.type_name == 'blob':
        label = q(get_blob_content(obj))
        opts.update(
            style='filled',
            fillcolor='#ffffff',
            shape='ellipse',
            label=label,
            tooltip='Blob: ' + shortsha()
        )
    else:
        opts.update(
            shape='ellipse',
            label=q(repr(obj)),
            style='filled',
            fillcolor='#ffffff'
        )

    if 'label' in opts:
        opts['label'] = opts['label'].strip()

    return opts

def nice_ref_label(ref):
    'Formats a ref to be more readable for the graph.'

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
    parser.add_option("--no-index",
                      action="store_false", dest="index", default=True,
                      help="don't show the index")
    options, args = parser.parse_args()

    repo_dir = args[0]
    main(repo_dir, options)

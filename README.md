gitviz
======

Visualize git repositories as they change, live in the browser.

![gitvize screenshot](https://github.com/kevinw/gitviz/raw/master/docs/examples/gitviz_example.png)

Why?
----

gitviz might be useful as a teaching tool for git.

It draws graphviz graphs on &lt;canvas&gt; elements, and updates them as you modify the target git repository on the fly.

Requirements
------------

 You need Python, Node.js, npm, and a git repository.

Installation
------------

    # get code
    git clone git://github.com/kevinw/gitviz.git

    # start the webserver
    cd gitviz
    ./run-server PATH_TO_REPOS # where PATH_TO_REPOS is the path above your repositories

    # see live graphs in the browser
    open http://localhost:3000/reponame

Libraries
---------

gitviz is just glue around lots of great libraries:

 * [dulwich](http://www.samba.org/~jelmer/dulwich/) reads your git repositories as graphs
 * [pydot](http://code.google.com/p/pydot/) emits those graphs as DOT language
 * [canviz](http://code.google.com/p/canviz/) draws DOT language as visual graphs in &lt;canvas&gt; tags in the browser
 * [express](http://expressjs.com/) serves the webpage showing the graph
 * [socket.io](http://socket.io/) notifies the browser in realtime when the graph changes

TODO
----

* The node library "watch" we're using uses polling under the hood. There are definitely better alternatives that hook into filesystem events.
* Animate the graph when it changes.
* Show working copy modifications. Maybe an asterisk next to the blobs that differ?
* Eliminate bottlenecks for non-toy-sized repositories, and make them navigable/intelligible in some way.
* Make the graph interactive, or somehow have each node show the git command that made it.

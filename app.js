/**
 * webapp serving graph pages and DOT files
 */

var fs = require('fs'),
    path = require('path'),
    express = require('express'),
    http = require('http'),
    path = require('path');

var WATCH_INTERVAL_MS = 300;

if (process.argv.length !== 3)
    throw "usage: node app.js REPOS_ROOT # (where REPOS_ROOT is the directory above your repositories)";

var ROOT = process.argv[2];
var DEFAULT_REPO = 'testrepo';

if (!dirExistsSync(ROOT))
    throw 'not existing:'+ROOT;

var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'hjs');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

function graphPage(req, res) {
    var repo = req.params['repo'] || 'testrepo';
    res.render('index', {repo: repo});
};

app.get('/', function(req, res) {
    res.redirect(DEFAULT_REPO);
});

app.get('/:repo/graph', function(req, res, next) {
    var repo = req.params.repo;
    if (!repo) throw 'no repo given: ' + repo;

    watchRepo(repo);
    repo = path.join(ROOT, repo);
    console.log("REPO", repo);
    var gitviz = require('child_process').spawn('python', ['gitviz.py', repo]);

    var s = '';
    var stderr_data = '';
    gitviz.stdout.on('data', function(data) { s = s + data.toString(); });
    gitviz.stderr.on('data', function(data) {
        stderr_data = stderr_data + data.toString();
        console.error('gitviz stderr:', data.toString());
    });
    gitviz.on('exit', function(code) {
        if (code !== 0)
            return res.send(500, stderr_data);

        res.setHeader('Content-Type', 'text/plain');
        res.end(s);
    });
});

app.get('/:repo', graphPage);

var server = http.createServer(app);

var io = require('socket.io').listen(server);

server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

var _watched ={};
function watchRepo(repo) {
    if (_watched[repo]) return;
    _watched[repo] = true;

    var repodir = path.join(ROOT, repo);
    if (!dirExistsSync(repodir))
        throw 'not existing: ' + repodir;

    require('watch').watchTree(repodir, {interval: WATCH_INTERVAL_MS}, function() {
        onChange(repo);
    });
}

var timeouts = {};
function onChange(repo) {
    if (timeouts[repo]) return;
    timeouts[repo] = setTimeout(function() {
        timeouts[repo] = null;
        console.log("REPO CHANGED", repo);
        io.sockets.emit('change:' + repo);
    }, 100);
}

io.sockets.on('connection', function(socket) {
});

function dirExistsSync (d) {
  try { return fs.statSync(d).isDirectory(); }
  catch (er) { return false; }
}


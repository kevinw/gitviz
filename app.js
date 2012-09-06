/**
 * webapp serving graph pages and DOT files
 */

var fs = require('fs'),
    path = require('path'),
    express = require('express'),
    http = require('http'),
    path = require('path'),
    async = require('async'),
    gitutil = require('gitutil');

// ensure that we're using our local dulwich repo, which has fixes we need
var pythonPathSep = process.platform === 'win32' ? ";" : ":";
process.env.PYTHONPATH = [path.join(__dirname, 'dulwich'), process.env.PYTHONPATH].join(pythonPathSep);

var WATCH_INTERVAL_MS = 300;
var ROOT;
var io;
var DEFAULT_REPO = 'testrepo';

var app = express();

require('./handlebars-helpers.js')(require('hbs'));

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'hbs');
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
    res.render('repo', {repo: repo});
};

app.get('/', function(req, res, next) {
    gitutil.listRepos(ROOT, function(err, repos) {
        if (err) return next(err);
        res.render('index', {repos: repos});
    });
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

var _watched ={};
function watchRepo(repo) {
    if (_watched[repo]) return;
    _watched[repo] = true;

    var repodir = path.join(ROOT, repo);
    if (!dirExistsSync(repodir))
        throw 'The repository root you provided does not not exist: ' + repodir;

    require('watch').watchTree(repodir, {interval: WATCH_INTERVAL_MS}, function() {
        onChange(repo);
    });
}

var timeouts = {};
function onChange(repo) {
    if (timeouts[repo]) return;
    timeouts[repo] = setTimeout(function() {
        timeouts[repo] = null;
        io.sockets.emit('change:' + repo);
    }, 100);
}

function dirExistsSync (d) {
  try { return fs.statSync(d).isDirectory(); }
  catch (er) { return false; }
}

if (require.main === module) {
    if (process.argv.length !== 3)
        throw "usage: node app.js REPOS_ROOT # (where REPOS_ROOT is the directory above your repositories)";

    ROOT = process.argv[2];
    if (!dirExistsSync(ROOT))
        throw 'not existing:'+ROOT;

    var server = http.createServer(app);

    io = require('socket.io').listen(server);

    server.listen(app.get('port'), function(){
      console.log("Express server listening on port " + app.get('port'));
    });
}

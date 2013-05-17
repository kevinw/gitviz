/**
 * webapp serving graph pages and DOT files
 */

var fs = require('fs'),
    path = require('path'),
    express = require('express'),
    http = require('http'),
    path = require('path'),
    async = require('async'),
    gitutil = require('./gitutil');

// ensure that we're using our local dulwich repo, which has fixes we need
var pythonPathSep = process.platform === 'win32' ? ";" : ":";
process.env.PYTHONPATH = [path.join(__dirname, 'dulwich'), process.env.PYTHONPATH].join(pythonPathSep);

var PRINT_DIFFS = true;
var WATCH_INTERVAL_MS = 500;
var ROOT;
var io;
var DEFAULT_REPO = 'testrepo';

var app = express();

require('./handlebars-helpers.js')(require('hbs'));

app.configure(function() {
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

function spawn(cmd, args, opts, cb) {
    if (cb === undefined && typeof opts === 'function') {
        cb = opts;
        opts ={};
    }

    var proc = require('child_process').spawn(cmd, args);

    var stdoutString = '';
    if (opts.stdout === 'pipe')
        proc.stdout.pipe(process.stdout, {end: false});
    else
        proc.stdout.on('data', function(data) { stdoutString += data.toString(); });

    if (opts.stderr === 'pipe')
        proc.stdout.pipe(process.stderr, {end: false});

    if (cb)
        proc.on('exit', function(code) {
            if (code !== 0)
                return cb(cmd + ': non-zero return code ' + code);

            var ret = {code: code};
            if (opts.stdout !== 'pipe')
                ret.stdout = stdoutString;

            cb(null, ret);
        });
}

app.get('/:repo/graph', function(req, res, next) {
    var repo = req.params.repo;
    if (!repo) throw 'no repo given: ' + repo;

    watchRepo(repo);
    repo = path.join(ROOT, repo);
    console.log("REPO", repo);

    var extraArgs = [];
    if (req.query.blobs === 'false')
        extraArgs.push('--no-blobs');

    spawn('python', ['gitviz.py', repo].concat(extraArgs), {stderr: 'pipe'}, function(err, procRes) {
        if (err) return res.send(500, err);
        var dotOutput = procRes.stdout;
        if (PRINT_DIFFS)
            process.nextTick(function() { printDiff(dotOutput); });
        res.setHeader('Content-Type', 'text/plain');
        res.end(dotOutput);
    });
});

app.get('/:repo', graphPage);

var lastOutputFile = '/tmp/lastGitvizOutput.dot',
    newOutputFile  = '/tmp/newGitvizOutput.dot';

function printDiff(output) {
    if (fs.existsSync(lastOutputFile)) {
        fs.writeFileSync(newOutputFile, output);
        spawn('git', ['diff', '--color-words', '--no-index', lastOutputFile, newOutputFile], {stdout: 'pipe'});
    }

    fs.writeFileSync(lastOutputFile, output);
}

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

function compileCanviz(cb) {
    var buildCanviz = require('child_process').spawn('./build-canviz');
    buildCanviz.stdout.on('data', function(data) { console.log(data.toString()); });
    buildCanviz.stderr.on('data', function(data) { console.error(data.toString()); });
    buildCanviz.on('exit', function(code) {
        if (code !== 0)
            return cb("error building canviz");

        cb(null);
    });
}

if (require.main === module) {
    if (process.argv.length !== 3)
        throw "usage: node app.js REPOS_ROOT # (where REPOS_ROOT is the directory above your repositories)";

    ROOT = process.argv[2];
    if (!dirExistsSync(ROOT))
        throw 'not existing:'+ROOT;

    compileCanviz(function(err) {
        if (err) throw err;

        var server = http.createServer(app);
        io = require('socket.io').listen(server);
        server.listen(app.get('port'), function(){
          console.log("giviz listening on port " + app.get('port'));
        });
    });
}

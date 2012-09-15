/**
 * webapp serving graph pages and DOT files
 */

var fs = require('fs'),
    path = require('path'),
    express = require('express'),
    http = require('http'),
    gitutil = require('./gitutil');

require('./handlebars-helpers.js')(require('hbs'));

// ensure that we're using our local dulwich repo, which has fixes we need
var pythonPathSep = process.platform === 'win32' ? ";" : ":";
process.env.PYTHONPATH = [path.join(__dirname, 'dulwich'), process.env.PYTHONPATH].join(pythonPathSep);

var PRINT_DIFFS = false,
    WATCH_INTERVAL_MS = 500;

var ROOT; // where to list repos from

var app = express();

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

app.get('/:repo', function(req, res) {
    var repo = req.params['repo'] || 'testrepo';
    res.render('repo', {repo: repo});
});

/**
 * for debugging: print the difference between the last DOT output and this one
 */
function printDiff(output) {
    var lastOutputFile = '/tmp/lastGitvizOutput.dot',
        newOutputFile  = '/tmp/newGitvizOutput.dot';

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
        app.get('io').sockets.emit('change:' + repo);
    }, 100);
}

function dirExistsSync (d) {
  try { return fs.statSync(d).isDirectory(); }
  catch (er) { return false; }
}

function spawn(cmd, args, opts, cb) {
    if (arguments.length === 2) {
        cb = args;
        args = [];
        opts = {};
    } else if (arguments.length === 3) {
        cb = opts;
        opts = {};
    }

    var proc = require('child_process').spawn(cmd, args);

    var stdoutString = '';
    if (opts.stdout === 'pipe')
        proc.stdout.pipe(process.stdout, {end: false});
    else
        proc.stdout.on('data', function(data) { stdoutString += data.toString(); });

    if (opts.stderr === 'pipe')
        proc.stdout.pipe(process.stderr, {end: false});

    if (!cb) return;

    proc.on('exit', function(code) {
        if (code !== 0)
            return cb(cmd + ': non-zero return code ' + code);

        var ret = {code: code};
        if (opts.stdout !== 'pipe')
            ret.stdout = stdoutString;

        cb(null, ret);
    });
}

if (require.main === module) {
    if (process.argv.length !== 3)
        throw "usage: node app.js REPOS_ROOT # (where REPOS_ROOT is the directory above your repositories)";

    ROOT = process.argv[2];
    if (!dirExistsSync(ROOT))
        throw 'not existing:'+ROOT;

    spawn('./build-canviz', function(err) {
        if (err) throw err;

        var server = http.createServer(app);
        app.set('io', require('socket.io').listen(server));
        server.listen(app.get('port'), function(){
          console.log("Express server listening on port " + app.get('port'));
        });
    });
}

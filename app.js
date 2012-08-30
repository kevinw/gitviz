
/**
 * Module dependencies.
 */

var REPO = '/Users/kevin/src/testrepo';

var express = require('express')
  , routes = require('./routes')
  , http = require('http')
  , path = require('path');

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

app.get('/', routes.index);
app.get('/graph', function(req, res, next) {
    var gitviz = require('child_process').spawn('python', ['gitviz.py', REPO]);

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

var server = http.createServer(app);

var io = require('socket.io').listen(server);

server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

var watch = require('watch');
var timeout;
watch.watchTree(REPO, {interval: 200}, onChange);

function onChange() {
    console.log('CHANGE');
    if (timeout) return;
    timeout = setTimeout(function() {
        timeout = null;
        console.log("REPO CHANGE");
        io.sockets.emit('change');
    }, 100);
}


io.sockets.on('connection', function(socket) {
    onChange();
});

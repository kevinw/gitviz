
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

var server = http.createServer(app);

var io = require('socket.io').listen(server);

server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

var watch = require('watch');
var timeout;
watch.watchTree(REPO, {interval: 200}, function() {
    console.log('CHANGE');
    if (timeout) return;
    timeout = setTimeout(function() {
        timeout = null;
        console.log("REPO CHANGE");
        io.sockets.emit('change');
    }, 100);

});

io.sockets.on('connection', function(socket) {
    console.log('got connection!');
});

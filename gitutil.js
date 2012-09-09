var fs = require('fs'),
    path = require('path');

var isGitDir = exports.isGitDir = function(fullPath) {
    var gitDir = path.join(fullPath, '.git');

    // check for a normal repository
    if (fs.existsSync(gitDir))
        return true;

    // check for a bare repository
    var bareRepoDirs = ['hooks', 'info', 'objects', 'refs'].map(function(f) {
        return fs.existsSync(path.join(fullPath, f));
    });

    return bareRepoDirs.every(function(f) { return f; });
};

exports.listRepos = function(root, callback) {
    fs.readdir(root, function(err, files) {
        if (err) return callback(err);

        var repos = files
            .map(function(f) { return {name: f, path: path.join(root, f)}; })
            .filter(function(info) { return isGitDir(info.path); });

        callback(null, repos);
    });
};


var fs = require('fs'),
    hbs = require('hbs');

module.exports = function(hbs) {
    var blocks = {};

    hbs.registerHelper('extend', function(name, context) {
        var block = blocks[name];
        if (!block) {
            block = blocks[name] = [];
        }

        block.push(context.fn(this));
    });

    hbs.registerHelper('block', function(name) {
        var val = (blocks[name] || []).join('\n');

        // clear the block
        blocks[name] = [];
        return val;
    });
};

// Register any partials
var partialsDir = __dirname + '/views/partials';
if (fs.existsSync(partialsDir)) {
    fs.readdirSync(partialsDir).forEach(function(filename) {
        var partial = filename.slice(0, -4);
        hbs.registerPartial(partial, fs.readFileSync(__dirname + '/views/partials/' + filename).toString());
    });;
}

(function(exports) {

var debug = exports.debug = function(str, escape) {
	str = String(str);
	if ('undefined' === typeof escape) {
		escape = true;
	}
	if (escape) {
		str = str.escapeHTML();
	}
	$('debug_output').innerHTML += '&raquo;' + str + '&laquo;<br />';
};

var Point = exports.Point = function(x, y) {
		this.x = x;
		this.y = y;
};
Point.prototype = {
	constructor: Point,
	offset: function(dx, dy) {
		this.x += dx;
		this.y += dy;
		return this;
	},
	distanceFrom: function(point) {
		var dx = this.x - point.x;
		var dy = this.y - point.y;
		return Math.sqrt(dx * dx + dy * dy);
	},
	makePath: function(ctx) {
		ctx.moveTo(this.x, this.y);
		ctx.lineTo(this.x + .05, this.y);
	}
};


var Bezier = exports.Bezier = function(points) {
		this.points = points;
		this.order = points.length;
};
Bezier.prototype = {
	constructor: Bezier,
	reset: function() {
		with (Bezier.prototype) {
			this.controlPolygonLength = controlPolygonLength;
			this.chordLength = chordLength;
			this.triangle = triangle;
			this.chordPoints = chordPoints;
			this.coefficients = coefficients;
		}
	},
	offset: function(dx, dy) {
		var pointsLength = this.points.length;
		for (var i = 0; i < pointsLength; ++i) {
		    this.points[i].offset(dx, dy);
		}
		this.reset();
		return this;
	},
	getBB: function() {
		if (!this.order) return undefined;
		var l, t, r, b, point = this.points[0];
		l = r = point.x;
		t = b = point.y;
		var pointsLength = this.points.length;
		for (var i = 1; i < pointsLength; ++i) {
			point = this.points[i];
			l = Math.min(l, point.x);
			t = Math.min(t, point.y);
			r = Math.max(r, point.x);
			b = Math.max(b, point.y);
		}
		var rect = new Rect(l, t, r, b);
		return (this.getBB = function() {return rect;})();
	},
	isPointInBB: function(x, y, tolerance) {
		if ('undefined' === typeof tolerance) tolerance = 0;
		var bb = this.getBB();
		if (0 < tolerance) {
			bb = Object.clone(bb);
			bb.inset(-tolerance, -tolerance);
		}
		return !(x < bb.l || x > bb.r || y < bb.t || y > bb.b);
	},
	isPointOnBezier: function(x, y, tolerance) {
		if ('undefined' === typeof tolerance) tolerance = 0;
		if (!this.isPointInBB(x, y, tolerance)) return false;
		var segments = this.chordPoints();
		var segmentsLength = segments.length;
		var p1 = segments[0].p;
		var p2, x1, y1, x2, y2, bb, twice_area, base, height;
		for (var i = 1; i < segmentsLength; ++i) {
			p2 = segments[i].p;
			x1 = p1.x;
			y1 = p1.y;
			x2 = p2.x;
			y2 = p2.y;
			bb = new Rect(x1, y1, x2, y2);
			if (bb.isPointInBB(x, y, tolerance)) {
				twice_area = Math.abs(x1 * y2 + x2 * y + x * y1 - x2 * y1 - x * y2 - x1 * y);
				base = p1.distanceFrom(p2);
				height = twice_area / base;
				if (height <= tolerance) return true;
			}
			p1 = p2;
		}
		return false;
	},
	// Based on Oliver Steele's bezier.js library.
	controlPolygonLength: function() {
		var len = 0;
		var order = this.order;
		for (var i = 1; i < order; ++i) {
			len += this.points[i - 1].distanceFrom(this.points[i]);
		}
		return (this.controlPolygonLength = function() {return len;})();
	},
	// Based on Oliver Steele's bezier.js library.
	chordLength: function() {
		var len = this.points[0].distanceFrom(this.points[this.order - 1]);
		return (this.chordLength = function() {return len;})();
	},
	// From Oliver Steele's bezier.js library.
	triangle: function() {
		var upper = this.points;
		var m = [upper];
		var order = this.order;
		for (var i = 1; i < order; ++i) {
			var lower = [];
			for (var j = 0; j < order - i; ++j) {
				var c0 = upper[j];
				var c1 = upper[j + 1];
				lower[j] = new Point((c0.x + c1.x) / 2, (c0.y + c1.y) / 2);
			}
			m.push(lower);
			upper = lower;
		}
		return (this.triangle = function() {return m;})();
	},
	// Based on Oliver Steele's bezier.js library.
	triangleAtT: function(t) {
		var s = 1 - t;
		var upper = this.points;
		var m = [upper];
		var order = this.order;
		for (var i = 1; i < order; ++i) {
			var lower = [];
			for (var j = 0; j < order - i; ++j) {
				var c0 = upper[j];
				var c1 = upper[j + 1];
				lower[j] = new Point(c0.x * s + c1.x * t, c0.y * s + c1.y * t);
			}
			m.push(lower);
			upper = lower;
		}
		return m;
	},
	// Returns two beziers resulting from splitting this bezier at t=0.5.
	// Based on Oliver Steele's bezier.js library.
	split: function(t) {
		if ('undefined' === typeof t) t = 0.5;
		var m = (0.5 == t) ? this.triangle() : this.triangleAtT(t);
		var order = this.order;
		var leftPoints = [];
		var rightPoints = [];
		for (var i = 0; i < order; ++i) {
			leftPoints[i]  = m[i][0];
			rightPoints[i] = m[order - 1 - i][i];
		}
		return {left: new Bezier(leftPoints), right: new Bezier(rightPoints)};
	},
	// Returns a bezier which is the portion of this bezier from t1 to t2.
	// Thanks to Peter Zin on comp.graphics.algorithms.
	mid: function(t1, t2) {
		return this.split(t2).left.split(t1 / t2).right;
	},
	// Returns points (and their corresponding times in the bezier) that form
	// an approximate polygonal representation of the bezier.
	// Based on the algorithm described in Jeremy Gibbons' dashed.ps.gz
	chordPoints: function() {
		var p = [{tStart: 0, tEnd: 0, dt: 0, p: this.points[0]}].concat(this._chordPoints(0, 1));
		return (this.chordPoints = function() {return p;})();
	},
	_chordPoints: function(tStart, tEnd) {
		var tolerance = 0.001;
		var dt = tEnd - tStart;
		if (this.controlPolygonLength() <= (1 + tolerance) * this.chordLength()) {
			return [{tStart: tStart, tEnd: tEnd, dt: dt, p: this.points[this.order - 1]}];
		} else {
			var tMid = tStart + dt / 2;
			var halves = this.split();
			return halves.left._chordPoints(tStart, tMid).concat(halves.right._chordPoints(tMid, tEnd));
		}
	},
	// Returns an array of times between 0 and 1 that mark the bezier evenly
	// in space.
	// Based in part on the algorithm described in Jeremy Gibbons' dashed.ps.gz
	markedEvery: function(distance, firstDistance) {
		var nextDistance = firstDistance || distance;
		var segments = this.chordPoints();
		var segmentsLength = segments.length;
		var times = [];
		var t = 0; // time
		var dt; // delta t
		var segment;
		var remainingDistance;
		for (var i = 1; i < segmentsLength; ++i) {
			segment = segments[i];
			segment.length = segment.p.distanceFrom(segments[i - 1].p);
			if (0 == segment.length) {
				t += segment.dt;
			} else {
				dt = nextDistance / segment.length * segment.dt;
				segment.remainingLength = segment.length;
				while (segment.remainingLength >= nextDistance) {
					segment.remainingLength -= nextDistance;
					t += dt;
					times.push(t);
					if (distance != nextDistance) {
						nextDistance = distance;
						dt = nextDistance / segment.length * segment.dt;
					}
				}
				nextDistance -= segment.remainingLength;
				t = segment.tEnd;
			}
		}
		return {times: times, nextDistance: nextDistance};
	},
	// Return the coefficients of the polynomials for x and y in t.
	// From Oliver Steele's bezier.js library.
	coefficients: function() {
		// This function deals with polynomials, represented as
		// arrays of coefficients.  p[i] is the coefficient of n^i.
		
		// p0, p1 => p0 + (p1 - p0) * n
		// side-effects (denormalizes) p0, for convienence
		function interpolate(p0, p1) {
			p0.push(0);
			var p = [];
			p[0] = p0[0];
			var p1Length = p1.length;
			for (var i = 0; i < p1Length; ++i) {
				p[i + 1] = p0[i + 1] + p1[i] - p0[i];
			}
			return p;
		}
		// folds +interpolate+ across a graph whose fringe is
		// the polynomial elements of +ns+, and returns its TOP
		function collapse(ns) {
			while (ns.length > 1) {
				var nsLengthMinus1 = ns.length - 1;
				var ps = [];
				for (var i = 0; i < nsLengthMinus1; ++i) {
					ps[i] = interpolate(ns[i], ns[i + 1]);
				}
				ns = ps;
			}
			return ns[0];
		}
		// xps and yps are arrays of polynomials --- concretely realized
		// as arrays of arrays
		var xps = [];
		var yps = [];
		for (var i = 0, pt; pt = this.points[i++]; ) {
			xps.push([pt.x]);
			yps.push([pt.y]);
		}
		var result = {xs: collapse(xps), ys: collapse(yps)};
		return (this.coefficients = function() {return result;})();
	},
	// Return the point at time t.
	// From Oliver Steele's bezier.js library.
	pointAtT: function(t) {
		var c = this.coefficients();
		var cx = c.xs, cy = c.ys;
		// evaluate cx[0] + cx[1]t +cx[2]t^2 ....
		
		// optimization: start from the end, to save one
		// muliplicate per order (we never need an explicit t^n)
		
		// optimization: special-case the last element
		// to save a multiply-add
		var x = cx[cx.length - 1], y = cy[cy.length - 1];
		
		for (var i = cx.length - 1; --i >= 0; ) {
			x = x * t + cx[i];
			y = y * t + cy[i];
		}
		return new Point(x, y);
	},
	// Render the Bezier to a WHATWG 2D canvas context.
	// Based on Oliver Steele's bezier.js library.
	makePath: function (ctx, moveTo) {
		if ('undefined' === typeof moveTo) moveTo = true;
		if (moveTo) ctx.moveTo(this.points[0].x, this.points[0].y);
		var fn = this.pathCommands[this.order];
		if (fn) {
			var coords = [];
			var pointsLength = this.points.length;
			for (var i = 1 == this.order ? 0 : 1; i < pointsLength; ++i) {
				var point = this.points[i];
				coords.push(point.x);
				coords.push(point.y);
			}
			fn.apply(ctx, coords);
		}
	},
	// Wrapper functions to work around Safari, in which, up to at least 2.0.3,
	// fn.apply isn't defined on the context primitives.
	// Based on Oliver Steele's bezier.js library.
	pathCommands: [
		null,
		// This will have an effect if there's a line thickness or end cap.
		function(x, y) {
			this.lineTo(x + .05, y);
		},
		function(x, y) {
			this.lineTo(x, y);
		},
		function(x1, y1, x2, y2) {
			this.quadraticCurveTo(x1, y1, x2, y2);
		},
		function(x1, y1, x2, y2, x3, y3) {
			this.bezierCurveTo(x1, y1, x2, y2, x3, y3);
		}
	],
	makeDashedPath: function(ctx, dashLength, firstDistance, drawFirst) {
		if (!firstDistance) firstDistance = dashLength;
		if ('undefined' === typeof drawFirst) drawFirst = true;
		var markedEvery = this.markedEvery(dashLength, firstDistance);
		if (drawFirst) markedEvery.times.unshift(0);
		var drawLast = (markedEvery.times.length % 2);
		if (drawLast) markedEvery.times.push(1);
		var markedEveryTimesLength = markedEvery.times.length;
		for (var i = 1; i < markedEveryTimesLength; i += 2) {
			this.mid(markedEvery.times[i - 1], markedEvery.times[i]).makePath(ctx);
		}
		return {firstDistance: markedEvery.nextDistance, drawFirst: drawLast};
	},
	makeDottedPath: function(ctx, dotSpacing, firstDistance) {
		if (!firstDistance) firstDistance = dotSpacing;
		var markedEvery = this.markedEvery(dotSpacing, firstDistance);
		if (dotSpacing == firstDistance) markedEvery.times.unshift(0);
		var markedEveryTimesLength = markedEvery.times.length;
		for (var i = 0; i < markedEveryTimesLength; ++i) {
			this.pointAtT(markedEvery.times[i]).makePath(ctx);
		}
		return markedEvery.nextDistance;
	}
};

// A minimal implementation of Object.keys for old browsers that don't have one.
// It's not being assigned to Object.keys since it is not a complete proper
// implementation: it does not work around the IE DontEnum bug, but that should
// be ok for our purposes.
// https://developer.mozilla.org/en/ECMAScript_DontEnum_attribute#JScript_DontEnum_Bug

var objectKeys = ('undefined' !== typeof Object.keys) ? Object.keys : (function() {
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  
  return function(object) {
    var keys = [];
    for (var name in object) {
      if (hasOwnProperty.call(object, name)) {
        keys.push(name);
      }
    }
    return keys;
  };
}());


var Path = exports.Path = function(segments, options) {
		this.segments = segments || [];
		this.options = {};
		if (options) this.setOptions(options);
};
Path.prototype = {
	constructor: Path,
	x_fill: false,
	x_stroke: true,
	x_strokeType: 'solid',
	x_dashLength: 6,
	x_dotSpacing: 4,
	setOptions: function(options) {
		var keys = objectKeys(options);
		var keysLength = keys.length;
		for (var i = 0; i < keysLength; ++i) {
			var key = keys[i];
			if ('x_' == key.substr(0, 2)) {
				this[key] = options[key];
			} else {
				this.options[key] = options[key];
			}
		}
	},
	setupSegments: function() {},
	// Based on Oliver Steele's bezier.js library.
	addBezier: function(pointsOrBezier) {
		this.segments.push(pointsOrBezier instanceof Array ? new Bezier(pointsOrBezier) : pointsOrBezier);
	},
	offset: function(dx, dy) {
		if (0 == this.segments.length) this.setupSegments();
		var segmentsLength = this.segments.length;
		for (var i = 0; i < segmentsLength; ++i) {
			this.segments[i].offset(dx, dy);
		}
	},
	getBB: function() {
		if (0 == this.segments.length) this.setupSegments();
		var l, t, r, b, p = this.segments[0].points[0];
		l = r = p.x;
		t = b = p.y;
		var segmentsLength = this.segments.length;
		for (var i = 0; i < segmentsLength; ++i) {
			var points = this.segments[i].points;
			var pointsLength = points.length;
			for (var j = 0; j < pointsLength; ++j) {
				var point = this.segments[i].points[j];
				l = Math.min(l, point.x);
				t = Math.min(t, point.y);
				r = Math.max(r, point.x);
				b = Math.max(b, point.y);
			}
		}
		var rect = new Rect(l, t, r, b);
		return (this.getBB = function() {return rect;})();
	},
	isPointInBB: function(x, y, tolerance) {
		if ('undefined' === typeof tolerance) tolerance = 0;
		var bb = this.getBB();
		if (0 < tolerance) {
			bb = Object.clone(bb);
			bb.inset(-tolerance, -tolerance);
		}
		return !(x < bb.l || x > bb.r || y < bb.t || y > bb.b);
	},
	isPointOnPath: function(x, y, tolerance) {
		if ('undefined' === typeof tolerance) tolerance = 0;
		if (!this.isPointInBB(x, y, tolerance)) return false;
		var segmentsLength = this.segments.length;
		for (var i = 0; i < segmentsLength; ++i) {
			if (this.segments[i].isPointOnBezier(x, y, tolerance)) {
				return true;
			}
		}
		return false;
	},
	isPointInPath: function(x, y) {
		return false;
	},
	// Based on Oliver Steele's bezier.js library.
	makePath: function(ctx) {
		if (0 == this.segments.length) this.setupSegments();
		var segmentsLength = this.segments.length;
		for (var i = 0; i < segmentsLength; ++i) {
			this.segments[i].makePath(ctx, 0 == i);
		}
	},
	makeDashedPath: function(ctx, dashLength, firstDistance, drawFirst) {
		if (0 == this.segments.length) this.setupSegments();
		var info = {
			drawFirst: ('undefined' === typeof drawFirst) ? true : drawFirst,
			firstDistance: firstDistance || dashLength
		};
		var segmentsLength = this.segments.length;
		for (var i = 0; i < segmentsLength; ++i) {
			info = this.segments[i].makeDashedPath(ctx, dashLength, info.firstDistance, info.drawFirst);
		}
	},
	makeDottedPath: function(ctx, dotSpacing, firstDistance) {
		if (0 == this.segments.length) this.setupSegments();
		if (!firstDistance) firstDistance = dotSpacing;
		var segmentsLength = this.segments.length;
		for (var i = 0; i < segmentsLength; ++i ) {
			firstDistance = this.segments[i].makeDottedPath(ctx, dotSpacing, firstDistance);
		}
	},
	draw: function(ctx) {
		ctx.save();
		var keys = objectKeys(this.options);
		var keysLength = keys.length;
		for (var i = 0; i < keysLength; ++i) {
			var key = keys[i];
			ctx[key] = this.options[key];
		}
		if (this.x_fill) {
			ctx.beginPath();
			this.makePath(ctx);
			ctx.fill();
		}
		if (this.x_stroke) {
			switch (this.x_strokeType) {
				case 'dashed':
					ctx.beginPath();
					this.makeDashedPath(ctx, this.x_dashLength);
					break;
				case 'dotted':
					if (ctx.lineWidth < 2) ctx.lineWidth = 2;
					ctx.beginPath();
					this.makeDottedPath(ctx, this.x_dotSpacing);
					break;
				case 'solid':
				default:
					if (!this.x_fill) {
						ctx.beginPath();
						this.makePath(ctx);
					}
			}
			ctx.stroke();
		}
		ctx.restore();
	}
};


var Polygon = exports.Polygon = function(points, options) {
		this.points = points || [];
		Path.call(this, [], options);
};
Polygon.prototype = new Path();
Polygon.prototype.constructor = Polygon;
Polygon.prototype.offset = function(dx, dy) {
		var pointsLength = this.points.length;
		for (var i = 0; i < pointsLength; ++i ) {
			this.points[i].offset(dx, dy);
		}
		return this;
};
Polygon.prototype.setupSegments = function() {
		var pointsLength = this.points.length;
		for (var i = 0; i < pointsLength; ++i) {
			var next = i + 1;
			if (this.points.length == next) next = 0;
			this.addBezier([
				this.points[i],
				this.points[next]
			]);
		}
};


var Rect = exports.Rect = function(l, t, r, b, options) {
		this.l = l;
		this.t = t;
		this.r = r;
		this.b = b;
		Polygon.call(this, [], options);
};
Rect.prototype = new Polygon();
Rect.prototype.constructor = Rect;
Rect.prototype.offset = function(dx, dy) {
		this.l += dx;
		this.t += dy;
		this.r += dx;
		this.b += dy;
		return this;
};
Rect.prototype.inset = function(ix, iy) {
		this.l += ix;
		this.t += iy;
		this.r -= ix;
		this.b -= iy;
		return this;
};
Rect.prototype.expandToInclude = function(rect) {
		this.l = Math.min(this.l, rect.l);
		this.t = Math.min(this.t, rect.t);
		this.r = Math.max(this.r, rect.r);
		this.b = Math.max(this.b, rect.b);
};
Rect.prototype.getWidth = function() {
		return this.r - this.l;
};
Rect.prototype.getHeight = function() {
		return this.b - this.t;
};
Rect.prototype.setupSegments = function() {
		var w = this.getWidth();
		var h = this.getHeight();
		this.points = [
			new Point(this.l, this.t),
			new Point(this.l + w, this.t),
			new Point(this.l + w, this.t + h),
			new Point(this.l, this.t + h)
		];
		Polygon.prototype.setupSegments.call(this);
};


var CanvizImage = exports.CanvizImage = Class.create({
	initialize: function(canviz, src) {
		this.canviz = canviz;
		++this.canviz.numImages;
		this.finished = this.loaded = false;
		this.img = new Image();
		this.img.onload = this.onLoad.bind(this);
		this.img.onerror = this.onFinish.bind(this);
		this.img.onabort = this.onFinish.bind(this);
		this.img.src = this.canviz.imagePath + src;
	},
	onLoad: function() {
		this.loaded = true;
		this.onFinish();
	},
	onFinish: function() {
		this.finished = true;
		++this.canviz.numImagesFinished;
		if (this.canviz.numImages == this.canviz.numImagesFinished) {
			this.canviz.draw(true);
		}
	},
	draw: function(ctx, l, t, w, h) {
		if (this.finished) {
			if (this.loaded) {
				ctx.drawImage(this.img, l, t, w, h);
			} else {
				debug('can\'t load image ' + this.img.src);
				this.drawBrokenImage(ctx, l, t, w, h);
			}
		}
	},
	drawBrokenImage: function(ctx, l, t, w, h) {
		ctx.save();
		ctx.beginPath();
		new Rect(l, t, l + w, t + w).draw(ctx);
		ctx.moveTo(l, t);
		ctx.lineTo(l + w, t + w);
		ctx.moveTo(l + w, t);
		ctx.lineTo(l, t + h);
		ctx.strokeStyle = '#f00';
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();
	}
});


var Ellipse = exports.Ellipse = function(cx, cy, rx, ry, options) {
		this.cx = cx; // center x
		this.cy = cy; // center y
		this.rx = rx; // radius x
		this.ry = ry; // radius y
		Path.call(this, [], options);
};
Ellipse.prototype = new Path();
Ellipse.prototype.constructor = Ellipse;
Ellipse.prototype.offset = function(dx, dy) {
		this.cx += dx;
		this.cy += dy;
		return this;
};

var KAPPA = 0.5522847498;
Ellipse.prototype.setupSegments = function() {
		this.addBezier([
			new Point(this.cx, this.cy - this.ry),
			new Point(this.cx + KAPPA * this.rx, this.cy - this.ry),
			new Point(this.cx + this.rx, this.cy - KAPPA * this.ry),
			new Point(this.cx + this.rx, this.cy)
		]);
		this.addBezier([
			new Point(this.cx + this.rx, this.cy),
			new Point(this.cx + this.rx, this.cy + KAPPA * this.ry),
			new Point(this.cx + KAPPA * this.rx, this.cy + this.ry),
			new Point(this.cx, this.cy + this.ry)
		]);
		this.addBezier([
			new Point(this.cx, this.cy + this.ry),
			new Point(this.cx - KAPPA * this.rx, this.cy + this.ry),
			new Point(this.cx - this.rx, this.cy + KAPPA * this.ry),
			new Point(this.cx - this.rx, this.cy)
		]);
		this.addBezier([
			new Point(this.cx - this.rx, this.cy),
			new Point(this.cx - this.rx, this.cy - KAPPA * this.ry),
			new Point(this.cx - KAPPA * this.rx, this.cy - this.ry),
			new Point(this.cx, this.cy - this.ry)
		]);
};

var CanvizTokenizer = exports.CanvizTokenizer = Class.create({
	initialize: function(str) {
		this.str = str;
	},
	takeChars: function(num) {
		if (!num) {
			num = 1;
		}
		var tokens = new Array();
		while (num--) {
			var matches = this.str.match(/^(\S+)\s*/);
			if (matches) {
				this.str = this.str.substr(matches[0].length);
				tokens.push(matches[1]);
			} else {
				tokens.push(false);
			}
		}
		if (1 == tokens.length) {
			return tokens[0];
		} else {
			return tokens;
		}
	},
	takeNumber: function(num) {
		if (!num) {
			num = 1;
		}
		if (1 == num) {
			return Number(this.takeChars());
		} else {
			var tokens = this.takeChars(num);
			while (num--) {
				tokens[num] = Number(tokens[num]);
			}
			return tokens;
		}
	},
	takeString: function() {
		var byteCount = Number(this.takeChars()), charCount = 0, charCode;
		if ('-' != this.str.charAt(0)) {
			return false;
		}
		while (0 < byteCount) {
			++charCount;
			charCode = this.str.charCodeAt(charCount);
			if (0x80 > charCode) {
				--byteCount;
			} else if (0x800 > charCode) {
				byteCount -= 2;
			} else {
				byteCount -= 3;
			}
		}
		var str = this.str.substr(1, charCount);
		this.str = this.str.substr(1 + charCount).replace(/^\s+/, '');
		return str;
	}
});


var CanvizEntity = exports.CanvizEntity = Class.create({
	initialize: function(defaultAttrHashName, name, canviz, rootGraph, parentGraph, immediateGraph) {
		this.defaultAttrHashName = defaultAttrHashName;
		this.name = name;
		this.canviz = canviz;
		this.rootGraph = rootGraph;
		this.parentGraph = parentGraph;
		this.immediateGraph = immediateGraph;
		this.attrs = $H();
		this.drawAttrs = $H();
	},
	initBB: function() {
		var matches = this.getAttr('pos').match(/([0-9.]+),([0-9.]+)/);
		var x = Math.round(matches[1]);
		var y = Math.round(this.canviz.height - matches[2]);
		this.bbRect = new Rect(x, y, x, y);
	},
	getAttr: function(attrName, escString) {
		if ('undefined' === typeof escString) escString = false;
		var attrValue = this.attrs.get(attrName);
		if ('undefined' === typeof attrValue) {
			var graph = this.parentGraph;
			while ('undefined' !== typeof graph) {
				attrValue = graph[this.defaultAttrHashName].get(attrName);
				if ('undefined' === typeof attrValue) {
					graph = graph.parentGraph;
				} else {
					break;
				}
			}
		}
		if (attrValue && escString) {
			attrValue = attrValue.replace(this.escStringMatchRe, function(match, p1) {
				switch (p1) {
					case 'N': // fall through
					case 'E': return this.name;
					case 'T': return this.tailNode;
					case 'H': return this.headNode;
					case 'G': return this.immediateGraph.name;
					case 'L': return this.getAttr('label', true);
				}
				return match;
			}.bind(this));
		}
		return attrValue;
	},
	draw: function(ctx, ctxScale, redrawCanvasOnly) {
		var i, tokens, fillColor, strokeColor;
		if (!redrawCanvasOnly) {
			this.initBB();
			var bbDiv = new Element('div');
			this.canviz.elements.appendChild(bbDiv);
		}
		this.drawAttrs.each(function(drawAttr) {
			var command = drawAttr.value;
//			debug(command);
			var tokenizer = new CanvizTokenizer(command);
			var token = tokenizer.takeChars();
			if (token) {
				var dashStyle = 'solid';
				ctx.save();
				while (token) {
//					debug('processing token ' + token);
					switch (token) {
						case 'E': // filled ellipse
						case 'e': // unfilled ellipse
							var filled = ('E' == token);
							var cx = tokenizer.takeNumber();
							var cy = this.canviz.height - tokenizer.takeNumber();
							var rx = tokenizer.takeNumber();
							var ry = tokenizer.takeNumber();
							var path = new Ellipse(cx, cy, rx, ry);
							break;
						case 'P': // filled polygon
						case 'p': // unfilled polygon
						case 'L': // polyline
							var filled = ('P' == token);
							var closed = ('L' != token);
							var numPoints = tokenizer.takeNumber();
							tokens = tokenizer.takeNumber(2 * numPoints); // points
							var path = new Path();
							for (i = 2; i < 2 * numPoints; i += 2) {
								path.addBezier([
									new Point(tokens[i - 2], this.canviz.height - tokens[i - 1]),
									new Point(tokens[i],     this.canviz.height - tokens[i + 1])
								]);
							}
							if (closed) {
								path.addBezier([
									new Point(tokens[2 * numPoints - 2], this.canviz.height - tokens[2 * numPoints - 1]),
									new Point(tokens[0],                  this.canviz.height - tokens[1])
								]);
							}
							break;
						case 'B': // unfilled b-spline
						case 'b': // filled b-spline
							var filled = ('b' == token);
							var numPoints = tokenizer.takeNumber();
							tokens = tokenizer.takeNumber(2 * numPoints); // points
							var path = new Path();
							for (i = 2; i < 2 * numPoints; i += 6) {
								path.addBezier([
									new Point(tokens[i - 2], this.canviz.height - tokens[i - 1]),
									new Point(tokens[i],     this.canviz.height - tokens[i + 1]),
									new Point(tokens[i + 2], this.canviz.height - tokens[i + 3]),
									new Point(tokens[i + 4], this.canviz.height - tokens[i + 5])
								]);
							}
							break;
						case 'I': // image
							var l = tokenizer.takeNumber();
							var b = this.canviz.height - tokenizer.takeNumber();
							var w = tokenizer.takeNumber();
							var h = tokenizer.takeNumber();
							var src = tokenizer.takeString();
							if (!this.canviz.images[src]) {
								this.canviz.images[src] = new CanvizImage(this.canviz, src);
							}
							this.canviz.images[src].draw(ctx, l, b - h, w, h);
							break;
						case 'T': // text
							var l = Math.round(ctxScale * tokenizer.takeNumber() + this.canviz.padding);
							var t = Math.round(ctxScale * this.canviz.height + 2 * this.canviz.padding - (ctxScale * (tokenizer.takeNumber() + this.canviz.bbScale * fontSize) + this.canviz.padding));
							var textAlign = tokenizer.takeNumber();
							var textWidth = Math.round(ctxScale * tokenizer.takeNumber());
							var str = tokenizer.takeString();
							if (!redrawCanvasOnly && !/^\s*$/.test(str)) {
//								debug('draw text ' + str + ' ' + l + ' ' + t + ' ' + textAlign + ' ' + textWidth);
								str = str.escapeHTML();
								do {
									matches = str.match(/ ( +)/);
									if (matches) {
										var spaces = ' ';
										matches[1].length.times(function() {
											spaces += '&nbsp;';
										});
										str = str.replace(/  +/, spaces);
									}
								} while (matches);
								var text;
								var href = this.getAttr('URL', true) || this.getAttr('href', true);
								if (href) {
									var target = this.getAttr('target', true) || '_self';
									var tooltip = this.getAttr('tooltip', true) || this.getAttr('label', true);
//									debug(this.name + ', href ' + href + ', target ' + target + ', tooltip ' + tooltip);
									text = new Element('a', {href: href, target: target, title: tooltip});
									['onclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmousemove', 'onmouseout'].each(function(attrName) {
										var attrValue = this.getAttr(attrName, true);
										if (attrValue) {
											text.writeAttribute(attrName, attrValue);
										}
									}.bind(this));
									text.setStyle({
										textDecoration: 'none'
									});
								} else {
									text = new Element('span');
								}
								text.update(str);
								text.setStyle({
									fontSize: Math.round(fontSize * ctxScale * this.canviz.bbScale) + 'px',
									fontFamily: fontFamily,
									color: strokeColor.textColor,
									position: 'absolute',
									textAlign: (-1 == textAlign) ? 'left' : (1 == textAlign) ? 'right' : 'center',
									left: (l - (1 + textAlign) * textWidth) + 'px',
									top: t + 'px',
									width: (2 * textWidth) + 'px'
								});
								if (1 != strokeColor.opacity) text.setOpacity(strokeColor.opacity);
								this.canviz.elements.appendChild(text);
							}
							break;
						case 'C': // set fill color
						case 'c': // set pen color
							var fill = ('C' == token);
							var color = this.parseColor(tokenizer.takeString());
							if (fill) {
								fillColor = color;
								ctx.fillStyle = color.canvasColor;
							} else {
								strokeColor = color;
								ctx.strokeStyle = color.canvasColor;
							}
							break;
						case 'F': // set font
							fontSize = tokenizer.takeNumber();
							fontFamily = tokenizer.takeString();
							switch (fontFamily) {
								case 'Times-Roman':
									fontFamily = 'Times New Roman';
									break;
								case 'Courier':
									fontFamily = 'Courier New';
									break;
								case 'Helvetica':
									fontFamily = 'Arial';
									break;
								default:
									// nothing
							}
//							debug('set font ' + fontSize + 'pt ' + fontFamily);
							break;
						case 'S': // set style
							var style = tokenizer.takeString();
							switch (style) {
								case 'solid':
								case 'filled':
									// nothing
									break;
								case 'dashed':
								case 'dotted':
									dashStyle = style;
									break;
								case 'bold':
									ctx.lineWidth = 2;
									break;
								default:
									matches = style.match(/^setlinewidth\((.*)\)$/);
									if (matches) {
										ctx.lineWidth = Number(matches[1]);
									} else {
										debug('unknown style ' + style);
									}
							}
							break;
						default:
							debug('unknown token ' + token);
							return;
					}
					if (path) {
						this.canviz.drawPath(ctx, path, filled, dashStyle);
						if (!redrawCanvasOnly) this.bbRect.expandToInclude(path.getBB());
						path = undefined;
					}
					token = tokenizer.takeChars();
				}
				if (!redrawCanvasOnly) {
					bbDiv.setStyle({
						position: 'absolute',
						left:   Math.round(ctxScale * this.bbRect.l + this.canviz.padding) + 'px',
						top:    Math.round(ctxScale * this.bbRect.t + this.canviz.padding) + 'px',
						width:  Math.round(ctxScale * this.bbRect.getWidth()) + 'px',
						height: Math.round(ctxScale * this.bbRect.getHeight()) + 'px'
					});
				}
				ctx.restore();
			}
		}.bind(this));
	},
	parseColor: function(color) {
		var parsedColor = {opacity: 1};
		// rgb/rgba
		if (/^#(?:[0-9a-f]{2}\s*){3,4}$/i.test(color)) {
			return this.canviz.parseHexColor(color);
		}
		// hsv
		var matches = color.match(/^(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)$/);
		if (matches) {
			parsedColor.canvasColor = parsedColor.textColor = this.canviz.hsvToRgbColor(matches[1], matches[2], matches[3]);
			return parsedColor;
		}
		// named color
		var colorScheme = this.getAttr('colorscheme') || 'X11';
		var colorName = color;
		matches = color.match(/^\/(.*)\/(.*)$/);
		if (matches) {
			if (matches[1]) {
				colorScheme = matches[1];
			}
			colorName = matches[2];
		} else {
			matches = color.match(/^\/(.*)$/);
			if (matches) {
				colorScheme = 'X11';
				colorName = matches[1];
			}
		}
		colorName = colorName.toLowerCase();
		var colorSchemeName = colorScheme.toLowerCase();
		var colorSchemeData = Canviz.prototype.colors.get(colorSchemeName);
		if (colorSchemeData) {
			var colorData = colorSchemeData[colorName];
			if (colorData) {
				return this.canviz.parseHexColor('#' + colorData);
			}
		}
		colorData = Canviz.prototype.colors.get('fallback')[colorName];
		if (colorData) {
			return this.canviz.parseHexColor('#' + colorData);
		}
		if (!colorSchemeData) {
			debug('unknown color scheme ' + colorScheme);
		}
		// unknown
		debug('unknown color ' + color + '; color scheme is ' + colorScheme);
		parsedColor.canvasColor = parsedColor.textColor = '#000000';
		return parsedColor;
	}
});


var CanvizEdge = exports.CanvizEdge = Class.create(CanvizEntity, {
	initialize: function($super, name, canviz, rootGraph, parentGraph, tailNode, headNode) {
		$super('edgeAttrs', name, canviz, rootGraph, parentGraph, parentGraph);
		this.tailNode = tailNode;
		this.headNode = headNode;
	}
});
Object.extend(CanvizEdge.prototype, {
	escStringMatchRe: /\\([EGTHL])/g
});


var CanvizGraph = exports.CanvizGraph = Class.create(CanvizEntity, {
	initialize: function($super, name, canviz, rootGraph, parentGraph) {
		$super('attrs', name, canviz, rootGraph, parentGraph, this);
		this.nodeAttrs = $H();
		this.edgeAttrs = $H();
		this.nodes = $A();
		this.edges = $A();
		this.subgraphs = $A();
	},
	initBB: function() {
		var coords = this.getAttr('bb').split(',');
		this.bbRect = new Rect(coords[0], this.canviz.height - coords[1], coords[2], this.canviz.height - coords[3]);
	},
	draw: function($super, ctx, ctxScale, redrawCanvasOnly) {
		$super(ctx, ctxScale, redrawCanvasOnly);
		[this.subgraphs, this.nodes, this.edges].each(function(type) {
			type.each(function(entity) {
				entity.draw(ctx, ctxScale, redrawCanvasOnly);
			});
		});
	}
});
Object.extend(CanvizGraph.prototype, {
	escStringMatchRe: /\\([GL])/g
});


var CanvizNode = exports.CanvizNode = Class.create(CanvizEntity, {
	initialize: function($super, name, canviz, rootGraph, parentGraph) {
		$super('nodeAttrs', name, canviz, rootGraph, parentGraph, parentGraph);
	}
});
Object.extend(CanvizNode.prototype, {
	escStringMatchRe: /\\([NGL])/g
});


var Canviz = exports.Canviz = Class.create({
	maxXdotVersion: '1.2',
	colors: $H({
		fallback:{
			black:'000000',
			lightgrey:'d3d3d3',
			white:'ffffff'
		}
	}),
	initialize: function(container, url, urlParams) {
		// excanvas can't init the element if we use new Element()
		this.canvas = document.createElement('canvas');
		Element.setStyle(this.canvas, {
			position: 'absolute'
		});
		if (!Canviz.canvasCounter) Canviz.canvasCounter = 0;
		this.canvas.id = 'canviz_canvas_' + ++Canviz.canvasCounter;
		this.elements = new Element('div');
		this.elements.setStyle({
			position: 'absolute'
		});
		this.container = $(container);
		this.container.setStyle({
			position: 'relative'
		});
		this.container.appendChild(this.canvas);
		if (Prototype.Browser.IE) {
			G_vmlCanvasManager.initElement(this.canvas);
			this.canvas = $(this.canvas.id);
		}
		this.container.appendChild(this.elements);
		this.ctx = this.canvas.getContext('2d');
		this.scale = 1;
		this.padding = 8;
		this.dashLength = 6;
		this.dotSpacing = 4;
		this.graphs = $A();
		this.images = new Hash();
		this.numImages = 0;
		this.numImagesFinished = 0;
		if (url) {
			this.load(url, urlParams);
		}
	},
	setScale: function(scale) {
		this.scale = scale;
	},
	setImagePath: function(imagePath) {
		this.imagePath = imagePath;
	},
	load: function(url, urlParams) {
		$('debug_output').innerHTML = '';
		new Ajax.Request(url, {
			method: 'get',
			parameters: urlParams,
			onComplete: function(response) {
				this.parse(response.responseText);
			}.bind(this)
		});
	},
	parse: function(xdot) {
		this.graphs = $A();
		this.width = 0;
		this.height = 0;
		this.maxWidth = false;
		this.maxHeight = false;
		this.bbEnlarge = false;
		this.bbScale = 1;
		this.dpi = 96;
		this.bgcolor = {opacity: 1};
		this.bgcolor.canvasColor = this.bgcolor.textColor = '#ffffff';
		var lines = xdot.split(/\r?\n/);
		var i = 0;
		var line, lastChar, matches, rootGraph, isGraph, entity, entityName, attrs, attrName, attrValue, attrHash, drawAttrHash;
		var containers = $A();
		while (i < lines.length) {
			line = lines[i++].replace(/^\s+/, '');
			if ('' != line && '#' != line.substr(0, 1)) {
				while (i < lines.length && ';' != (lastChar = line.substr(line.length - 1, line.length)) && '{' != lastChar && '}' != lastChar) {
					if ('\\' == lastChar) {
						line = line.substr(0, line.length - 1);
					}
					line += lines[i++];
				}
//				debug(line);
				if (0 == containers.length) {
					matches = line.match(this.graphMatchRe);
					if (matches) {
						rootGraph = new CanvizGraph(matches[3], this);
						containers.unshift(rootGraph);
						containers[0].strict = ('undefined' !== typeof matches[1]);
						containers[0].type = ('graph' == matches[2]) ? 'undirected' : 'directed';
						containers[0].attrs.set('xdotversion', '1.0');
						this.graphs.push(containers[0]);
//						debug('graph: ' + containers[0].name);
					}
				} else {
					matches = line.match(this.subgraphMatchRe);
					if (matches) {
						containers.unshift(new CanvizGraph(matches[1], this, rootGraph, containers[0]));
						containers[1].subgraphs.push(containers[0]);
//						debug('subgraph: ' + containers[0].name);
					}
				}
				if (matches) {
//					debug('begin container ' + containers[0].name);
				} else if ('}' == line) {
//					debug('end container ' + containers[0].name);
					containers.shift();
					if (0 == containers.length) {
						break;
					}
				} else {
					matches = line.match(this.nodeMatchRe);
					if (matches) {
						entityName = matches[2];
						attrs = matches[5];
						drawAttrHash = containers[0].drawAttrs;
						isGraph = false;
						switch (entityName) {
							case 'graph':
								attrHash = containers[0].attrs;
								isGraph = true;
								break;
							case 'node':
								attrHash = containers[0].nodeAttrs;
								break;
							case 'edge':
								attrHash = containers[0].edgeAttrs;
								break;
							default:
								entity = new CanvizNode(entityName, this, rootGraph, containers[0]);
								attrHash = entity.attrs;
								drawAttrHash = entity.drawAttrs;
								containers[0].nodes.push(entity);
						}
//						debug('node: ' + entityName);
					} else {
						matches = line.match(this.edgeMatchRe);
						if (matches) {
							entityName = matches[1];
							attrs = matches[8];
							entity = new CanvizEdge(entityName, this, rootGraph, containers[0], matches[2], matches[5]);
							attrHash = entity.attrs;
							drawAttrHash = entity.drawAttrs;
							containers[0].edges.push(entity);
//							debug('edge: ' + entityName);
						}
					}
					if (matches) {
						do {
							if (0 == attrs.length) {
								break;
							}
							matches = attrs.match(this.attrMatchRe);
							if (matches) {
								attrs = attrs.substr(matches[0].length);
								attrName = matches[1];
								attrValue = this.unescape(matches[2]);
								if (/^_.*draw_$/.test(attrName)) {
									drawAttrHash.set(attrName, attrValue);
								} else {
									attrHash.set(attrName, attrValue);
								}
//								debug(attrName + ' ' + attrValue);
								if (isGraph && 1 == containers.length) {
									switch (attrName) {
										case 'bb':
											var bb = attrValue.split(/,/);
											this.width  = Number(bb[2]);
											this.height = Number(bb[3]);
											break;
										case 'bgcolor':
											this.bgcolor = rootGraph.parseColor(attrValue);
											break;
										case 'dpi':
											this.dpi = attrValue;
											break;
										case 'size':
											var size = attrValue.match(/^(\d+|\d*(?:\.\d+)),\s*(\d+|\d*(?:\.\d+))(!?)$/);
											if (size) {
												this.maxWidth  = 72 * Number(size[1]);
												this.maxHeight = 72 * Number(size[2]);
												this.bbEnlarge = ('!' == size[3]);
											} else {
												debug('can\'t parse size');
											}
											break;
										case 'xdotversion':
											if (0 > this.versionCompare(this.maxXdotVersion, attrHash.get('xdotversion'))) {
												debug('unsupported xdotversion ' + attrHash.get('xdotversion') + '; this script currently supports up to xdotversion ' + this.maxXdotVersion);
											}
											break;
									}
								}
							} else {
								debug('can\'t read attributes for entity ' + entityName + ' from ' + attrs);
							}
						} while (matches);
					}
				}
			}
		}
/*
		if (this.maxWidth && this.maxHeight) {
			if (this.width > this.maxWidth || this.height > this.maxHeight || this.bbEnlarge) {
				this.bbScale = Math.min(this.maxWidth / this.width, this.maxHeight / this.height);
				this.width  = Math.round(this.width  * this.bbScale);
				this.height = Math.round(this.height * this.bbScale);
			}
		}
*/
//		debug('done');
		this.draw();
	},
	draw: function(redrawCanvasOnly) {
		if ('undefined' === typeof redrawCanvasOnly) redrawCanvasOnly = false;
		var ctxScale = this.scale * this.dpi / 72;
		var width  = Math.round(ctxScale * this.width  + 2 * this.padding);
		var height = Math.round(ctxScale * this.height + 2 * this.padding);
		if (!redrawCanvasOnly) {
			this.canvas.width  = width;
			this.canvas.height = height;
			this.canvas.setStyle({
				width:  width  + 'px',
				height: height + 'px'
			});
			this.container.setStyle({
				width:  width  + 'px',
				height: height + 'px'
			});
			while (this.elements.firstChild) {
				this.elements.removeChild(this.elements.firstChild);
			}
		}
		this.ctx.save();
		this.ctx.lineCap = 'round';
		this.ctx.fillStyle = this.bgcolor.canvasColor;
		this.ctx.fillRect(0, 0, width, height);
		this.ctx.translate(this.padding, this.padding);
		this.ctx.scale(ctxScale, ctxScale);
		this.graphs[0].draw(this.ctx, ctxScale, redrawCanvasOnly);
		this.ctx.restore();
	},
	drawPath: function(ctx, path, filled, dashStyle) {
		if (filled) {
			ctx.beginPath();
			path.makePath(ctx);
			ctx.fill();
		}
		if (ctx.fillStyle != ctx.strokeStyle || !filled) {
			switch (dashStyle) {
				case 'dashed':
					ctx.beginPath();
					path.makeDashedPath(ctx, this.dashLength);
					break;
				case 'dotted':
					var oldLineWidth = ctx.lineWidth;
					ctx.lineWidth *= 2;
					ctx.beginPath();
					path.makeDottedPath(ctx, this.dotSpacing);
					break;
				case 'solid':
				default:
					if (!filled) {
						ctx.beginPath();
						path.makePath(ctx);
					}
			}
			ctx.stroke();
			if (oldLineWidth) ctx.lineWidth = oldLineWidth;
		}
	},
	unescape: function(str) {
		var matches = str.match(/^"(.*)"$/);
		if (matches) {
			return matches[1].replace(/\\"/g, '"');
		} else {
			return str;
		}
	},
	parseHexColor: function(color) {
		var matches = color.match(/^#([0-9a-f]{2})\s*([0-9a-f]{2})\s*([0-9a-f]{2})\s*([0-9a-f]{2})?$/i);
		if (matches) {
			var canvasColor, textColor = '#' + matches[1] + matches[2] + matches[3], opacity = 1;
			if (matches[4]) { // rgba
				opacity = parseInt(matches[4], 16) / 255;
				canvasColor = 'rgba(' + parseInt(matches[1], 16) + ',' + parseInt(matches[2], 16) + ',' + parseInt(matches[3], 16) + ',' + opacity + ')';
			} else { // rgb
				canvasColor = textColor;
			}
		}
		return {canvasColor: canvasColor, textColor: textColor, opacity: opacity};
	},
	hsvToRgbColor: function(h, s, v) {
		var i, f, p, q, t, r, g, b;
		h *= 360;
		i = Math.floor(h / 60) % 6;
		f = h / 60 - i;
		p = v * (1 - s);
		q = v * (1 - f * s);
		t = v * (1 - (1 - f) * s);
		switch (i) {
			case 0: r = v; g = t; b = p; break;
			case 1: r = q; g = v; b = p; break;
			case 2: r = p; g = v; b = t; break;
			case 3: r = p; g = q; b = v; break;
			case 4: r = t; g = p; b = v; break;
			case 5: r = v; g = p; b = q; break;
		}
		return 'rgb(' + Math.round(255 * r) + ',' + Math.round(255 * g) + ',' + Math.round(255 * b) + ')';
	},
	addColors: function(colors) {
		Canviz.prototype.colors.update(colors);
	},
	versionCompare: function(a, b) {
		a = a.split('.');
		b = b.split('.');
		var a1, b1;
		while (a.length || b.length) {
			a1 = a.length ? a.shift() : 0;
			b1 = b.length ? b.shift() : 0;
			if (a1 < b1) return -1;
			if (a1 > b1) return 1;
		}
		return 0;
	},
	// an alphanumeric string or a number or a double-quoted string or an HTML string
	idMatch: '([a-zA-Z\u0080-\uFFFF_][0-9a-zA-Z\u0080-\uFFFF_]*|-?(?:\\.\\d+|\\d+(?:\\.\\d*)?)|"(?:\\\\"|[^"])*"|<(?:<[^>]*>|[^<>]+?)+>)'
});
Object.extend(Canviz.prototype, {
	// ID or ID:port or ID:compassPoint or ID:port:compassPoint
	nodeIdMatch: Canviz.prototype.idMatch + '(?::' + Canviz.prototype.idMatch + ')?(?::' + Canviz.prototype.idMatch + ')?'
});
Object.extend(Canviz.prototype, {
	graphMatchRe: new RegExp('^(strict\\s+)?(graph|digraph)(?:\\s+' + Canviz.prototype.idMatch + ')?\\s*{$', 'i'),
	subgraphMatchRe: new RegExp('^(?:subgraph\\s+)?' + Canviz.prototype.idMatch + '?\\s*{$', 'i'),
	nodeMatchRe: new RegExp('^(' + Canviz.prototype.nodeIdMatch + ')\\s+\\[(.+)\\];$'),
	edgeMatchRe: new RegExp('^(' + Canviz.prototype.nodeIdMatch + '\\s*-[->]\\s*' + Canviz.prototype.nodeIdMatch + ')\\s+\\[(.+)\\];$'),
	attrMatchRe: new RegExp('^' + Canviz.prototype.idMatch + '=' + Canviz.prototype.idMatch + '(?:[,\\s]+|$)')
});


}('undefined' !== typeof exports ? exports : window));

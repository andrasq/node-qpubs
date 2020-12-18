'use strict';

var QPubs = require('./');

module.exports = {
    beforeEach: function(done) {
        var self = this;
        this.uut = new QPubs();
        this.calls = [];
        this.fn = function(v) { self.calls.push(v) };
        done();
    },

    'constructor': {
    },

    'listen': {
        'throws if no route': function(t) {
            var uut = this.uut;
            t.throws(function() { uut.listen() }, /bad route/);
            t.throws(function() { uut.listen(null) }, /bad route/);
            t.throws(function() { uut.listen({}) }, /bad route/);
            t.throws(function() { uut.listen(23) }, /bad route/);
            t.done();
        },
        'throws if no callback': function(t) {
            var uut = this.uut;
            t.throws(function() { uut.listen('mock.route') }, /bad callback/);
            t.throws(function() { uut.listen('mock.route', null) }, /bad callback/);
            t.throws(function() { uut.listen('mock.route', {}) }, /bad callback/);
            t.throws(function() { uut.listen('mock.route', 23) }, /bad callback/);
            t.done();
        },
        'throws if both ends wildcarded': function(t) {
            var uut = this.uut;
            function noop() {}
            t.throws(function() { uut.listen('*.foo.bar.*', noop) }, /cannot wildcard both/);
            t.throws(function() { uut.listen('*.*', noop) }, /cannot wildcard both/);
            t.throws(function() { uut.listen('*', noop) }, /cannot wildcard both/);
            t.done();
        },
        'adds listener': function(t) {
            this.uut.listen('foo', this.fn);
            this.uut.listen('foo.bar', this.fn);
            t.done();
        },
    },

    'emit': {
        'calls listener': function(t) {
            this.uut.listen('foo.bar', this.fn);
            this.uut.emit('foo.bar', 1);
            this.uut.emit('foo.bar', 23);
            t.deepEqual(this.calls, [1, 23]);
            t.done();
        },
        'calls prefix listener': function(t) {
            this.uut.listen('foo.*', this.fn);
            this.uut.emit('foo', 11);           // not matched: foo.* not matched by foo
            this.uut.emit('foo.bar', 2);
            this.uut.emit('bar', 21);
            this.uut.emit('bar.foo', 22);
            this.uut.emit('foo.bar.baz', 3);
// FIXME: emits a duplicate!
//            this.uut.emit('foo.', 4);
            t.deepEqual(this.calls, [2, 3]);
            t.done();
        },
        'calls suffix listener': function(t) {
            this.uut.listen('*.bar', this.fn);
            this.uut.emit('foo', 11);
            this.uut.emit('bar', 12);           // not matched: *.bar not matched by bar
            this.uut.emit('foo.bar', 2);
            this.uut.emit('bar.foo', 21);
            this.uut.emit('foo.bar.zed', 22);
            this.uut.emit('baz.foo.bar', 3);
            t.deepEqual(this.calls, [2, 3]);
            t.done();
        },
        'edge cases': {
            'matches separators exactly': function(t) {
                this.uut.listen('foo.', this.fn);
                this.uut.emit('foo', 1);
                this.uut.emit('foo.', 2);
                this.uut.emit('foo.bar', 3);
                t.deepEqual(this.calls, [2]);
                t.done();
            },
            'matches multiple separators': function(t) {
                this.uut.listen('.foo..', this.fn);
                this.uut.emit('foo', 1);
                this.uut.emit('foo.', 2);
                this.uut.emit('foo..', 3);
                this.uut.emit('.foo..', 4);
                this.uut.emit('.foo.', 5);
                this.uut.emit('.foo', 6);;
                this.uut.emit('foo.bar', 7);
                t.deepEqual(this.calls, [4]);
                t.done();
            },
        },
    },

    'ignore': {
        'removes 1-part listener': function(t) {
            this.uut.listen('foobar', this.fn);
            this.uut.emit('foobar', 1);
            this.uut.ignore('foobar', this.fn);
            this.uut.emit('foobar', 2);
            t.deepEqual(this.calls, [1]);
            t.done();
        },
        'removes 2-part listener': function(t) {
            this.uut.listen('foo.bar', this.fn);
            this.uut.emit('foo.bar', 1);
            t.deepEqual(this.calls, [1]);
            this.uut.ignore('foo.bar', this.fn);
            this.uut.emit('foo.bar', 2);
            t.deepEqual(this.calls, [1]);
            this.uut.listen('foo.bar', this.fn);
            this.uut.emit('foo.bar', 3);
            t.deepEqual(this.calls, [1, 3]);
            t.done();
        },
        'removes head listener': function(t) {
            this.uut.listen('foo.*', this.fn);
            this.uut.listen('foo.bar.*', this.fn);
            this.uut.emit('foo.bar.baz.bat', 1);
            t.deepEqual(this.calls, [1, 1]);
            this.uut.ignore('foo.*', this.fn);
            this.uut.emit('foo.bar.baz', 2);
            this.uut.emit('foo.fox.bat', 3);
            this.uut.emit('foo.', 4);
            t.deepEqual(this.calls, [1, 1, 2]);
            t.done();
        },
        'edge cases': {
            'removes 1 listener at a time, leaving others': function(t) {
                this.uut.listen('other', this.fn);
                this.uut.listen('foobar', this.fn);
                this.uut.listen('foobar', this.fn);
                this.uut.listen('other', this.fn);
                this.uut.emit('foobar', 1);
                t.deepEqual(this.calls, [1, 1]);
                this.uut.ignore('foobar', this.fn);
                this.uut.emit('foobar', 2);
                t.deepEqual(this.calls, [1, 1, 2]);
                this.uut.ignore('foobar', this.fn);
                this.uut.emit('foobar', 3);
                t.deepEqual(this.calls, [1, 1, 2]);
                this.uut.emit('other', 4);
                t.deepEqual(this.calls, [1, 1, 2, 4, 4]);
                t.done();
            },
            'ignores missing listeners': function(t) {
                this.uut.ignore('foobar', this.fn);
                this.uut.ignore('', this.fn);
                this.uut.listen('foobar', this.fn);
                this.uut.emit('foobar', 123);
                t.deepEqual(this.calls, [123]);
                t.done();
            },
        },
    },

    'performance': {
        'it notifies quickly': function(t) {
            var ncalls = 0;
            var uut = this.uut;
            uut.listen('some.longish.route', function(){ ncalls += 1 });
            uut.listen('some.other.longish.route', function(){ ncalls += 1 });
            uut.listen('some.third.longish.route', function(){ ncalls += 1 });
            uut.listen('some.even.longer.longish.route', function(){ ncalls += 1 });
            var nloops = 100000;
            console.time(nloops + ' emits');
            for (var i=0; i<nloops; i++) uut.emit('some.other.longish.route', 1);
            console.timeEnd(nloops + ' emits');
            // 23ms, this dumb benchmark is 3x faster if routes are hashed by length
            t.equal(ncalls, nloops);
            t.done();
        },
        'it compared to events': function(t) {
            var ncalls = 0;
            var ee = new (require('events')).EventEmitter();
            ee.on('some.longish.route', function(){ ncalls += 1 });
            ee.on('some.other.longish.route', function(){ ncalls += 1 });
            ee.on('some.third.longish.route', function(){ ncalls += 1 });
            ee.on('some.even.longer.longish.route', function(){ ncalls += 1 });
            var nloops = 100000;
            console.time(nloops + ' EE.emit');
            for (var i=0; i<nloops; i++) ee.emit('some.other.longish.route', 1);
            console.timeEnd(nloops + ' EE.emit');
            // 3.6ms, 6.4x faster
            t.equal(ncalls, nloops);
            t.done();
        },
    },
};

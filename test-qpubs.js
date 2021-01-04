/*
 * Copyright (C) 2020 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

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
            t.throws(function() { uut.listen() }, /bad topic/);
            t.throws(function() { uut.listen(null) }, /bad topic/);
            t.throws(function() { uut.listen({}) }, /bad topic/);
            t.throws(function() { uut.listen(23) }, /bad topic/);
            t.done();
        },
        'throws if no callback': function(t) {
            var uut = this.uut;
            t.throws(function() { uut.listen('mock.topic') }, /bad callback/);
            t.throws(function() { uut.listen('mock.topic', null) }, /bad callback/);
            t.throws(function() { uut.listen('mock.topic', {}) }, /bad callback/);
            t.throws(function() { uut.listen('mock.topic', 23) }, /bad callback/);
            t.done();
        },
        'throws if both ends wildcarded': function(t) {
            var uut = this.uut;
            function noop(v) {}
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
        'waits for callbacks': function(t) {
            this.uut.listen('foo.bar', function(v, cb) { cb() });
            this.uut.listen('foo.bar', function(v, cb) { cb() });
            this.uut.listen('foo.bar', function(v, cb) { setTimeout(cb, 10) });
            var t1 = Date.now();
            this.uut.emit('foo.bar', 123, function(err, errors) {
                var t2 = Date.now();
                t.ifError(err);
                t.ok(Array.isArray(errors));
                t.ok(t2 >= t1 + 10 - 1);        // beware the setTimeout off-by-one
                t.done();
            })
        },
        'callback is invoked immediately': function(t) {
            this.uut.listen('foo.bar', this.fn);
            this.uut.listen('foo.*', this.fn);
            var calls = this.calls;
            this.uut.emit('foo.bar', 1, function(err) {
                t.equal(err, null);
                t.deepEqual(calls, [1, 1]);
                t.done();
            });
            this.uut.emit('foo.bar', 2);
        },
        'calls prefix listener': function(t) {
            this.uut.listen('foo.*', this.fn);
            this.uut.emit('foo', 11);           // not matched: foo.* not matched by foo
            this.uut.emit('foo.bar', 2);
            this.uut.emit('bar', 21);
            this.uut.emit('bar.foo', 22);
            this.uut.emit('bar.foo.foo', 23);
            this.uut.emit('foo.bar.baz', 3);
            this.uut.emit('foo.', 4);
            t.deepEqual(this.calls, [2, 3, 4]);
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
            this.uut.emit('.bar', 4);
            t.deepEqual(this.calls, [2, 3, 4]);
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
            'matches empty leading topic component': function(t) {
                this.uut.listen('*.foo.bar', this.fn);
                this.uut.emit('.foo.bar', 1);
                t.deepEqual(this.calls, [1]);
                t.done();
            },
            'matches empty trailing topic component': function(t) {
                this.uut.listen('foo.bar.*', this.fn);
                this.uut.emit('foo.bar.', 1);
                t.deepEqual(this.calls, [1]);
                t.done();
            },
            'matches multiple separators': function(t) {
                this.uut.listen('.foo..', this.fn);
                this.uut.emit('foo', 1);
                this.uut.emit('foo.', 2);
                this.uut.emit('foo..', 3);
                this.uut.emit('.foo..', 4);
                this.uut.emit('.foo...', '4b');
                this.uut.emit('..foo..', '4c');
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

    'speed': {
        'it notifies quickly': function(t) {
            var ncalls = 0;
            var uut = this.uut;
            uut.listen('some.longish.topic', function(v, cb){ ncalls += 1; cb() });
            uut.listen('some.other.longish.topic', function(v, cb){ ncalls += 1; cb() });
            uut.listen('some.third.longish.topic', function(v, cb){ ncalls += 1; cb() });
            uut.listen('some.even.longer.longish.topic', function(v, cb){ ncalls += 1; cb() });
            var nloops = 100000;
            console.time(nloops + ' emits');
            for (var i=0; i<nloops; i++) uut.emit('some.other.longish.topic', 1);
            console.timeEnd(nloops + ' emits');
            // 22ms, this dumb benchmark is 3x faster if topics are hashed by length (4.5m/s)
            // (16ms if prefix match only, 27ms if always slice partials, but 20ms if list not hashed...)
            // (BUT: 68ms if list not hashed -- because of the undefined array subscript accesses? -- try indexOf()?)
            // NOTE: standalone is 13.6ms, so test suite deoptimizes
            // (of 13.6ms: 2ms to just call, 6ms to also find separators, 7ms hash, 10ms find list, 13ms traverse list)
            // (only 10ms if checking on only prefixes)
            t.equal(ncalls, nloops);
            t.done();
        },
        'it compared to events': function(t) {
            var ncalls = 0;
            var ee = new (require('events')).EventEmitter();
            ee.on('some.longish.topic', function(v){ ncalls += 1 });
            ee.on('some.other.longish.topic', function(v){ ncalls += 1 });
            ee.on('some.third.longish.topic', function(v){ ncalls += 1 });
            ee.on('some.even.longer.longish.topic', function(v){ ncalls += 1 });
            var nloops = 100000;
            console.time(nloops + ' EE.emit');
            for (var i=0; i<nloops; i++) ee.emit('some.other.longish.topic', 1);
            console.timeEnd(nloops + ' EE.emit');
            // 3.6ms, 6.4x faster (28m/s)
            t.equal(ncalls, nloops);
            t.done();
        },
    },
};

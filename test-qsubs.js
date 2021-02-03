'use strict';

var fs = require('fs');
var QSubs = require('./qsubs');

var fromBuf = parseInt(process.versions.node) > 6 ? Buffer.from : Buffer;

module.exports = {
    before: function() {
        this.dirname = '/tmp/qpubs.' + process.pid;
        try { fs.rmdirSync(this.dirname) } catch (e) {}
        this.mockPubs = { listen: noop, ignore: noop };
        this.uut = new QSubs(this.dirname, this.mockPubs);
    },

    afterEach: function() {
        try { fs.unlinkSync(this.dirname + '/index.json') } catch (e) {}
        try { fs.rmdirSync(this.dirname) } catch (e) {}
    },

    'constructor': {
        'sets dirname': function(t) {
            t.equal(this.uut.dirname, this.dirname);
            t.done();
        },
    },

    'loadSubscriptions': {
        'creates fifos for the f.* subscriptions found and configured': function(t) {
            var uut = this.uut;
            t.stubOnce(uut, 'loadIndex').returns({ subscriptions: { 'sub-1': 't-1', 'sub-3': 't-3', 'sub-4': 't-4' } });
            uut.loadSubscriptions(this.mockPubs);
            setTimeout(function() {
                t.ok(uut.fifos['sub-1']);
                t.ok(! uut.fifos['sub-2']);
                t.ok(uut.fifos['sub-3']);
                t.ok(uut.fifos['sub-4']);
                t.done();
            }, 2)
        },
    },

    'subscribe': {
    },

    'unsubscribe': {
        'cleans up': function(t) {
            var uut = this.uut;
            uut.mkdir_p(this.dirname);
            t.stubOnce(uut, 'loadIndex').returns({ subscriptions: { 'sub-1': 'top-1' } });
            uut.loadSubscriptions();
            var spyClose = t.spyOnce(uut.fifos['sub-1'], 'close');
            var spyUnlink = t.spy(fs, 'unlinkSync');
            var spySave = t.spy(uut, 'saveIndex');
            uut.unsubscribe('sub-1', function(err) {
                t.ifError(err);
                t.equal(uut.subscriptions['sub-1'], undefined);
                t.equal(uut.fifos['sub-1'], undefined);
                t.equal(uut.listeners['sub-1'], undefined);
                t.ok(spyClose.called);
                t.ok(spyUnlink.called);
                t.ok(spyUnlink.args[0][0], uut.dirname + '/f.sub-1');
                t.ok(spyUnlink.args[1][0], uut.dirname + '/f.sub-1.hd');
                t.ok(spySave.called);
                t.done();
            })
        },

        'edge cases': {
            'tolerates bad subId': function(t) {
                this.uut.unsubscribe('nonesuch-sub-id', t.done);
            },
            'tolerates missing subId': function(t) {
                this.uut.unsubscribe(null, t.done);
            },
        },
    },

    'helpers': {
        'loadIndex': {
            beforeEach: function() {
                this.uut.mkdir_p(this.dirname);
            },

            'reads index.json': function(t) {
                fs.writeFileSync(this.dirname + '/index.json', JSON.stringify({ a: 123, pid: process.pid }));
                t.deepEqual(this.uut.loadIndex(), { a: 123, pid: process.pid });
                t.done();
            },

            'returns empty object on missing file': function(t) {
                try { fs.unlinkSync(this.dirname + '/index.json') } catch (e) {}
                t.deepEqual(this.uut.loadIndex(), {});
                t.done();
            },

            'returns empty object on empty file': function(t) {
                fs.writeFileSync(this.dirname + '/index.json', '');
                t.deepEqual(this.uut.loadIndex(), {});
                t.done();
            },

            'returns empty object on bad json': function(t) {
                fs.writeFileSync(this.dirname + '/index.json', 'not a json file');
                t.deepEqual(this.uut.loadIndex(), {});
                t.done();
            },
        },

        'saveIndex': {
            'writes index.json': function(t) {
                this.uut.mkdir_p(this.dirname);
                var uut = this.uut;
                uut.subscriptions = { a: 123, pid: process.pid };
                uut.saveIndex(function(err) {
                    t.ifError(err);
                    var json = JSON.parse(fs.readFileSync(uut.dirname + '/index.json'));
                    t.deepEqual(json, { subscriptions: { a: 123, pid: process.pid } });
                    t.done();
                })
            },
        },

        'mkdir_p': {
            'creates directory': function(t) {
                this.uut.mkdir_p(this.dirname);
                fs.rmdirSync(this.dirname);
                t.done();
            },

            'creates an existing directory': function(t) {
                this.uut.mkdir_p(this.dirname);
                this.uut.mkdir_p(this.dirname);
                fs.rmdirSync(this.dirname);
                t.done();
            },

            'throws if exists but not a directory': function(t) {
                var self = this;
                fs.writeFileSync(self.dirname, 'x');
                t.throws(function() { self.uut.mkdir_p(self.dirname) }, /not a directory/);
                fs.unlinkSync(self.dirname);
                t.done();
            },
        },

        'serializeMessage': {
            'returns strings and buffers': function(t) {
                t.equal(this.uut.serializeMessage('hello'), 'hello');
                t.ok(Buffer.isBuffer(this.uut.serializeMessage(fromBuf('hello'))));
                t.equal(this.uut.serializeMessage(fromBuf('hello')).toString(), 'hello');
                t.done();
            },

            'returns JSON for objects': function(t) {
                t.equal(this.uut.serializeMessage({ a: 1 }), '{"a":1}\n');
                t.done();
            },

            'returns falsy if unable to serialize': function(t) {
                var o = {a: 1}; o.o = o;
                t.equal(this.uut.serializeMessage(o), '');
                t.done();
            },
        },
    },
}

function noop() {}

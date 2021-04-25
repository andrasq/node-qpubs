'use strict';

var fs = require('fs');
var QPubs = require('./qpubs');
var QSubs = require('./qsubs');
var QFifo = require('qfifo');

var fromBuf = parseInt(process.versions.node) > 6 ? Buffer.from : Buffer;
var noop = function(){};

module.exports = {
    before: function() {
        this.dirname = '/tmp/qpubs.' + process.pid;
        try { fs.rmdirSync(this.dirname) } catch (e) {}
    },

    beforeEach: function() {
        this.mockPubs = { listen: noop, unlisten: noop };
        this.fifoFactory = { create: function(file) { return new QFifo(file, { flag: 'r+' }) } };
        this.mockFifoFactory = { create: function(file, opts) {
            return {
                open: function() {},
                close: function() {},
                putline: function(line) {},
                getline: function() { return '' },
                readlines: function(cb) {},
                pause: function() {},
                resume: function() {},
            }
        } };
        this.uut = new QSubs(this.dirname, this.mockPubs, this.mockFifoFactory);
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
            uut.loadSubscriptions();
            setTimeout(function() {
                t.ok(uut.fifos['sub-1']);
                t.ok(! uut.fifos['sub-2']);
                t.ok(uut.fifos['sub-3']);
                t.ok(uut.fifos['sub-4']);
                t.done();
            }, 2)
        },
        'returns openSubscription error': function(t) {
            var uut = this.uut;
            uut.mkdir_p(uut.dirname);
            // need some subscriptions for openSubscription to be called
            fs.writeFileSync(uut.indexfile, JSON.stringify({ subscriptions: {sub1: 'topic1'} }));
            t.stubOnce(uut, 'openSubscription').yields('mock openSub error');
            uut.loadSubscriptions(function(err, errors) {
                t.equal(err, 'mock openSub error');
                t.done();
            })
        },
    },

    'saveSubscriptions': {
        'calls saveIndex': function(t) {
            var spy = t.stub(this.uut, 'saveIndex').yields(null, 'called=true');
            this.uut.saveSubscriptions(function(err, ret) {
                t.ok(spy.called);
                t.equal(ret, 'called=true');
                t.done();
            })
        },
    },

    'createSubscription': {
        'edge cases': {
            'requires topic and subId': function(t) {
                var uut = this.uut;
                t.throws(function() { uut.createSubscription() }, /topic.* required/);
                t.throws(function() { uut.createSubscription('t1') }, /subId.* required/);
                t.throws(function() { uut.createSubscription(1, 'id1') }, /topic.* required/);
                t.done();
            },
            'reuses an existing fifo': function(t) {
                var uut = this.uut;
                uut.fifos['sub23'] = 'mock fifo';
                uut.createSubscription('topic1', 'sub23', function(err, subId) {
                    t.equal(subId, 'sub23');
                    t.equal(uut.fifos['sub23'], 'mock fifo');
                    t.done();
                })
            },
        },
    },

    'deleteSubscription': {
        'closes the fifo': function(t) {
            var uut = this.uut;
            uut.createSubscription('t1', 'sub23', function(err, subId) {
                t.ifError(err);
                var spy = t.spyOnce(uut.fifos['sub23'], 'close');
                uut.deleteSubscription('t1', 'sub23', function(err, subId) {
                    t.ifError(err);
                    t.equal(subId, 'sub23');
                    t.ok(spy.called);
                    t.done();
                })
            })
        },
        'removes the fifo and saves the revised index': function(t) {
            var dirname = this.dirname;
            this.uut.fifos['sub123'] = this.mockFifoFactory.create();
            var spy = t.spyOnce(fs, 'unlinkSync');
            var spySave = t.spyOnce(this.uut, 'saveIndex');
            t.stubOnce(fs, 'writeFile').yields('writeFile ran');
            this.uut.deleteSubscription('t1', 'sub123', function(err, subId) {
                t.equal(err, 'writeFile ran');
                t.equal(subId, 'sub123');
                t.ok(spy.called);
                t.equal(spy.args[0][0], dirname + '/f.sub123');
                t.ok(spySave.called);
                t.done();
            })
        },
        'edge cases': {
            'returns false if subscription not found': function(t) {
                this.uut.deleteSubscription('topic123', 'nonesuch-subscription-id', function(err, subId) {
                    t.ifError(err);
                    t.strictEqual(subId, false);
                    t.done();
                })
            },
        },
    },

    'openSubscription': {
        'creates a fifo and listens on it': function(t) {
            var uut = this.uut;
            var spyListen = t.spy(uut.qpubs, 'listen');
            uut.fifoFactory = this.fifoFactory;
            uut.openSubscription('topic-1', 'sub-1', function(){
                t.equal(uut.subscriptions['sub-1'], 'topic-1');
                t.ok(uut.fifos['sub-1'] instanceof QFifo);
                t.equal(typeof uut.appenders['sub-1'], 'function');
                t.equal(spyListen.callCount, 1);
                t.equal(spyListen.args[0][0], 'topic-1');
                t.equal(spyListen.args[0][1], uut.appenders['sub-1']);
                t.done();
            })
        },

        'pubsub listener appends serializable messages to fifo': function(t) {
            var uut = this.uut;
            uut.openSubscription('topic-1', 'sub-1', function(err) {
                var circularObject = {}; circularObject.self = circularObject;
                var fifo = uut.fifos['sub-1'];
                var spy = t.stub(fifo, 'putline');
                var spyFlush = t.stub(fifo, 'fflush');
                uut.appenders['sub-1']('message-1\n', noop);
                uut.appenders['sub-1'](circularObject, noop);
                uut.appenders['sub-1']('message-2\n', noop);
                t.equal(spy.callCount, 2);
                t.deepEqual(spy.args, [ [ 'message-1\n' ], [ 'message-2\n' ] ]);
                t.done();
            })
        },

        'end-to-end': {
            'subscriber handler is called with published messages': function(t) {
                var qpubs = new QPubs();
                var fifoFactory = { create: function(file) { return new QFifo(file, { flag: 'a+' }) } };
                var qsubs = new QSubs(this.dirname, qpubs, fifoFactory);
                var messages = [];
                var callCount = 0;
                qsubs.openSubscription(
                    'topic-1', 'sub-9', {},
                    function(lines, cb) {
                        callCount += 1;
                        cb();
                        if (callCount === 1) {
                            // first two lines should have been batched
                            t.equal(lines, 'line1\nline22\n');
                        }
                        if (callCount === 2) {
                            // third line should arrive separately
                            t.equal(lines, 'line333\n');
                            t.done();
                        }
                    },
                    function(err) {
// FIXME: race: test sometimes does not finish! times out, messages not received
                        // publish 3 messagse to the topic
                        // line1 published immediately
                        qpubs.publish('topic-1', 'line1');
                        // line2 published soon, batched with line1
                        setTimeout(function() { qpubs.publish('topic-1', 'line22') }, 2);
                        // line3 published after first batch already sent
                        setTimeout(function() { qpubs.publish('topic-1', 'line333') }, 10);
                    }
                )
            },

        'edge cases': {
            'uses existing fifo if already subscribed': function(t) {
                this.uut.openSubscription('topic-1', 'sub-1', noop);
                var fifo1 = this.uut.fifos['sub-1'];
                this.uut.openSubscription('topic-1', 'sub-1', noop);
                var fifo2 = this.uut.fifos['sub-1'];
                t.equal(fifo2, fifo1);
                t.done();
            },
            'returns errors to emit() cb': function(t) {
                t.skip();
            }
        },
    },

    'closeSubscription': {
        'cleans up': function(t) {
            var uut = this.uut;
            uut.mkdir_p(uut.dirname);
            t.stubOnce(uut, 'loadIndex').returns({ subscriptions: { 'sub-1': 'top-1' } });
            uut.loadSubscriptions();
            uut.closeSubscription('top-1', 'sub-1', function(err) {
                t.ifError(err);
                t.equal(uut.subscriptions['sub-1'], undefined);
                // keeps the fifo and continues to listen and append messages
                t.equal(typeof uut.fifos['sub-1'], 'object');
                t.equal(typeof uut.appenders['sub-1'], 'function');
                t.done();
            })
        },

        'edge cases': {
            'tolerates bad subId': function(t) {
                this.uut.closeSubscription('topic-1', 'nonesuch-sub-id', t.done);
            },
            'can also delete subscription': function(t) {
                var uut = this.uut;
                uut.openSubscription('topic-1', 'sub-1', function(){}, function(err) {
                    t.ifError(err);
                    var spyClose = t.spyOnce(uut.fifos['sub-1'], 'close');
                    var spyUnlink = t.spy(fs, 'unlinkSync');
                    var spySave = t.spy(uut, 'saveIndex');
                    uut.closeSubscription('topic-1', 'sub-1', {delete: true}, function(err) {
                        t.ifError(err);
                        t.equal(uut.subscriptions['sub-1'], undefined);
                        t.ok(spyClose.called);
                        t.ok(spyUnlink.called);
                        t.ok(spyUnlink.args[0][0], uut.dirname + '/f.sub-1');
                        t.ok(spyUnlink.args[1][0], uut.dirname + '/f.sub-1.hd');
                        t.ok(spySave.called);
                        t.done();
                    })
                })
            },
            'throws if no topic or subId': function(t) {
                this.uut.closeSubscription('t1', 'id2', noop);
                var uut = this.uut;
                t.throws(function() { uut.closeSubscription() }, /required/);
                t.throws(function() { uut.closeSubscription('t1', noop) }, /required/);
                t.throws(function() { uut.closeSubscription('t1', noop, noop) }, /required/);
                t.throws(function() { uut.closeSubscription('t1', null, noop) }, /required/);
                t.throws(function() { uut.closeSubscription(null, 'id2', null, noop) }, /required/);
                t.done();
            },
            'throws if no callback': function(t) {
                this.uut.closeSubscription('t1', 'id2', noop);
                var uut = this.uut;
                t.throws(function() { uut.closeSubscription('t1', 'id2') }, /callback required/);
                t.done();
            },
            'hands off deletion to deleteSubscription': function(t) {
                var spy = t.stub(this.uut, 'deleteSubscription').yields();
                this.uut.fifos['id456'] = this.mockFifoFactory.create();
                this.uut.closeSubscription('t123', 'id456', { delete: true, other: 789 }, noop);
                t.ok(spy.called);
                t.deepEqual(spy.args[0], ['t123', 'id456', noop]);
                t.done();
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

            'returns undefined if unable to serialize': function(t) {
                var o = {a: 1}; o.o = o;
                t.strictEqual(this.uut.serializeMessage(o), undefined);
                t.done();
            },
        },
    },
}

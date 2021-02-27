/*
 * qpubs subscriptions
 *
 * Copyright (C) 2021 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2021-02-02 - AR.
 */

'use strict';

module.exports = QSubs;

var fs = require('fs');

var setImmediate = eval('global.setImmediate || function(fn) { process.nextTick(fn) }');

function QSubs( dirname, qpubs, fifoFactory ) {
    this.dirname = dirname;
    this.indexfile = dirname + '/index.json';
    this.needFifoDir = true;

    this.qpubs = qpubs;
    this.fifoFactory = fifoFactory;

    this.subscriptions = {};
    this.fifos = {};
    this.appenders = {};
    this.deliverers = {};
}

/*
 * Resubscribe to all registered subscriptions found in index.json
 * Typically called when restarting a stopped subscription service.
 */
QSubs.prototype.loadSubscriptions = function loadSubscriptions( callback ) {
    var fifoPatt = /^f\.(.*)$/;
    this.subscriptions = this.loadIndex().subscriptions;
    var subIds = Object.keys(this.subscriptions);
    // await N+1 calls, to run callback even if zero subscriptions
    var cb = _awaitCalls(subIds.length + 1, callback);
    for (var i = 0; i < subIds.length; i++) {
        var topic = this.subscriptions[subIds[i]];
        this.openSubscription(topic, subIds[i], cb);
    }
    cb(); // call cb() at least once to make sure callback() runs
}

/*
 * Checkpoint the state of the subscriptions
 */
QSubs.prototype.saveSubscriptions = function saveSubscriptions( callback ) {
    this.saveIndex(callback);
}

/*
 * Ensure that the specified subscription exists.
 */
QSubs.prototype.createSubscription = function createSubscription( topic, subId, options, callback ) {
    var args = normalizeArgs(topic, subId, options, callback);
    options = args.options, callback = args.callback;

    var fifo = this.fifos[subId];
    if (fifo) return callback(null, subId);     // all set if already exists

    if (this.needFifoDir) { this.mkdir_p(this.dirname); this.needFifoDir = false }
    // TODO: maybe hash to 2^N subdirs, eg 32
    fifo = this.fifoFactory.create(this.dirname + '/f.' + subId);
    this.fifos[subId] = fifo;
    this.subscriptions[subId] = topic;

    var self = this;
    var listener = function(message, cb) {
        var m = self.serializeMessage(message);
        if (!m) return cb(new Error('unable to serialize message'));
        fifo.putline(m);
        fifo.fflush(cb);
        // TODO: batch calls, flush less often
        cb();
    }
    this.appenders[subId] = listener;
    this.qpubs.listen(topic, listener);
    // TODO: track how long a subscription has been idle, and clean up (auto-unsubscribe) after a while
    callback(null, subId);
}

/*
 * Delete the given subscription, stop delivering its messages, discard its backlog.
 */
QSubs.prototype.deleteSubscription = function deleteSubscription( topic, subId, callback ) {
    callback = normalizeArgs(topic, subId, callback).callback;
    var fifo = this.fifos[subId];
    if (!fifo) return callback(null, false);

    this.qpubs.unlisten(this.subscriptions[subId], this.appenders[subId]);
    this.appenders[subId] = undefined;
    this.fifos[subId] = undefined;
    this.subscriptions[subId] = undefined;
    fifo.close();
    try { fs.unlinkSync(this.dirname + '/f.' + subId) } catch (e) {}
    try { fs.unlinkSync(this.dirname + '/f.' + subId + '.hd') } catch (e) {}
    this.saveIndex(function(err) {
        callback(err, subId);
    })
}

QSubs.prototype.openSubscription = function openSubscription( topic, subId, options, handler, callback ) {
    var args = normalizeArgs(topic, subId, options, handler, callback);
    options = args.options, handler = args.handler, callback = args.callback;
    var self = this;

    var fifo = this.fifos[subId];
    if (fifo) {
        if (options.delete === true) this.closeSubscription(topic, subId, options, subscribe);
        else if (options.reuse === false) callback(new Error(subId + ': exists, may not reuse'));
        else subscribe(null, subId);
    }
    else {
        if (options.delete === true) callback(null, false);
        else if (options.create === false) callback(new Error(subId + ': not found, may not create'));
        // the subscription does not exist, create it
        else this.createSubscription(topic, subId, subscribe);
    }

    function subscribe( err ) {
        var batchDataLimit = 2048 * 1024;   // 2 MB batches in bulk mode
        var batchTimeout = 5;               // wait 5 ms to grow batch before delivering
        // TODO: pass in limits and timeouts

        if (err || !handler) return callback(err);
        // TODO: allow multiple listeners, round-robin distribute messages
        if (self.deliverers[subId]) return callback(new Error(subId + ': already listening'));

        var retry = new Retry();
        var fifo = self.fifos[subId];
        var batchTimer;

        var lines = '';
        function deliverLine(line) {
            lines += line;
            while (lines.length < batchDataLimit && (line = fifo.getline())) lines += line;
            if (lines.length >= batchDataLimit || !self.subscriptions[subId]) deliverBatch();
            else if (!batchTimer) batchTimer = setTimeout(deliverBatch, batchTimeout);
        };
        function deliverBatch() {
            clearTimeout(batchTimer);
            fifo.pause();
            handler(lines, function(err) {
                // wait for the handler to ack receipt before advancing past the lines
                if (err) return setTimeout(function() { deliver('') }, retry.delay());
                fifo.rsync(function(err) {
// FIXME: fifo errors are fatal, fifo is broken, should close it
                    if (err) { self.closeSubscription(topic, subId, function(){}); return }
                    lines = '';
                    // the handler could have unsubscribed, check again
                    if (fifo.seekoffset > 10 * 1024 * 1024) {
// FIXME: need to periodically compact or rotate/reopen the fifo
                        // fifo.compact();
                        // ?? (or maybe rotate x -> x.1 ; rename x.1 to x.0 ; readlines x.0)
                    }
                    if (self.subscriptions[subId]) fifo.resume();
                })
            })
        }
        self.deliverers[subId] = deliverBatch;
        fifo.readlines(deliverLine);
        fifo.resume();
        callback();
    }
}

QSubs.prototype.closeSubscription = function closeSubscription( topic, subId, options, handler, callback ) {
    var args = normalizeArgs(topic, subId, options, handler, callback);
    options = args.options, handler = args.handler, callback = args.callback;

    var fifo = this.fifos[subId];
    if (!fifo) return callback(null, false);

    // TODO: match handler
    // if (!handler) return callback();

    this.fifos[subId].pause();                  // stop reading the fifo
    this.subscriptions[subId] = undefined;      // mark the fifo unsubscribed

    if (options.delete === true) this.deleteSubscription(topic, subId, callback);
    // TODO: options.discard (TBD: should it discard just the current backlog, or also stop listening?)
    else setImmediate(function() { callback(null, subId) });
}

// bounded linear backoff
function Retry( ) {
    this.maxDelay = 5000;
    this.addedDelay = 100;
    this.backoff = 0;
    this.delay = function delay() {
        return this.backoff >= this.maxDelay ? this.maxDelay : this.backoff += this.addedDelay;
    }
}

// Read and return the saved index file.
QSubs.prototype.loadIndex = function loadIndex( ) {
    try { return JSON.parse(String(fs.readFileSync(this.indexfile)) || '{}') } catch (err) { return {} }
}

// Generate an index file corresponding to the current state.
QSubs.prototype.saveIndex = function saveIndex( callback ) {
    var info = { subscriptions: this.subscriptions };
    // TODO: createTime, accessTime for stats and gc
    fs.writeFile(this.indexfile, JSON.stringify(info, null, 2), callback);
}

// create the directory if not exists, throw on error
QSubs.prototype.mkdir_p = function mkdir_p( dirname ) {
    try { if (!fs.statSync(dirname).isDirectory()) throw new Error(dirname + ': not a directory') }
    catch (err) { if (err.code === 'ENOENT') fs.mkdirSync(dirname); else throw err }
}

// stringify the message to a newline terminated string, else return falsy
QSubs.prototype.serializeMessage = function serializeMessage( m ) {
    if (typeof m === 'string' || Buffer.isBuffer(m)) return m;
    try { return JSON.stringify(m) + '\n' } catch (e) { return '' }
}

QSubs.prototype = toStruct(QSubs.prototype);
function toStruct(hash) { return toStruct.prototype = hash }


// extractTo from minisql
/**
function extractTo( dst, src, mask ) {
    for (var k in mask) dst[k] = src[k];
    return dst;
}
**/

function normalizeArgs( topic, subId, options, handler, callback ) {
    if (typeof topic !== 'string' || typeof subId !== 'string') throw new Error('string topic, subId required');
    if (typeof options === 'function') { callback = handler; handler = options; options = {} }
    if (!callback) { callback = handler; handler = null }
    if (typeof callback !== 'function') throw new Error('callback required');
    return { topic: topic, subId: subId, options: options, handler: handler, callback: callback };
}

// return a function that invokes callback after nexpect calls
function _awaitCalls( nexpect, callback ) {
    // TODO: time out
    var ndone = 0;
    var errors = [];
    return function(err) {
        ndone += 1;
        if (err) errors.push(err);
        if (ndone === nexpect && callback) callback(errors[0], errors);
    }
}

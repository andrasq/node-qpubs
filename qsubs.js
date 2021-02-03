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
var QFifo = require('qfifo');

function QSubs( dirname, qpubs ) {
    this.dirname = dirname;
    this.needFifoDir = true;
    this.qpubs = qpubs;
    this.fifos = {};
    this.subscriptions = {};
    this.listeners = {};
}

QSubs.prototype.loadSubscriptions = function loadSubscriptions( ) {
    var fifoPatt = /^f\.(.*)$/;
    this.subscriptions = this.loadIndex().subscriptions;
    for (var subId in this.subscriptions) {
        var topic = this.subscriptions[subId];
        this.subscribe(topic, subId);
    }
}

QSubs.prototype.subscribe = function subscribe( topic, subId ) {
    var fifo = this.fifos[subId];
    if (!fifo) {
        if (this.needFifoDir) { this.mkdir_p(this.dirname); this.needFifoDir = false }
        // TODO: maybe hash to 2^N subdirs, eg 32
        fifo = new QFifo(this.dirname + '/f.' + subId);
        this.fifos[subId] = fifo;
        this.subscriptions[subId] = topic;

        var self = this;
        var listener = function(message, cb) {
            var m = self.serializeMessage(message);
            if (!m) return cb(new Error('unable to serialize message'));
            fifo.putline(m);
            fifo.fflush(cb);
            // TODO: batch calls, flush less often
        }
        this.listeners[subId] = listener;
        this.qpubs.listen(topic, listener);
        // TODO: track how long a subscription has been idle, and clean up (auto-unsubscribe) after a week
    }
    // FIXME: arrange to deliver subscriptions to the registered recipient(s),
    // eg batch and ship via http callbacks
    return fifo;
}

QSubs.prototype.unsubscribe = function unsubscribe( subId, callback ) {
    var fifo = this.fifos[subId];
    if (!fifo) return callback();
    this.qpubs.ignore(this.subscriptions[subId], this.listeners[subId]);
    this.fifos[subId] = undefined;
    this.subscriptions[subId] = undefined;
    this.listeners[subId] = undefined;
    fifo.close();
    try { fs.unlinkSync(this.dirname + '/f.' + subId) } catch (e) {}
    try { fs.unlinkSync(this.dirname + '/f.' + subId + '.hd') } catch (e) {}
    this.saveIndex(callback);
}

QSubs.prototype.loadIndex = function loadIndex( ) {
    var filename = this.dirname + '/index.json';
    try { return JSON.parse(String(fs.readFileSync(filename)) || '{}') } catch (err) { return {} }
}

QSubs.prototype.saveIndex = function saveIndex( callback ) {
    var filename = this.dirname + '/index.json';
    var info = { subscriptions: this.subscriptions };
    // TODO: createTime, accessTime for stats and gc
    fs.writeFile(filename, JSON.stringify(info, null, 2), callback);
}

QSubs.prototype.mkdir_p = function mkdir_p( dirname ) {
    try { if (!fs.statSync(dirname).isDirectory()) throw new Error(dirname + ': not a directory') }
    catch (err) { if (err.code === 'ENOENT') fs.mkdirSync(dirname); else throw err }
}

QSubs.prototype.serializeMessage = function serializeMessage( m ) {
    if (typeof m === 'string' || Buffer.isBuffer(m)) return m;
    m = tryJsonEncode(m);
    return m ? m + '\n' : m;
}

function tryJsonEncode(m) { try { return JSON.stringify(m) } catch (e) { return '' } }

/*
 * small pubsub engine
 * Hook up to microrest or qrpc for a very lean pubsub service.
 *
 * Copyright (C) 2020-2021 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2020-12-17 - AR.
 */

'use strict';

module.exports = QPubs;

var fs = require('fs');
var QSubs = require('./qsubs');

function QPubs( options ) {
    options = options || {};
    this.separator = options.separator || '.';  // topic component separator
    this.wildcard = '*';                        // match-all component

    if (options.fifoDir) {
        this.subs = new QSubs(options.fifoDir);
        this.subs.loadSubscriptions();
    }

    this.topicListeners = {};                   // full-topic listeners foo.bar
    this.headListeners = {};                    // topic prefix listeners foo.*
    this.tailListeners = {};                    // topic suffix listeners *.bar
    this.substringListenerCounts = new Array(); // *-fix listener counts by substring length
    // TODO: 10ms interval timer to time out listener callbacks (and retry)
    for (var i=1; i<258; i++) this.substringListenerCounts[i] = 0;      // define properties for faster access
}

QPubs.prototype.listen = function listen( topic, func, _remove, tag ) {
    var yesRemove = (_remove === 'yes, remove not listen');
    var fn = func;
    tag = tag === undefined ? func : tag;
    if (!yesRemove) {
        if (typeof topic !== 'string') throw new Error('bad topic, expected string');
        if (typeof func !== 'function') throw new Error('bad callback, expected function');
        var fn = (func.length === 1) ? function(value, cb) { func(value); cb() } : func;

        if (fn.length > 2) throw new Error('bad listener, takes just a value and an optional callback');
        if (fn !== func) fn._tag = func;
    }
    var firstCh = topic[0], lastCh = topic[topic.length - 1];
    if (firstCh === this.wildcard && lastCh === this.wildcard) throw new Error('cannot wildcard both head and tail');

    var addOrRemove = yesRemove ? this._listenRemove : this._listenAdd;
    if (lastCh === this.wildcard) {
        addOrRemove.call(this, this.headListeners, topic, 0, topic.length - 1, fn, tag);
    } else if (firstCh === this.wildcard) {
        addOrRemove.call(this, this.tailListeners, topic, 1, topic.length, fn, tag);
    } else {
        addOrRemove.call(this, this.topicListeners, topic, 0, topic.length, fn, tag);
    }
}

QPubs.prototype.ignore = function ignore( topic, func ) {
    this.listen(topic, func, 'yes, remove not listen', func);
}

QPubs.prototype.emit = function emit( topic, value, callback ) {
    var ix = 0, ix2a, ix2b, sep = this.separator, len = topic.length;
    var state = { nexpect: 1, ndone: 0, error: null, done: null };
    state.done = _awaitCallbacks(1, callback || _noop, state);
    var liscounts = this.substringListenerCounts;
    this._listenEmit(this.topicListeners, topic, 0, len, value, state);
    while ((ix2a = topic.indexOf(sep, ix)) >= 0) {
        var ix2b = ix2a + sep.length;
        if (liscounts[_fingerprint(topic, 0, ix2b)]) this._listenEmit(this.headListeners, topic, 0, ix2b, value, state);
        if (liscounts[_fingerprint(topic, ix2a, len)]) this._listenEmit(this.tailListeners, topic, ix2a, len, value, state);
        ix = ix2b;
    }
    state.done(); // once all are notified, ack the initial "1" count and wait for the callbacks
}
function _noop(e, errs){}

// function sliceBefore(str, ix) { return slice(0, ix) }
// function sliceAfter(str, ix) { return slice(ix) }
// return a brief characteristic summary of the string
// (str[fm] + (to - fm) + str[to-1]) is smarter but 4x slower
// limit fingerprint range, {} access is faster indexed by small integers than large >300
function _fingerprint(str, fm, to) { return (to - fm) & 255 }
//function _fingerprint(str, fm, to) { return djb2(0, str, fm, to) % 257 } // djb2: 2x slower
function _setHashList(hash, topic, list) { return hash[topic] = list }
function _getHashList(hash, topic) { return hash[topic] }
function _hashInc(hash, k, n) { return hash[k] = hash[k] ? hash[k] + n : n }

// djb2: http://www.cse.yorku.ca/~oz/hash.html:  hash(i) = hash(i - 1) * 33 ^ str[i];
//function djb2( h, s, fm, to ) {
//    for (var i=fm; i<to; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0xffffff;
//    return h;
//}

QPubs.prototype._listenAdd = function _listenAdd( hash, route, ix, to, fn ) {
    var subroute = route.slice(ix, to);
    var list = _getHashList(hash, subroute) || _setHashList(hash, subroute, new Array());
    list.push(fn);
    _hashInc(this.substringListenerCounts, _fingerprint(route, ix, to), 1);
}
QPubs.prototype._listenRemove = function _listenRemove( hash, route, ix, to, fn, tag ) {
    var list = _getHashList(hash, route.slice(ix, to));
    if (!list) return;
    var ix = fn && list.indexOf(fn);
    if (ix < 0 && tag !== undefined) for (ix = 0; ix < list.length; ix++) if (list[ix]._tag === tag) break;
    if (ix >= 0 && ix < list.length) {
        for (var i = ix + 1; i < list.length; i++) list[i-1] = list[i];
        list.length -= 1;
        if (list.length === 0) hash[route.slice(ix, to)] = undefined;
        _hashInc(this.substringListenerCounts, _fingerprint(route, ix, to), -1);
    }
}
QPubs.prototype._listenEmit = function _listenEmit( hash, route, ix, to, value, state ) {
    var list = _getHashList(hash, route.slice(ix, to));
    if (!list) return;
    state.nexpect += list.length;
    for (var i = 0; i < list.length; i++) {
        list[i](value, state.done);
    }
}
function _awaitCallbacks( nexpect, callback, state ) {
    // TODO: time out
    var errors = [];
    return function(err) {
        if (err) { errors.push(err); if (!state.error) state.error = err }
        state.ndone += 1;
        if (state.ndone === state.nexpect) return callback(state.error, errors);
    }
}


QPubs.prototype.addListener = QPubs.prototype.listen;
QPubs.prototype.removeListener = QPubs.prototype.ignore;
QPubs.prototype.publish = QPubs.prototype.emit;
QPubs.prototype.subscribe = QPubs.prototype.listen;
QPubs.prototype.unsubscribe = QPubs.prototype.ignore;

QPubs.prototype = toStruct(QPubs.prototype);
function toStruct(p) { return toStruct.prototype = p }

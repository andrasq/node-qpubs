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


function QPubs( options ) {
    options = options || {};
    this.separator = options.separator || '.';  // topic component separator
    this.wildcard = '*';                        // match-all component
    this.topicListeners = {};                   // full-topic listeners foo.bar
    this.headListeners = {};                    // topic prefix listeners foo.*
    this.tailListeners = {};                    // topic suffix listeners *.bar
    // TODO: 10ms interval timer to time out listener callbacks (and retry)

    // accessing undefined properties is slow, pre-set them
    for (var i=0; i<258; i++) this.topicListeners[i] = this.headListeners[i] = this.tailListeners[i] = null;
}

QPubs.prototype.listen = function listen( topic, func, _remove ) {
    var yesRemove = (_remove === 'yes, remove not listen');
    if (typeof topic !== 'string') throw new Error('bad topic, expected string');
    if (typeof func !== 'function') throw new Error('bad callback, expected function');
    var fn = (!yesRemove && func.length === 1) ? function(value, cb) { func(value); cb() } : func;
    if (!yesRemove) {
        if (fn.length > 2) throw new Error('listener takes just a value and an optional callback');
        if (fn !== func) fn._fn = func;
    }
    var firstCh = topic[0], lastCh = topic[topic.length - 1];
    if (firstCh === this.wildcard && lastCh === this.wildcard) throw new Error('cannot wildcard both head and tail');

    var addOrRemove = yesRemove ? this._listenRemove : this._listenAdd;
    if (lastCh === this.wildcard) {
        addOrRemove(this.headListeners, topic, 0, topic.length - 1, fn);
    } else if (firstCh === this.wildcard) {
        addOrRemove(this.tailListeners, topic, 1, topic.length, fn);
    } else {
        addOrRemove(this.topicListeners, topic, 0, topic.length, fn);
    }
}

QPubs.prototype.ignore = function ignore( topic, func ) {
    this.listen(topic, func, 'yes, remove not listen');
}

QPubs.prototype.emit = function emit( topic, value, callback ) {
    var ix = 0, ix2, sep = this.separator, len = topic.length;
    var state = { nexpect: 1, ndone: 0, error: null, done: null };
    state.done = _awaitCallbacks(1, callback || _noop, state);
    this._listenEmit(this.topicListeners, topic, 0, len, value, state);
    while ((ix2 = topic.indexOf(sep, ix)) >= 0) {
        this._listenEmit(this.headListeners, topic, 0, ix2 + sep.length, value, state);
        this._listenEmit(this.tailListeners, topic, ix2, len, value, state);
        ix = ix2 + sep.length;
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
//function _fingerprint(str, fm, to) { return djb2(0, str, fm, to) % 257 } // djb2: 2.5x slower
function _setHashList(hash, topic, list) { return hash[topic] = list }
function _getHashList(hash, topic) { return hash[topic] }

// djb2: http://www.cse.yorku.ca/~oz/hash.html:  hash(i) = hash(i - 1) * 33 ^ str[i];
//function djb2( h, s, fm, to ) {
//    for (var i=fm; i<to; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0xffffff;
//    return h;
//}

QPubs.prototype._listenAdd = function _listenAdd( store, route, ix, to, fn ) {
    var tag = _fingerprint(route, ix, to);
    var hash = store[tag] || (store[tag] = {});
    var subroute = route.slice(ix, to);
    var list = _getHashList(hash, subroute) || _setHashList(hash, subroute, new Array());
    list.push(fn);
}
QPubs.prototype._listenRemove = function _listenRemove( store, route, ix, to, fn ) {
    var tag = _fingerprint(route, ix, to);
    var hash = store[tag], subroute, list;
    if (!hash || !(list = _getHashList(hash, (subroute = route.slice(ix, to))))) return;
    var ix = list.indexOf(fn);
    if (ix < 0) { for (ix = 0; ix < list.length; ix++) if (list[ix]._fn === fn) break }
    if (ix >= 0 && ix < list.length) {
        for (var i = ix + 1; i < list.length; i++) list[i-1] = list[i];
        list.length -= 1;
        if (list.length === 0) hash[subroute] = undefined;
    }
}
QPubs.prototype._listenEmit = function _listenEmit( store, route, ix, to, value, state ) {
    var tag = _fingerprint(route, ix, to);
    var hash = store[tag], list;
    if (!hash || !(list = _getHashList(hash, route.slice(ix, to)))) return;
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

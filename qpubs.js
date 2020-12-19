/*
 * small pubsub engine
 * Hook up to microrest or qrpc for a very lean pubsub service.
 *
 * Copyright (C) 2020 Andras Radics
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

    // accessing undefined properties is slow, pre-set them
    for (var i=0; i<258; i++) this.topicListeners[i] = this.headListeners[i] = this.tailListeners[i] = null;
}

QPubs.prototype.listen = function listen( topic, func, _remove ) {
    if (typeof topic !== 'string') throw new Error('bad topic, expected string');
    if (typeof func !== 'function') throw new Error('bad callback, expected function');

    var firstCh = topic[0], lastCh = topic[topic.length - 1];
    if (firstCh === this.wildcard && lastCh === this.wildcard) throw new Error('cannot wildcard both head and tail');

    var addOrRemove = _remove ? this._listenRemove : this._listenAdd;
    if (lastCh === this.wildcard) {
        addOrRemove(this.headListeners, topic, 0, topic.length - 1, func);
    } else if (firstCh === this.wildcard) {
        addOrRemove(this.tailListeners, topic, 1, topic.length, func);
    } else {
        addOrRemove(this.topicListeners, topic, 0, topic.length, func);
    }
}

QPubs.prototype.ignore = function ignore( topic, func ) {
    this.listen(topic, func, true);
}

QPubs.prototype.emit = function emit( topic, value, callback ) {
    var ix = 0, ix2, sep = this.separator, len = topic.length;
    this._listenEmit(this.topicListeners, topic, 0, len, value);
    while ((ix2 = topic.indexOf(sep, ix)) >= 0) {
        this._listenEmit(this.headListeners, topic, 0, ix2 + sep.length, value);
        this._listenEmit(this.tailListeners, topic, ix2, len, value);
        ix = ix2 + sep.length;
    }
    callback && callback();
}

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
    var hash = store[tag];
    var subroute = route.slice(ix, to);
    if (hash) var list = _getHashList(hash, subroute);
    var ix = list ? list.indexOf(fn) : -1; // remove just 1 listener, like EventEmitter
    if (ix >= 0) {
        for (var i = ix + 1; i < list.length; i++) list[i-1] = list[i];
        list.length -= 1;
        if (list.length === 0) hash[subroute] = undefined;
    }
}
QPubs.prototype._listenEmit = function _listenEmit( store, route, ix, to, value ) {
    var hash = store[_fingerprint(route, ix, to)];
    if (!hash) return;
    var subroute = route.slice(ix, to);
    var list = _getHashList(hash, subroute);
    if (list) for (var i = 0; i < list.length; i++) {
        list[i](value);
    }
    // TODO: pass in callback, wait for all listeners to acknowledge, call callback
    // TODO: if (list[i].length === 2) wait for the func to call its callback
    // TODO: segregate listeners by type -- with callback, and without (to not test in the loop)
}

QPubs.prototype.addListener = QPubs.prototype.listen;
QPubs.prototype.removeListener = QPubs.prototype.ignore;
QPubs.prototype.publish = QPubs.prototype.emit;
QPubs.prototype.subscribe = QPubs.prototype.listen;
QPubs.prototype.unsubscribe = QPubs.prototype.ignore;

QPubs.prototype = toStruct(QPubs.prototype);

function toStruct(p) { return toStruct.prototype = p }

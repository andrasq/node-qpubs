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
    this.separator = options.separator || '.';  // route component separator
    this.wildcard = '*';                        // match-all component
    this.routeListeners = {};                   // full-route listeners foo.bar
    this.headListeners = {};                    // prefix-route listeners foo.*
    this.tailListeners = {};                    // suffix-route listeners *.bar
}

QPubs.prototype.listen = function listen( route, func, _remove ) {
    if (typeof route !== 'string') throw new Error('bad route, expected string');
    if (typeof func !== 'function') throw new Error('bad callback, expected function');

    var firstCh = route[0], lastCh = route[route.length - 1];
    if (firstCh === this.wildcard && lastCh === this.wildcard) throw new Error('cannot wildcard both head and tail');

    var addOrRemove = _remove ? this._listenRemove : this._listenAdd;
    if (lastCh === this.wildcard) {
        addOrRemove(this.headListeners, route.slice(0, -1), func);
    } else if (firstCh === this.wildcard) {
        addOrRemove(this.tailListeners, route.slice(1), func);
    } else {
        addOrRemove(this.routeListeners, route, func);
    }
}

QPubs.prototype.emit = function emit( route, value, callback ) {
    var ix = 0, ix2, sep = this.separator;
    this._listenEmit(this.routeListeners, route, route.length, value);
    while ((ix2 = route.indexOf(sep, ix)) >= 0) {
        var prefLength = ix2, suffLength = route.length - ix2 - sep.length;
// FIXME: is an empty prefix/suffix route component valid, or only non-empty?  I.e., should foo.* match 'foo.'?
        if (prefLength) this._listenEmit(this.headListeners, route, ix2 + sep.length, value);
        if (suffLength) this._listenEmit(this.tailListeners, route, -(route.length - ix2), value);
        ix = ix2 + sep.length;
    }
// FIXME: is this final emit needed or not? (guessing not)
//    if (ix2 + sep.length < route.length) this._listenEmit(this.headListeners, route, route.length, value);
    callback && callback();
}

QPubs.prototype._listenAdd = function _listenAdd( store, route, fn ) {
    // TRY: group listeners by length, for quicker prefix/suffix pruning
    var hash = store[route.length] || (store[route.length] = {});
    var list = hash[route] || (hash[route] = new Array());;
    list.push(fn);
}
QPubs.prototype._listenRemove = function _listenRemove( store, route, fn ) {
    var hash = store[route.length];
    if (hash) var list = hash[route];
    // remove just 1 listener like EventEmitter
    var ix = list ? list.indexOf(fn) : -1;
    if (ix >= 0) {
        for (var i=ix+1; i<list.length; i++) list[i-1] = list[i];
        list.length -= 1;
        if (list.length === 0) delete store[route];
    }
}
QPubs.prototype._listenEmit = function _listenEmit( store, route, ix, value ) {
    // TRY: optimize away prefix/suffix slice if no listeners of that length
    // (but string slice has become very fast)
    var hash = ix >= 0 ? store[ix] : store[-ix];
    if (!hash) return;
    var partial = ix >= 0 ? (ix === route.length ? route : route.slice(0, ix)) : route.slice(ix);
    var list = hash[partial];
    if (list) for (var i=0; i<list.length; i++) list[i](value);
    // TODO: pass in callback, wait for all listeners to acknowledge, call callback
    // TODO: if (list[i].length === 2) wait for the func to call its callback
}

QPubs.prototype.ignore = function ignore( route, func ) {
    this.listen(route, func, true);
}

QPubs.prototype.addListener = QPubs.prototype.listen;
QPubs.prototype.removeListener = QPubs.prototype.ignore;

QPubs.prototype = toStruct(QPubs.prototype);

function toStruct(p) { return toStruct.prototype = p }

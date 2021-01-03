qpubs
=====

Simple, light-weight pub-sub engine modeled on Nodejs event emitters.

Summary
-------

    var pubs = new QPubs({ separator: '.' });
    pubs.listen('my.event', function(message) {
        console.log('message == %s', message);
        // => message == 42,
        //    message == 451
    })
    pubs.listen('your.*', function(msg) {
        console.log('msg == %s', msg);
        // => msg == 77
    })
    pubs.listen('*.event', function(ev) {
        console.log('ev == %s', ev);
        // => ev == 42
        //    ev == 77
        //    ev == 451
    })
    pubs.emit('my.event', 42);
    pubs.emit('your.event', 77);
    pubs.emit('my.event', 451);


Api
---

### new QPubs( [options] )

Construct and configure the pubsub engine.

Options:
- `separator` - string that separates topic components.  Default is a `.` dot.

### listen( topic, listener(message) )

Listen for messages published to the named `topic`.  Each received message is passed to all
interested `listener()`-s.  The wildcard `*` matches leading or trailing topic components
(one or the other, not both).  Route components are separated by the `separator` string passed to the
constructor.

### emit( topic, message [,callback(err)] )

Send the `message` to all the listeners listening to the topic.  If a `callback` is given,
it will be invoked once all recipients have seen the message.

### ignore( topic, listener )

Make the `listener` stop receiving messages from the given `topic`.  If `listen()` was called
multiple times for this topic with this `listener`, each `ignore()` undoes one listen.


<!--
Features
--------

- non-blocking: messages are accepted immediately, without blocking the sender
- durable: message sends survive a server crash, once acknowledged they will be sent
- preserves work: listeners are guaranteed to be notified at least once for each message
  (ie, messages do not disappear during a crash)
- routes are strings
- wildcard `*` prefix / suffix route component matching


Service Api
-----------

### server = qpubs.createServer( options )

### server.listen( port|options [,callback] )

### server.close( [callback] )

### Server Http Routes

- /listen?route
- /once?route
- /ignore?route
- /emit?route,value

### Server Qrpc Routes

    qrpc.connect(port, host, function() {
        qrpc.call('listen', function(err, msg) {
            console.log("received message:", msg);
            // => "received message: test message"
        })
        qrpc.call('emit', route, function(err) {
            // message sent
        })
    }


Design Notes
------------

- modified qrpc: checkpoint received line(s) before decoding (needs hook to access to line)
- need calls to addListener, removeListener, once, emit
- call to listenExclusive to be the only receipient of the message (ie, queue of workers waiting for work; server chooses worker)
- assumption is that most/all communication will be point-to-point, so no broadcast optimizations (ie, let bcast be O(n))
- all messages must be tagged with a unique id, saved to journal-in with id, saved to journal-out with id
  (after crash, restart loads the journal-in, subtracts journal-out, and re-processes the difference)
- journal is written in small bursts under an flock mutex
- ? limit on max payload? (ties up journal, etc)
- checkoint journal in batches every .01 sec
- acknowledge emit call after checkpoint
- messages are matched by a prefix/suffix matcher (build two matching regexes, keep in prefix hash/suffix hash)
- need a source of very very fast ids, ?faster than mongoid-js? (internal to the server, for call tracking -- use the message id?)
-->


Todo
----

- support callbacked notifications too
- think about incremental checksumming, both front-to-back and back-to-front


Changelog
---------

- 0.0.5 - faster unwatched subtopic skipping
- 0.0.4 - wildcard match empty leading/trailing route components
- 0.0.3 - hash routes by length, callback on emit()
- 0.0.2 - working version

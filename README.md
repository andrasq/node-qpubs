qpubs
=====

Simple, light-weight pub-sub library and service modeled on Nodejs event emitters.


Features
--------

- non-blocking: messages are accepted immediately, without blocking the sender
- durable: message sends survive a server crash, once acknowledged they will be sent
- preserves work: listeners are guaranteed to be notified at least once for each message
  (ie, messages do not disappear during a crash)
- routes are strings
- wildcard `*` prefix / suffix route component matching


Library Api
-----------

### listen( name, callback )

### emit( name, value [,callback] )

### once( name, callback )

### ignore( name, callback )


Service Api
-----------

### server = qpubs.createServer( options )

### server.listen( port|options [,callback] )

### server.close( [callback] )

### Server Http Routes

- /listen?name
- /once?name
- /ignore?name
- /emit?name,value

### Server Qrpc Routes

    qrpc.connect(port, host, function() {
        qrpc.call('listen', function(err, msg) {
            console.log("received message:", msg);
            // => "received message: test message"
        })
        qrpc.call('emit', name, function(err) {
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

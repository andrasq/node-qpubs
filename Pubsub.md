Quick PubSub Service
--------------------


## Pubsub Messaging

Pubsub messaging is a _message bus_ that replicates messages to multiple recipients in
near-real time.  Messages are _published_ to a _topic_ and delivered to all _subscribers_ to
the _topic_.  Message buffering, transport and delivery are abstracted away.  The message
format and contents are completely up to the application, but messages must be presented to
pubsub as newline terminated strings.

### pub = new QPubs( options )

Create a pubsub engine.

Options:
- `separator` - partitioned topic segment separator, default `.` dot.

### pub.publish( topic, message [,callback(err)] )

Send a message to the named topic.  Sending a message delivers it to each attached
subscriber.  The topic name must not have wildcards.  The message must be serialized to a
newline terminated string.  Serialization is up to the application, eg with JSON.stringify.
The callback is called once the message has been distributed.

### pub.subscribe( topic, deliver(message [,ack]), callback(err) )

Attach to the topic and arrange for the `deliver` function to be called with messages
published to the named topic.  If `deliver` takes two arguments, it will be called with a
callback `ack` that must be used to acknowledge receipt.

The topic name may contain a wildcard to mach subtopics.  Each subscriber will receive each
message, but order is not guaranteed.  Note that no metadata nor the topic is passed to
`deliver`, so if listening to wildcarded topics the message itself must disambiguate.

### pub.unsubscribe( topic, deliver, callback(err) )

Detach from the topic and stop calling `deliver` with messages from the topic.  The `topic`
string must be identical to that used to subscribe, and `deliver` must be the same function.


## Subscriptioned Messaging

Subscriptions add persistence to pubsub with durable message queueues.  The queues hold
messages sent to a topic not currently listened to, queued and delivered in the received
order.  Messages are removed from the queue once ack-ed as received.

Note that the message queues are persisted from pubsub topics, and are not written or
published to directly.

### sub = new QSubs( dirname, qpubs )

Manage subscriptions to `qpubs` topics, queueing messages into the `dirname` directory.

Options:
- `reopenInterval` TBD

### sub.openSubscription( topic, subId, [options,] [deliver(messages, ack(err)),] callback(err) )

Manage the subscription identified by `subId`.  Can create and listen to subscriptions.
The subscription id must be unique, even across different topics.  The topic name is present
for symmetry with the other calls, but is used only if creating a new subscription.
The `callback` is used to report success status.

If provided, arrange for `deliver` to be called with batches of the messages sent to `topic`.
When unsubscribed, store the messages in the subscription identified by `subId` for delivery later.
The `callback` is called to report subscription success/failure.

Batches are sent as concatenated strings, each newline terminated substring one message.
Waiting messages are sent first, in order, oldest first.  Serialized messages must not
contain newlines.  Separating and deserializing messages is up to the subscriber, eg with
split and JSON.parse.  The `ack` callback must be called for the messages to be consumed;
timing out or calling `ack` with an error will cause the messages to be resent.

`Options` control how the subscription is managed:
- `create` ok to create the subscription.  Default `true`, create if does not exist.
  If this option is false the subscription must already exist.
- `reuse` ok to reuse the subscription.  Default `true`, use the existing.
  If this option is false it then the subscription must not already exist and `create` must be true.
  If both `create` and `reuse` are false then cannot create and cannot reuse, and an error is returned.
- `discard` TBD (discard any currently queued messages and only deliver or save new ones.  Default `false`,
  keep and deliver the backlog)
- `pause` TBD (delivery)
- `resume` TBD
- `freeze` TBD (entire fifo)
- `unfreeze` TBD
- `batchDataLimit` TBD
- `batchWaitMs` TBD
- `delete` cancel the subscription, discard all its undelivered messages, and destroy the
  associated message queue.  Default `false`.  The discarded messages are lost.  The
  subscription will have to be created anew with a separate call before it can be used
  again.  This option trumps the others: if set to true, when the call returns the
  subscription will not exist,

### sub.closeSubscription( topic, subId, deliver, callback(err) )

Stop calling `deliver` with messages from `topic`, append them to the subscription message
queue instead.  Unsubscribing more than once is ok, but the subscription must already exist,
else an error is returned.  Unsubscribe just suspends message delivery, any messages that
accumulate will be delivered after the next `subscribe` call.  To cancel the subscription
the `delete` option must be set to `true`.  The `callback` is called once the listener has
been removed, or on error.

### sub.createSubscription( topic, subId, [options,] callback(err) )

Create a new subscription.  Same as calling `openSubscription` with `{create: true, reuse: false}`.

### sub.deleteSubscription( topid, subId, callback(err) )

Cancel the subscription.  Same as calling `openSubscription` with `{delete: true}`.


## Glossary

*message bus* conceptual data transport that lets everyone attached to the bus see all
  messages placed on the bus, often synonymous with _topic_; a messaging analogue to virtual
  networks
.BR
*message queue* in-order message store with semantics similar to _pubsub_ topics.
  Messages are delivered from the head of the queue; new messages are appended to the end.
.BR
*publish* place a message onto the _message bus_ identified by the _topic_; ie "post"
.BR
*pubsub* many-to-many message delivery via a conceptual _message bus_ with operations _publish_
  and _subscribe_; ie "message board"
.BR
*partitioning* letting a _topic_ specify more than one _message bus_, with delimited
  segments of the _topic_ naming _subtopics_.  Partitioning is typically done by segmenting
  the topic name with separators such as `/` or `.`, e.g. `host1.cpu.load` with implied
  subtopics `host1.*` and `host1.cpu.*`.  Each _subtopic_ acts as a separate _message bus_.
  Publishing to the topic simultaneously publishes to all its subtopics.  
  Implementations may choose to support prefix- `x.*`, suffix- `*.y`, or arbitrary
  wildcard-matched `*x*y*` subtopics.
.BR
*subscribe* arrange to receive copies of all messages sent to the _message bus_ identified by  _topic_; ie "read"
.BR
*subscription* a Google pubsub term referring to a _message queue_ with messages persisted
  from a _subscription_ to a specific _topic_.
.BR
*subscription id* a unique string that identifies the _subscription_.
.BR
*subtopic* additional _message bus_ implied by _partitioning_ a _topic_, typically indicated
  by delimited prefix or suffix substrings of the _topic_ name
.BR
*topic* unique name that identifies a _message bus_; a message "channel"
.BR

*message passing* is similar to _pubsub_ but with just one sender and one receiver
.BR
*send* message passing analogue to _publish_
.BR
*receive* the counterpart to _send_, message passing analogue to _subscribe_
.BR

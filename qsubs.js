/*
 * qpubs subscriptions
 *
 * 2021-02-02 - AR.
 */

module.exports = QSubs;

function QSubs( dirname ) {
    this.dirname = dirname;
    this.needFifoDir = true;
    this.fifos = {};
    this.subscriptions = {};
}

QSubs.prototype.loadSubscriptions = function loadSubscriptions( ) {
    var fifoPatt = /^f\.(.*)$/;
    this.subscriptions = JSON.parse(this.loadIndex(this.dirname + '/index.json'));
    var self = this;
    fs.readdir(this.dirname, function(err, files) {
        files = files || [];
        if (err && err.code !== 'ENOENT') throw err;
        files
        .map(function(filename) { return filename.match(fifoPatt) })
        .filter(function(match) { return !!match })
        .forEach(function (match) {
            var subId = match[1], topic = self.subscriptions[subId];
            if (topic) pubs.subscribe(topic, subId);
        })
        // TODO: maybe hash to 2^N subdirs, eg 32
    })
}

QSubs.prototype.saveSubscriptions = function saveSubscriptions( ) {
    // TODO: track dirname/index.json:sub.{subscribed,listened}
    this.saveIndex(this.dirname + '/index.json', this.subscriptions);
}

QSubs.prototype.loadIndex = function loadIndex( filename ) {
    try { return fs.readFileSync(filename) || '{}' } catch (err) { return '{}' }
}

QSubs.prototype.saveIndex = function saveIndex( filename, info ) {
    fs.writeFileSync(filename, JSON.stringify(info));
}

QSubs.prototype.subscribe = function subscribe( topic, subId ) {
    var fifo = this.fifos[subId];
    if (!fifo) {
        if (this.needFifoDir) { this.mkdir_p(this.dirname); this.needFifoDir = false }
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
        listener._tag = fifo;
        this.listen(topic, listener);
        // TODO: track how long a subscription has been idle, and clean up (auto-unsubscribe) after a week
    }
    // FIXME: arrange to deliver subscriptions to the registered recipient(s),
    // eg batch and ship via http callbacks
}

QSubs.prototype.unsubscribe = function unsubscribe( topic, subId ) {
    var fifo = this.fifos[subId];
    if (!fifo) return;
    this.listen(topic, null, 'yes, remove not listen', fifo);
    this.fifos[subId] = undefined;
    this.subscriptions[subId] = undefined;
    fifo.close();
    try { fs.unlinkSync(this.dirname + '/f.' + subId) } catch (e) {}
    try { fs.unlinkSync(this.dirname + '/f.' + subId + '.hd') } catch (e) {}
    this.saveSubscriptions(this.dirname);
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

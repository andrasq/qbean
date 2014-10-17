/**
 * Quicker beanstalkd client.  Batches traffic to and from the daemon,
 * and allows concurrent commands in arbitrary order without deadlock.
 *
 * Heartfelt thanks to beanstalk_client, which pioneered the way.
 *
 * Copyright (C) 2014 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

/* global module, require, global, setImmediate, Buffer */
/* jshint lastsemic: true */

'use strict';

module.exports = QBean;

var net = require('net');
var events = require('events');
var util = require('util');

// traditionally, beanstalk_client and fivebeans return the error strings
// and not error objects.  Maintain this behavior for comapatibility.
// Pass in error objects to capture the correct stack trace.
function makeError(err) {
    var errorsAsStrings = true;
    return errorsAsStrings ? err.message : err;
}

/**
 * Beanstalkd client.
 // TODO: make it take options and a list of streams (bonded beanstalks!)
 // TODO: get away from being an event emitter
 // TODO: support bonded streams (mux/demux requests onto streams)
 // TODO: w/ muxed support, separate read/read (fast) from delete (slow) traffic
 // TODO: close on exit
 */
function QBean( options, stream ) {
    if (!this || this === global) return new QBean(options, stream);
    events.EventEmitter.call(this);
    this.conn = null;
    this.callbacks = [];
    this._closing = false;

    this.open(stream);

    // qbean does the reply, but conn finds and extracts the reply bodies
    this.conn.setReplyHandler(this.handleReplies.bind(this));
}
util.inherits(QBean, events.EventEmitter);

QBean.prototype.open = function open( stream ) {
    this.conn = new Connection(stream);

    // for kqueue: emit a 'connect' event
    var self = this;
    stream.on('connect', function() { self.emit('connect'); });
    stream.on('error', function(err) { self.emit('error', err); });
    stream.on('close', function(err) { /* TBD */ });
}

QBean.prototype.close = function close( ) {
    this._closing = true;
    if (this.callbacks.length === 0) {
        // there are no calls in progress, shut down the connection now
        this.conn.close();
    }
};

/**
 * Buffered beanstalkd connection reader / writer.
 */
function Connection( stream ) {
    if (!this || this === global) {
        return new Connection(stream);
    }

    if (!stream) throw new Error("stream required");

    this.sendbuf = "";
    this.data = "";
    this._sendCount = 0;
    this._writeCount = 0;
    this._sendCallbacks = [];
    this.handleReplies = function(){ };

    var self = this;

    this.stream = stream;
    this.stream.on('data', function(chunk) {
        self.data += chunk.toString();
        self.handleReplies();
    });

    this.setReplyHandler = function setReplyHandler( handleReplies ) {
        this.handleReplies = handleReplies;
    };

    // terminate with extreme prejudice
    this.close = function close( ) {
        this.stream.end();
    };

    // sendCommand is fully async, non-blocking, without a callback
    this.sendCommand = function sendCommand( cmdline, dataline, cb ) {
        var self = this;
        // direct writes to the stream are 20% faster than write combining
        // TODO: deprecate the _runSender loop, the sendCallback stack, sendCount, writeCount
        // FIXME: batch callbacks and only call once guaranteed that job has hit durable store
        // (either locally in a kqueue journal, or in beanstalkd)
        // (direct writes to file streams are much faster if write combined)
        // nb: strings seem faster than buffers... go figure.
        //var datachunk = new Buffer(dataline ? cmdline + "\r\n" + dataline + "\r\n" : cmdline + "\r\n");
        var datachunk = dataline ? cmdline + "\r\n" + dataline + "\r\n" : cmdline + "\r\n";
        this.stream.write(datachunk, function(err, ret) {
            cb(err, ret);
        });

        //this._sendCount += 1;
        //this.sendbuf += dataline ? cmdline + "\r\n" + dataline + "\r\n"
        //                         : cmdline + "\r\n";
        //this._sendCallbacks.push(cb);
        //var self = this;
        ////if (!this._isSending) this._isSending = setImmediate(function(){ self._runSender() });
        //self._runSender();
    };

    this._runSender = function _runSender( ) {
        if (this.sendbuf === "") return (this._isSending = false);
        var bytebuf = new Buffer(this.sendbuf);
        this.sendbuf = "";
        var sends = this._sendCount;
        var writes = this._writeCount;
        var self = this;
        this.stream.write(bytebuf, function(err, nbytes) {
            if (err) err = makeError(new Error(err));
            self._writeCount = sends;
            // notify each sender in this batch that command was received
            // TODO: inside beanstalk, writes are only guaranteed durable
            // after a beanstalkd -f flush interval.  However, the job may
            // well have run sooner than that!
            for (var i=writes; i<sends; i++) {
                var cb = self._sendCallbacks.shift();
                cb(err);
            }
            self._isSending = setImmediate(function(){ self._runSender() });
        });
    };

    // convert the simple beanstalk yaml into a hash/list
    // handles strings and numbers in flat (non-nested) lists and hashes
    this.parseYaml = function( yaml ) {
        var hash = {}, list = [], hashEmpty = true;
        var nameEnd;
        function recoverYamlValue(value) {
            // in beanstalk, if it looks like a number, it is a number
            if (value.match(/^[0-9]+$/)) value = parseInt(value, 10);
            return value;
        }
        var lines = yaml.split("\n");
        for (var i=0; i<lines.length; i++) {
            var name, value;
            if (lines[i] === '---') {
                // discard --- section breaks
                continue;
            }
            else if (lines[i][0] === '-' && lines[i][1] === ' ') {
                // list item
                value = lines[i].slice(2);
                list.push(recoverYamlValue(value));
            }
            else if ((nameEnd = lines[i].indexOf(':')) >= 0) {
                // name/value
                name = lines[i].slice(0, nameEnd).trim();
                value = lines[i].slice(nameEnd+1).trim();
                hash[name] = recoverYamlValue(value);
                hashEmpty = false;
            }
            else {
                // output unrecognized non-blank lines lines unmodified
                if (lines[i]) list.push(lines[i].trim());
            }
        }
        return hashEmpty ? list : hash;
    };

    this.getReply = function getReply( ) {
        var reply;
        var eol = this.data.indexOf("\r\n");
        if (eol < 0) return false;

        // reserve and stats return data, have to fetch the results too
        var hasBody = (
            this.data.slice(0, 9) === 'RESERVED ' ||    // reserve
            this.data.slice(0, 6) === 'FOUND ' ||       // peek
            this.data.slice(0, 3) === 'OK '             // stats
        );
        if (hasBody) {
            // reply size bytecount is last word of reply line
            var bytecountPosition = this.data.lastIndexOf(' ', eol);
            var bytecount = parseInt(this.data.slice(bytecountPosition, eol), 10);
            var eol2 = this.data.indexOf("\r\n", eol+2+bytecount);
            if (eol2 < 0) return false;

            reply = {reply: this.data.slice(0, eol), body: this.data.slice(eol+2, eol2)};
            this.data = this.data.slice(eol2+2);
            if (reply.reply.slice(0, 3) === 'OK ' && reply.body.slice(0, 3) === '---') {
                // status commands return OK and yaml, convert into object
                reply.body = this.parseYaml(reply.body);
            }
        }
        else {
            reply = {reply: this.data.slice(0, eol), body: false};
            this.data = this.data.slice(eol+2);
        }
//console.log("AR: got reply", reply);
        return reply;
    };
}

QBean.prototype.runCommand = function runCommand( arglist, command, expects, sendsData ) {
    var self = this;
    var crlf = "\r\n";

    // parse the user command
    var cmdargs = [command];
    for (var i=0; i<arglist.length; i++) cmdargs.push(arglist[i]);

    var callback = cmdargs.pop();
    var dataline = false;

    // if was closed, prevent any new commands from being started
    if (this._closing) return callback(makeError(new Error("STREAM_CLOSED")));

    if (sendsData) {
        dataline = cmdargs.pop();
        if (typeof dataline !== 'string') return callback(makeError(new Error("job data must be a string")));
        cmdargs.push(dataline.length);
    }


    // assemble and send the beanstalkd command
    var cmdline = cmdargs.join(' ');

    // arrange to call the callback when its reply arrives
    // beanstalkd sends all replies in the same order as commands received
    this.callbacks.push({want: expects, cb: callback});

//console.log("AR: sendCommand of", cmdline, dataline);
    this.conn.sendCommand(cmdline, dataline, function(err) {
        // FIXME: if (err) a write error occurred... how to repatriate if sends are batched?
    });

    // runCommand is done.  The beanstalk reply will be sent to the caller via the callback.
};

QBean.prototype.handleReplies = function handleReplies( ) {
    var reply;
    while ((reply = this.conn.getReply())) {
        var caller = this.callbacks.shift();
        if (!caller) {
            // Tilt! internal error, should never happen.
            throw new Error("no callback to receive reply");
        }

        var replyArgs = reply.reply.split(' ');
        // response keyword is not returned, just (err, arg2, arg3, ... data)
        var response = replyArgs.shift();
        var err = (response !== caller.want) ? (typeof response === 'string' ? makeError(new Error(response)) : response) : null;
        if (reply.body) {
            // replace byte count (last arg on reply line) with the actual data
            replyArgs.pop();
            replyArgs.push(reply.body);
        }
        var cbArgs = [err];
        for (var i=0; i<replyArgs.length; i++) cbArgs.push(replyArgs[i]);
        caller.cb.apply({}, cbArgs);
    }
    if (this._closing && this.callbacks.length === 0) {
        // no more data expected, close the stream so the v8 event loop can exit
//console.log("AR: closing connection");
        this.conn.close();
    }
};

QBean.prototype.use = function() { this.runCommand(arguments, 'use', 'USING') };
QBean.prototype.put = function() { this.runCommand(arguments, 'put', 'INSERTED', true) };

QBean.prototype.watch = function() { this.runCommand(arguments, 'watch', 'WATCHING') };
QBean.prototype.ignore = function() { this.runCommand(arguments, 'ignore', 'IGNORED'); };
QBean.prototype.reserve = function() { this.runCommand(arguments, 'reserve', 'RESERVED'); };
QBean.prototype.reserve_with_timeout = function() { this.runCommand(arguments, 'reserve-with-timeout', 'RESERVED'); };

QBean.prototype.peek = function() { this.runCommand(arguments, 'peek', 'FOUND'); };
QBean.prototype.peek_ready = function() { this.runCommand(arguments, 'peek-ready', 'FOUND'); };
QBean.prototype.peek_delayed = function() { this.runCommand(arguments, 'peek-delayed', 'FOUND'); };
QBean.prototype.peek_buried = function() { this.runCommand(arguments, 'peek-buried', 'FOUND'); };

QBean.prototype.release = function() { this.runCommand(arguments, 'release', 'RELEASED'); };
QBean.prototype.delete = function() { this.runCommand(arguments, 'delete', 'DELETED'); };
QBean.prototype.destroy = function() { this.runCommand(arguments, 'delete', 'DELETED'); };      // alias for delete
QBean.prototype.touch = function() { this.runCommand(arguments, 'touch', 'TOUCHED'); };
QBean.prototype.bury = function() { this.runCommand(arguments, 'bury', 'BURIED'); };
QBean.prototype.kick = function() { this.runCommand(arguments, 'kick', 'KICKED'); };
QBean.prototype.kick_job = function() { this.runCommand(arguments, 'kick-job', 'KICKED'); };

QBean.prototype.stats = function() { this.runCommand(arguments, 'stats', 'OK'); };
QBean.prototype.stats_tube = function() { this.runCommand(arguments, 'stats-tube', 'OK'); };
QBean.prototype.stats_job = function() { this.runCommand(arguments, 'stats-job', 'OK'); };

QBean.prototype.list_tubes = function() { this.runCommand(arguments, 'list-tubes', 'OK'); };
QBean.prototype.list_tube_used = function() { this.runCommand(arguments, 'list-tube-used', 'USING'); };
QBean.prototype.list_tubes_watched = function() { this.runCommand(arguments, 'list-tubes-watched', 'OK'); };

QBean.prototype.pause_tube = function() { this.runCommand(arguments, 'pause-tube', 'PAUSED'); };

// quit closes the connection without returning a reply.  This will probably produce an error.
// note unlike all the other commands, end() does not take a callback
// NOTE: do not actually close the stream, that would interfere with reads still in progress.
// Beanstalkd closes the socket, instead of just closing its side, and we need to empty our read pipe.
QBean.prototype.quit = function() { this.close(); };
QBean.prototype.end = function() { this.close();  };              // alias for quit



// FIXME: other commands not listed


/**
 * Buffered data concatenated out of chunks in data Buffers.
 *
 * Copyright (C) 2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

/* global module, require, global, setImmediate, Buffer */
/* jshint lastsemic: true */


function Databuf( ) {
    this.chunks = new Array();          // data in array of Buffers
    this.start = 0;                     // offset into chunks[0] of next unread byte
};

Databuf.prototype.chunks = null;
Databuf.prototype.start = null;

// append the chunk to the end of the buffered data
Databuf.prototype.append = function append( chunk ) {
    if (typeof chunk === 'string') this.chunks.push(new Buffer(chunk));
    else this.chunks.push(chunk);
};

Databuf.prototype.isEmpty = function isEmpty( ) {
    return (!this.chunks.length || this.chunks.length === 1 && this.start >= this.chunks[0].length) ? true : false;
};

Databuf.prototype.length = function length( ) {
    var i, length = 0;
    for (i=0; i<this.chunks.length; i++) length += this.chunks[i].length;
    return length - this.start;
};

// remove and return the unread bytes up to bound offset into the buffer
// returns a Buffer / string, or false if not enough bytes have arrived yet
Databuf.prototype.shiftBytes = function shiftBytes( bound, asString, encoding ) {
    if (this.chunks.length < 1) return false;

    if (bound > this.chunks[0].length) {
        if (bound > this.length()) return false;
        // combine the buffers to coalesce the requested data
        if (this.start > 0) this.chunks[0] = this.chunks[0].slice(this.start);
        this.start = 0;
        this.chunks[0] = Buffer.concat(this.chunks);
        this.chunks.length = 1;
    }

    var ret = asString
        ? this.chunks[0].toString(encoding || 'utf8', this.start, bound)
        : this.chunks[0].slice(this.start, bound);
    this.start = bound;
    if (bound >= this.chunks[0].length) this.chunks.shift();

    return ret;
};

// locate the first occurrence of the 7-bit ascii str in the unread data
Databuf.prototype.indexOf = function indexOf( str, offset ) {
    if (this.chunks.length < 1) return -1;
    var pos;
    offset = offset || this.start;
    while ((pos = this._bufIndexOf(this.chunks[0], str, offset)) < 0 && this.chunks.length > 1) {
        // O(n^2) data copies in the number of buffers that have to be scanned
        this.chunks[0] = Buffer.concat([this.start ? this.chunks.shift().slice(this.start) : this.chunks.shift(), this.chunks[0]]);
        this.start = 0;
    }
    return (pos < 0) ? -1 : pos;
};


// locate the start of the 7-bit ascii string in the buffered data.
Databuf.prototype._bufIndexOf = function _bufIndexOf( buf, str, offset ) {
    var i, j;
    var firstChar = str.charCodeAt(0);
    for (i = offset || 0; i < buf.length - (str.length - 1); i++) {
        if (buf[i] === firstChar && this._bufHasSubstring(buf, str, i)) return i;
    }
    return -1;
};

// test whether the buffer has the 7-bit ascii substring at offset
// strings must be 7-bit ascii whose str.length === Buffer.byteLength(str)
Databuf.prototype._bufHasSubstring = function _bufHasSubstring( buf, str, offset ) {
    var j, end = offset + str.length;
    for (j=0; offset<end; j++, offset++) {
        if (buf[offset] !== str.charCodeAt(j)) return false;
    }
    return true;
};

// test whether the string contains the substring string at position i
Databuf.prototype._hasSubstring = function _isSubstring( string, substring, start ) {
    var i;
    start = start || 0;
    for (i=0; i<substring.length; i++) {
        if (string.charCodeAt(start+i) !== substring.charCodeAt(i)) return false;
    }
    return true;
}


module.exports = Databuf;
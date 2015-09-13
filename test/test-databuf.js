Databuf = require('../lib/databuf.js');

module.exports = {
    setUp: function(done) {
        this.cut = new Databuf();
        done();
    },

    'length and isEmpty': {
        'should return 0 for empty buf': function(t) {
            t.equal(0, this.cut.length());
            t.equal(this.cut.isEmpty(), true);
            t.done();
        },

        'should return length of single chunk': function(t) {
            this.cut.append(new Buffer("test string"));
            t.equal(11, this.cut.length());
            t.equal(this.cut.isEmpty(), false);
            t.done();
        },

        'should return total length of multiple chunks': function(t) {
            this.cut.append(new Buffer("test string"));
            this.cut.append(new Buffer("test2"));
            t.equal(16, this.cut.length());
            t.equal(this.cut.isEmpty(), false);
            t.done();
        },

        'should skip the consumed start and be empty once all read': function(t) {
            this.cut.append(new Buffer("test data"));
            this.cut.start = 3;
            t.equal(this.cut.length(), 6);
            t.equal(this.cut.isEmpty(), false);
            this.cut.start = 9;
            t.equal(this.cut.isEmpty(), true);
            t.done();
        },
    },

    'append': {
        'should gather buffers': function(t) {
            var buf = new Buffer("test data");
            this.cut.append(buf);
            t.equal(this.cut.chunks[0], buf);
            var buf2 = new Buffer("test2");
            this.cut.append(buf2);
            t.equal(this.cut.chunks[1], buf2);
            t.done();
        },

        'should gather strings as Buffers': function(t) {
            this.cut.append("test");
            t.equal(this.cut.chunks[0], "test");
            t.done();
        },
    },

    'indexOf': {
        'should return -1 if not found': function(t) {
            this.cut.append(new Buffer("test"));
            t.equal(this.cut.indexOf("\n"), -1);
            t.done();
        },

        'should find newline at start': function(t) {
            this.cut.append(new Buffer("\ntest"));
            t.equal(this.cut.indexOf("\n"), 0);
            t.done();
        },

        'should find newline at end': function(t) {
            this.cut.append(new Buffer("test\n"));
            t.equal(this.cut.indexOf("\n"), 4);
            t.done();
        },

        'should find newline in middle': function(t) {
            this.cut.append(new Buffer("test1\r\ntest2"));
            t.equal(this.cut.indexOf("\n"), 6);
            t.equal(this.cut.indexOf("\r\n"), 5);
            t.done();
        },

        'should not return an offset before start': function(t) {
            this.cut.append(new Buffer("\r\ntest1\r\ntest2"));
            this.cut.start = 4;
            t.equal(this.cut.indexOf("\r\n"), 7);
            t.done();
        },

        'should return offset in combined chunks': function(t) {
            this.cut.append("part1");
            this.cut.append("part2");
            this.cut.append("\nmore data");
            t.equal(this.cut.indexOf("\n"), 10);
            t.done();
        },

        'should start searching at offset': function(t) {
            this.cut.append("test1\r\ntest2\r\ntest3");
            t.equal(this.cut.indexOf("\r\n", 8), 12);
            t.done();
        },
    },

    'shiftBytes': {
        'should return the next unread portion of the data': function(t) {
            this.cut.append(new Buffer("test data"));
            t.deepEqual(this.cut.shiftBytes(3), new Buffer("tes"));
            t.equal(this.cut.start, 3);
            t.deepEqual(this.cut.shiftBytes(7), new Buffer("t da"));
            t.equal(this.cut.start, 7);
            t.done();
        },

        'should return Buffer by default': function(t) {
            var pos
            this.cut.append(new Buffer("line 1\nline 2\nline"));
            pos = this.cut.indexOf("\n");
            t.deepEqual(this.cut.shiftBytes(pos+1), new Buffer("line 1\n"));
            pos = this.cut.indexOf("\n");
            t.deepEqual(this.cut.shiftBytes(pos+1), new Buffer("line 2\n"));
            pos = this.cut.indexOf("\n");
            t.equal(pos, -1);
            t.done();
        },

        'should return string if specified': function(t) {
            var pos
            this.cut.append(new Buffer("line 1\nline 2\nline"));
            pos = this.cut.indexOf("\n");
            t.deepEqual(this.cut.shiftBytes(pos+1, true), "line 1\n");
            pos = this.cut.indexOf("\n");
            t.deepEqual(this.cut.shiftBytes(pos+1, true), "line 2\n");
            pos = this.cut.indexOf("\n");
            t.equal(pos, -1);
            t.done();
        },
    },

    '_bufHasSubstring': {
        'should match the substring against the Buffer at offset': function(t) {
            var buf = new Buffer("test string");
            t.equal(this.cut._bufHasSubstring(buf, "stri", 5), true);
            t.equal(this.cut._bufHasSubstring(buf, "stri", 4), false);
            t.equal(this.cut._bufHasSubstring(buf, "sTRi", 5), false);
            t.done();
        },
    },

    '_hasSubstring': {
        'should match substring against the string at offset': function(t) {
            t.equal(this.cut._hasSubstring("test string", "str", 5), true);
            t.equal(this.cut._hasSubstring("test string", "stra", 5), false);
            t.equal(this.cut._hasSubstring("test string", "st", 2), true);
            t.equal(this.cut._hasSubstring("test string", "ST", 2), false);
            t.equal(this.cut._hasSubstring("test string", "st", 1), false);
            t.equal(this.cut._hasSubstring("test string", "g", 10), true);
            t.equal(this.cut._hasSubstring("test string", "go", 10), false);
            t.done();
        },
    },
}

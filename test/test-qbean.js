'use strict';

var net = require('net');
var QBean = require('../index');

module.exports = {
    setUp: function(done) {
        this.stream = net.createConnection(11300, 'localhost');
        this.bean = new QBean({}, this.stream);
        done();
    },

    tearDown: function(done) {
        this.bean.close();
        done();
    },

    'should create client': function(t) {
        t.ok(this.bean);
        t.done();
    },

    'options should be optional': function(t) {
        var bean = new QBean(this.stream);
        t.done();
    },

    'stream should be required': function(t) {
        t.expect(1);
        try { var bean = new QBean(); t.ok(false); }
        catch (err) { t.ok(true); }
        t.done();
    },

    'should not send commands after closed': function(t) {
        this.bean.close();
        t.expect(2);
        this.bean.put(0, 0, 0, "payload", function(err, jobid) {
            t.ok(err);
            t.ok(err.message.indexOf("CLOSED") > 0);
            t.done();
        });
    },
};

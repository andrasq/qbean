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

    'should not send commands after closed': function(t) {
        this.bean.close();
        t.expect(1);
        this.bean.put(0, 0, 0, "payload", function(err, jobid) {
            t.ok(err);
            t.done();
        });
    },
};

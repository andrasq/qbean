'use strict';

var net = require('net');
var QBean = require('../index');

module.exports = {
    setUp: function(done) {
        var self = this;
        this.channel = 'qbean-unittest';
        this.stream = net.createConnection(11300, 'localhost', function() {
            self.bean = new QBean({}, self.stream);
            self.bean.use(self.channel, function(err, using) {
                return done(err);
            });
        });
    },

    tearDown: function(done) {
        this.stream.end();
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

    'should talk on two different streams': function(t) {
        var self = this;
        var socket2 = net.createConnection(11300, 'localhost', function() {
            var bean2 = new QBean({}, socket2);
            var ndone = 0;
            t.expect(2);
            bean2.watch('unittest2', function(err, watching) {
                t.ifError(err);
                bean2.ignore('unittest2', function(err) {
                    ndone += 1;
                    if (ndone == 2) { bean2.close(); t.done(); }
                })
            });
            self.bean.watch('unittest1', function(err, watching) {
                t.ifError(err);
                self.bean.ignore('unittest1', function(err) {
                    ndone += 1;
                    if (ndone == 2) { bean2.close(); t.done(); }
                });
            });
        })
    },

    'should put many messages concurrently': function(t) {
        var channel = this.channel;
        var i, ndone = 0;
        var data = {
            user : "unit test user",
            text : "unit test message"
        };
        var payload = JSON.stringify(data);
        function sendOnSocket(socket, n, cb) {
            var ndone = 0, bean = new QBean({}, socket);
            socket.on('connect', function() {
                bean.use(channel, function(err, using) {
                    if (err) cb(err)
                    for (var i=0; i<n; i++) bean.put(0, 0, 10, payload, function(err, jobid) {
                        ndone += 1;
                        if (err || ndone === n) cb(err)
                    })
                });
            });
        }
        var nputs = 20000, nsockets = 40;
        for (i=0; i<nsockets; i++) {
            var socket = net.connect(11300, 'localhost');
            sendOnSocket(socket, nputs/nsockets, function(err) {
                ndone += 1;
                if (ndone == nsockets) {
                    t.done(err);
                }
            });
        }
        // 53k/s for 10k single socket, 90k/s for 10k over 40 sockets
        // 67k/s for 100k over 40 sockets
    },

    'should purge old unittest messages': function(t) {
        var self = this;
        function purgeOverSocket(socket, cb) {
            var ndone = 0, bean = new QBean({}, socket);
            socket.on('connect', function() {
                bean.watch('unittest', function(err, watching) {
                    if (err) return cb(err);
                    // multiple concurrent per socket
                    for (var i=0; i<40; i++) (function consume() {
                        bean.reserve_with_timeout(0, function(err, jobid, payload) {
                            if (err || !jobid) {
                                bean.ignore('unittest', function(err) {
                                    ndone += 1;
                                    if (ndone === nsockets) t.done();
                                });
                                return cb();
                            }
                            bean.delete(jobid, function(err) {
                                setImmediate(consume);
                            })
                        });
                    })();
                });
            });
        }
        var nsockets = 40;
        var ndone = 0;
        t.expect(nsockets);
        for (var i=0; i<nsockets; i++) {
            var socket = net.connect(11300, 'localhost');
            purgeOverSocket(socket, function(err) {
                t.ifError(err);
                ndone += 1;
                if (ndone === nsockets) {
                    t.done();
                }
            })
        }
        // 20k/s 40 sockets, 40 concurrent on each; 24k/s 100 and 40
/***
        self.bean.watch('unittest', function(err, watching) {
            for (var i=0; i<nsockets; i++) (function consume() {
                self.bean.reserve_with_timeout(0, function(err, jobid, payload) {
                    if (err || !jobid) {
                        self.bean.ignore('unittest', function(err) {
                            t.ok(true);
                            ndone += 1;
                            if (ndone === nsockets) t.done();
                        });
                        return;
                    }
                    self.bean.delete(jobid, function(err) {
                        setImmediate(consume);
                    })
                });
            })();
        });
        // 10k/s 10k over 20 concurrent, 12.5k/s over 40, 13.7k over 200
        // 12.5k/s 100k over 40
        // 4-core cpu: 60% node, 50% beanstalkd
***/
    },
};

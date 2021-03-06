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
                self.using = using;
                if (err) return done(err);
                self.bean.watch(self.channel, function(err, watching) {
                    if (err) return done(err);
                    self.watchingCount = watching;
                    self.bean.ignore('default', function(err, watching) {
                        self.ignoringCount = watching;
                        done(err);
                    });
                });
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
        bean.close();
        t.done();
    },

    'stream should be required': function(t) {
        t.expect(1);
        try { var bean = new QBean(); t.ok(false); }
        catch (err) { t.ok(true); }
        t.done();
    },

    'writing a closed socket should return error': function(t) {
        this.stream.end();
        this.bean.list_tubes_watched(function(err, ret) {
            t.done();
        });
    },

    'should use tube': function(t) {
        t.equal(this.using, this.channel);
        t.done();
    },

    'should watch tube': function(t) {
        // watching 'default', added 'unittest'
        t.equal(this.watchingCount, 2);
        t.done();
    },

    'should ignore tube': function(t) {
        // ignored 1 of 2 watched, now watching 1
        t.equal(this.ignoringCount, 1);
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

    'should list tubes watched (should parse YAML)': function(t) {
        var self = this;
        self.bean.list_tubes_watched(function(err, watchList) {
            t.ifError(err);
            t.ok(watchList.indexOf(self.channel) >= 0);
            t.done();
        });
    },

    'should list all tubes': function(t) {
        var self = this;
        self.bean.list_tubes(function(err, tubesList) {
            t.ifError(err);
            t.ok(Array.isArray(tubesList));
            t.ok(tubesList.indexOf('default') >= 0);
            t.ok(tubesList.indexOf(self.channel) >= 0);
            t.done();
        });
    },

    'should ignore named tube': function(t) {
        var self = this;
        self.bean.watch(self.channel + "-2nd", function(err, watchingCount) {
            t.ifError(err);
            self.bean.ignore(self.channel, function(err, watchingCount) {
                t.ifError(err);
                self.bean.list_tubes_watched(function(err, watchList) {
                    t.ifError(err);
                    t.ok(watchList.indexOf(self.channel) < 0);
                    t.done();
                });
            });
        });
    },

    'should watch tube again': function(t) {
        var self = this;
        self.bean.watch(self.channel + "-2nd", function(err, watchingCount) {
            t.ifError(err);
            self.bean.list_tubes_watched(function(err, tubesList) {
                t.ifError(err);
                t.ok(tubesList.indexOf(self.channel + "-2nd") >= 0);
                t.done();
            });
        });
    },

    'should send and receive 8-bit characters in strings': function(t) {
        var self = this;
        var i, payload = "";
        for (i=0; i<256; i++) payload += String.fromCharCode(i);
        self.bean.use(self.channel + '-binary', function(err, using) {
            t.ifError(err);
            self.bean.put(0, 0, 10, payload, function(err, jobid) {
                t.ifError(err);
                self.bean.watch(self.channel + '-binary', function(err, watching) {
                    t.ifError(err);
                    self.bean.ignore(self.channel, function(err, watching) {
                        t.ifError(err);
                        self.bean.reserve_with_timeout(0, function(err, jobid, ret) {
                            t.ifError();
                            t.equal(ret, payload);
                            t.done();
                        });
                    });
                });
            });
        });
    },

    'should talk on two different streams': function(t) {
        var self = this;
        var socket2 = net.createConnection(11300, 'localhost', function() {
            var bean2 = new QBean({}, socket2);
            var ndone = 0;
            t.expect(2);
            bean2.watch(self.channel + "-v2", function(err, watching) {
                t.ifError(err);
                bean2.ignore(self.channel + "-v2", function(err) {
                    ndone += 1;
                    if (ndone == 2) { bean2.close(); t.done(); }
                })
            });
            self.bean.watch(self.channel + "-v1", function(err, watching) {
                t.ifError(err);
                self.bean.ignore(self.channel + "-v1", function(err) {
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
                        if (err || ndone === n) {
                            bean.close();
                            cb(err)
                        }
                    })
                });
            });
        }
        var nputs = 10000, nsockets = 40;
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
            var ndone = 0, bean = new QBean({}, socket), nconcurrent = 40;
            socket.on('connect', function() {
                bean.watch(self.channel, function(err, watching) {
                    if (err) return cb(err);
                    bean.watch(self.channel + '-binary', function(err, watching) {
                        if (err) return cb(err);
                        // multiple concurrent per socket
                        for (var i=0; i<nconcurrent; i++) (function purgeLoop() {
                            bean.reserve_with_timeout(0, function(err, jobid, payload) {
                                if (err || !jobid) {
                                    bean.close();
                                    if (++ndone >= nconcurrent) return cb();
                                }
                                bean.delete(jobid, function(err) {
                                    setImmediate(purgeLoop);
                                })
                            });
                        })();
                    });
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
        // 20k/s 40 sockets, 40 concurrent on each; 25k/s 40 and 100
    },

    'report mem usage': function(t) {
        console.log(process.memoryUsage());
        t.done();
    },
};

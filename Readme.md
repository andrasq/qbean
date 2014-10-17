qbean
=====

nodejs beanstalk client

Patterned after beanstalk_client (clever piece of code, that), but handles an
arbitrary mix of read/write requests without deadlock.  Started out as a
self-teaching exercise but was quickly transitioned into production when
fivebeans deadlocked on one of the kqueue tests.

See also [kqueue](https://github.com/Kinvey/kqueue).

    QBean = require('qbean');
    bean = new QBean(options, stream);
    
    bean.use(channel, function(err, using) {
      bean.put(jobpriority, jobdelay, jobttr, payload, function(err, jobid) {
        // ...
      });
    });

    bean.watch(channel, function(err, watching) {
      bean.reserve(function(err, jobid, payload) {
        // ...
      });
    });

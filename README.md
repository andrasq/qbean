qbean
=====

nodejs beanstalk client

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

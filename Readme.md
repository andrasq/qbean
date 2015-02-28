qbean
=====

nodejs [beanstalk](https://github.com/kr/beanstalkd) client

Patterned after beanstalk_client (clever piece of code, that), but handles an
arbitrary mix of read/write requests without deadlock.  Started out as a
self-teaching exercise but was quickly transitioned into production when
fivebeans deadlocked on one of the kqueue tests.

For the full beanstalk command list, see the
[Beanstalkd Protocol](https://github.com/kr/beanstalkd/blob/master/doc/protocol.md).

See also [kqueue](https://github.com/Kinvey/kqueue).

This is alpha quality code, it worked when tried, but no exhaustive testing
was done.  All the beanstalk commands should be supported, but I may have
missed some.

### Notes

QBean methods correspond directly to beanstalk commands (but with beanstalk
command hyphens replaced with underscores in the method name).  QBean commands
take one additional parameter, the callback.  The values from the beanstalk
responses are returned with the callback, which returns an error object as its
first parameter.

The delete call is supported both as `delete` and as `destroy`, for wider
compatibility with beanstalk clients (some languages do not allow the reserved
word 'delete' to be used for a method name.)

The `quit` method is used to gracefully shut down the connection on the local
side instead of sending a quit command to beanstalk and having it close the
connection.  This allows any remaining responses to be read from the socket.
`End` is an alias for quit, for compatibility.

The beanstalk stats commands return data in a simple yaml format.  QBean
parses the yaml and returns an object or a list, as appropriate.

Beanstalk limits tube names to at most 200 bytes.

QBean returns error objects on errors, not error strings.  However, for
compatibility, error strings are an option.

### Summary

    net = require('net');
    stream = net.createConnection(11300, 'localhost');
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

### new QBean( [options], stream )

connect to the beanstalk server via the stream.  Stream must be an open
network connection.  Each new QBean needs its own stream; beans can not
share network connections.

Options:

- `errorStrings` - on error return error messages, not error objects, for
  compatibility with other beanstalk drivers.  The default is to return objects.

        bean = new QBean({errorStrings: false}, net.createConnection(11300, 'localhost'));

#### close( )

do not accept any more commands, and close the connection stream once all
pending replies have been received.  A closed bean can not be re-opened; a new
bean should be created instead.

### Beanstalk Commands

Currently implemented (but not all tested):

#### use( tube_name, callback(error, tube_name) )

cause subsequent puts to go into the named tube.  The default is the tube
"default".  Returns the tube name now being used.

#### put( priority, delay, time_to_run, payload_string, callback(error, jobid) )

insert a job into the currently used tube.  priority 0 is the highest, 2^32-1
the lowest.  Returns the new jobid.

#### watch( tube_name, callback(error, watching_count) )

listen for messages in the named tube.  Returns the count of tubes currently
being watched.

#### ignore( tube_name, callback(error, watching_count) )

ignore messages from the named tube.  Returns the count of tubes currently
being watched.

#### reserve( callback(error, jobid, payload) )

fetch the next job from any of the watched tubes.  The job has time_to_run
seconds to be deleted (finished), released (skipped) or touched (timeout timer
restarted) before being automatically becoming eligible to be reserved again.

#### reserve_with_timeout( timeout, callback(error, jobid, payload) )

fetch the next job from any of the watched tubes, but do not wait longer than
timeout seconds.  If no jobs becomes available in that time, return without a
job.

#### peek( jobid, callback(error, jobid, payload) )

#### peek_ready( callback(error, jobid, payload) )

return the next ready job in the currently used tube.

#### peek_delayed( callback(error, jobid, payload) )

return the delayed job with the shortest delay left in the currently used
tube.

#### peek_buried( callback(error, jobid, payload) )

return the next buried job in the currently used tube.

#### release( jobid, priority, delay, callback(error) )

return the job to the queue, make it eligible to be reserved by someone else.
Priority and delay are as for put().

#### delete( jobid, callback(error) ), destroy( jobid, callback(error) )

remove the job from the queue, it's finished

#### touch( jobid, callback(error) )

restart the time_to_run timeout timer, giving the job longer to finish

#### bury( jobid, priority, callback(error) )

suspend the job, do not let it run until kicked.  The job will be assigned the
new priority.

#### kick( count, callback(error, count) )

re-enable up to count buried jobs in the currently used tube, letting them be
reserved again.

#### kick_job( jobid, callback(error) )

#### stats( callback(error, stats_object) )

#### stats_tube( tube_name, callback(error, stats_object) )

#### stats_job( jobid, callback(error, stats_object) )

#### list_tubes( callback(error, tubes_list) )

#### list_tube_used( callback(error, tube_name) )

#### list_tubes_watched( callback(error, tubes_list) )

#### pause_tube( tube_name, callback(error) )

#### quit( callback ), end( callback )

stop sending commands to beanstalk, wait for the remaining responses to
arrive, then close the connection.  This qbean object will not be usable to
talk to beanstalk any more (currently, the connection can't be reopened, a new
connection must be created).

### TODO

- write unit tests
- write integration tests
- subclass Error for the standard errors eg NOT_FOUND

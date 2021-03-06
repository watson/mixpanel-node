/*
    Heavily inspired by the original js library copyright Mixpanel, Inc.
    (http://mixpanel.com/)

    Copyright (c) 2012 Carl Sverre

    Released under the MIT license.
*/

var http            = require('http'),
    querystring     = require('querystring'),
    Buffer          = require('buffer').Buffer;

var create_client = function(token, config) {
    var metrics = {};
    
    if(!token) {
        throw new Error("The Mixpanel Client needs a Mixpanel token");
    }
    
    metrics.config = {
        test: false,
        debug: false
    };
    
    metrics.token = token;
    
    // private utility function
    var get_unixtime = function(when) {
        // if when is given and is a number, it is expected to be a unix
        // timestamp already, so there is no need to convert it.
        if (typeof(when) === 'number') return when;
        when = when || new Date();
        return Math.floor(when.getTime() / 1000);
    };
    
    /**
        send_request(data)
        ---
        this function sends an async GET request to mixpanel
        
        data:object                     the data to send in the request
        callback:function(err:Error)    callback is called when the request is
                                        finished or an error occurs
    */
    metrics.send_request = function(endpoint, data, callback) {
        callback = callback || function() {};
        var event_data = new Buffer(JSON.stringify(data));
        var request_data = {
            'data': event_data.toString('base64'),
            'ip': 0
        };

        if (endpoint === '/import') {
          var key = metrics.config.key;
          if (!key)
            throw new Error("The Mixpanel Client needs a Mixpanel api key when importing old events: `init(token, { key: ... })`");
          request_data.api_key = key;
        }
        
        var request_options = {
            host: 'api.mixpanel.com',
            port: 80,
            headers: {}
        };
    
        if (metrics.config.test) { request_data.test = 1; }
        
        var query = querystring.stringify(request_data);
        
        request_options.path = [endpoint,"?",query].join("");
        
        http.get(request_options, function(res) {
            var data = "";
            res.on('data', function(chunk) {
               data += chunk;
            });
            
            res.on('end', function() {
                var e = (data != '1') ? new Error("Mixpanel Server Error: " + data) : undefined;
                callback(e);
            });
        }).on('error', function(e) {
            if(metrics.config.debug) {
                console.log("Got Error: " + e.message);
            }
            callback(e);
        });
    };
    
    /**
        track(event, properties, callback)
        ---
        this function sends an event to mixpanel.

        If specifying the `time` property, the /import endpoint will be used.
        
        event:string                    the event name
        properties:object               additional event properties to send
        callback:function(err:Error)    callback is called when the request is
                                        finished or an error occurs
    */
    metrics.track = function(event, properties, callback) {
        if (typeof(properties) === 'function' || !properties) {
            callback = properties;
            properties = {};
        }

        // if an old event was given, use import endpoint
        var endpoint = properties.time ? '/import' : '/track';

        properties.token = metrics.token;
        properties.time = get_unixtime(properties.time);
        properties.mp_lib = "node";

        var data = {
            'event' : event,
            'properties' : properties
        };
        
        if(metrics.config.debug) {
            console.log("Sending the following event to Mixpanel:");
            console.log(data);
        }
        
        metrics.send_request(endpoint, data, callback);
    };

    metrics.people = {
        /**
            people.set(distinct_id, prop, to, callback)
            ---
            set properties on an user record in engage
        
            usage:
                
                mixpanel.people.set('bob', 'gender', 'm');

                mixpanel.people.set('joe', {
                    'company': 'acme',
                    'plan': 'premium'
                });
        */
        set: function(distinct_id, prop, to, callback) {
            var $set = {}, data = {};

            if (typeof(prop) === 'object') {
                callback = to;
                $set = prop;
            } else {
                $set[prop] = to;
            }

            var data = {
                '$set': $set,
                '$token': metrics.token,
                '$distinct_id': distinct_id
            }

            if(metrics.config.debug) {
                console.log("Sending the following data to Mixpanel (Engage):");
                console.log(data);
            }
            
            metrics.send_request('/engage', data, callback);
        },

        /**
            people.increment(distinct_id, prop, to, callback)
            ---
            increment/decrement properties on an user record in engage
        
            usage:

                mixpanel.people.increment('bob', 'page_views', 1);

                // or, for convenience, if you're just incrementing a counter by 1, you can
                // simply do
                mixpanel.people.increment('bob', 'page_views');

                // to decrement a counter, pass a negative number
                mixpanel.people.increment('bob', 'credits_left', -1);

                // like mixpanel.people.set(), you can increment multiple properties at once:
                mixpanel.people.increment('bob', {
                    counter1: 1,
                    counter2: 3,
                    counter3: -2
                });
        */
        increment: function(distinct_id, prop, by, callback) {
            var $add = {}, data = {};

            if (typeof(prop) === 'object') {
                callback = by;
                Object.keys(prop).forEach(function(key) {
                    var val = prop[key];

                    if (isNaN(parseFloat(val))) {
                        if (metrics.config.debug) {
                            console.error("Invalid increment value passed to mixpanel.people.increment - must be a number");
                            console.error("Passed " + key + ":" + val);
                        }
                        return;
                    } else {
                        $add[key] = val;
                    }
                });
            } else {
                if (!by) { by = 1; }
                $add[prop] = by;
            }

            var data = {
                '$add': $add,
                '$token': metrics.token,
                '$distinct_id': distinct_id
            }

            if(metrics.config.debug) {
                console.log("Sending the following data to Mixpanel (Engage):");
                console.log(data);
            }
            
            metrics.send_request('/engage', data, callback);
        },

        /**
            people.delete_user(distinct_id, callback)
            ---
            delete an user record in engage
        
            usage:

                mixpanel.people.delete_user('bob');
        */
        delete_user: function(distinct_id, callback) {
            var data = {
                '$delete': distinct_id,
                '$token': metrics.token,
                '$distinct_id': distinct_id
            };

            if(metrics.config.debug) {
                console.log("Deleting the user from engage:", distinct_id);
            }
            
            metrics.send_request('/engage', data, callback);
        }
    };
    
    /**
        set_config(config)
        ---
        Modifies the mixpanel config
        
        config:object       an object with properties to override in the
                            mixpanel client config
    */
    metrics.set_config = function(config) {
        for (var c in config) {
            if (config.hasOwnProperty(c)) {
                metrics.config[c] = config[c];
            }
        }
    };

    if (config) {
        metrics.set_config(config);
    }
    
    return metrics;
};

// module exporting
module.exports = {
    Client: function(token) {
        console.warn("The function `Client(token)` is deprecated.  It is now called `init(token)`.");
        return create_client(token);
    },
    init: create_client
};

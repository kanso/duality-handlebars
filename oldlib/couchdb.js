/*global Buffer: false */

/**
 * Module dependencies
 */

var url = require('url'),
    http = require('http'),
    https = require('https'),
    logger = require('./logger'),
    querystring = require('querystring');


var STATUS_MSGS = {
    400: '400: Bad Request',
    401: '401: Unauthorized',
    402: '402: Payment Required',
    403: '403: Forbidden',
    404: '404: Not Found',
    405: '405: Method Not Allowed',
    406: '406: Not Acceptable',
    407: '407: Proxy Authentication Required',
    408: '408: Request Timeout',
    409: '409: Conflict',
    410: '410: Gone',
    411: '411: Length Required',
    412: '412: Precondition Failed',
    413: '413: Request Entity Too Large',
    414: '414: Request-URI Too Long',
    415: '415: Unsupported Media Type',
    416: '416: Requested Range Not Satisfiable',
    417: '417: Expectation Failed',
    418: '418: I\'m a teapot',
    422: '422: Unprocessable Entity',
    423: '423: Locked',
    424: '424: Failed Dependency',
    425: '425: Unordered Collection',
    444: '444: No Response',
    426: '426: Upgrade Required',
    449: '449: Retry With',
    450: '450: Blocked by Windows Parental Controls',
    499: '499: Client Closed Request',
    500: '500: Internal Server Error',
    501: '501: Not Implemented',
    502: '502: Bad Gateway',
    503: '503: Service Unavailable',
    504: '504: Gateway Timeout',
    505: '505: HTTP Version Not Supported',
    506: '506: Variant Also Negotiates',
    507: '507: Insufficient Storage',
    509: '509: Bandwidth Limit Exceeded',
    510: '510: Not Extended'
};


var CouchDB;

/**
 * Convenience method for creating a CouchDB object instance.
 *
 * @param {String} db_url
 * @api public
 */

var exports = module.exports = function (db_url) {
    return new CouchDB(db_url);
};

/**
 * The CouchDB object constructor.
 *
 * @class CouchDB
 * @constructor
 * @param {String} db_url
 * @api public
 */

CouchDB = exports.CouchDB = function (db_url) {
    var ins = this.instance = url.parse(db_url);
    if (!ins.port) {
        if (ins.protocol === 'https:') {
            ins.port = 443;
        }
        else {
            ins.port = 80;
        }
    }
};

/**
 * Tests if a database exists, creates it if not.
 *
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.ensureDB = function (callback) {
    var that = this;
    this.exists('', function (err, exists) {
        if (err || exists) {
            return callback(err, that);
        }
        that.createDB(callback);
    });
};

/**
 * Creates a database.
 *
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.createDB = function (callback) {
    this.client('PUT', '', null, callback);
};

/**
 * Convenience HTTP client for querying a CouchDB instance. Buffers and parses
 * JSON responses before passing to callback. JSON.stringify's data before
 * sending.
 *
 * @param {String} method
 * @param {String} path
 * @param data
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.client = function (method, path, data, callback) {
    var pathname = this.instance.pathname;
    path = (pathname ? pathname + '/' + path: '/' + path);
    path = path.replace(/^\/\/+/, '/');

    var headers = {
        'Host': this.instance.hostname,
        'Accept': 'application/json'
    };
    if (method === 'POST' || method === 'PUT') {
        if (typeof data !== 'string') {
            try {
                data = JSON.stringify(data);
            }
            catch (e) {
                return callback(e);
            }
        }
        headers['Content-Type'] = 'application/json';
    }
    else if (data) {
        path = url.parse(path).pathname + '?' + querystring.stringify(data);
    }

    if (this.instance.auth) {
        var auth = decodeURIComponent(this.instance.auth);
        var enc = new Buffer(auth).toString('base64');
        headers.Authorization = "Basic " + enc;
    }

    var proto = (this.instance.protocol === 'https:') ? https: http;

    var request = proto.request({
        host: this.instance.hostname,
        port: this.instance.port,
        method: method,
        path: path,
        headers: headers
    });

    logger.debug('request', method + ' ' + path);
    logger.debug('request headers', headers);
    logger.debug('request data', data);

    request.on('response', function (response) {
        logger.debug('response:', {
            headers: response.headers,
            url: response.url,
            method: response.method,
            statusCode: response.statusCode
        });
        var buffer = [];
        response.on('data', function (chunk) {
            buffer.push(chunk.toString());
        });
        response.on('end', function () {
            var data = buffer.length ? JSON.parse(buffer.join('')): null;
            logger.debug('data:', data);
            if (response.statusCode >= 300) {
                if (data && data.error) {
                    var err = new Error(
                        data.error + (data.reason ? '\n' + data.reason: '')
                    );
                    err.error = data.error;
                    err.reason = data.reason;
                    err.response = response;
                    callback(err, data, response);
                }
                else {
                    var err2 = exports.statusCodeError(response.statusCode);
                    err2.response = response;
                    callback(err2, data, response);
                }
            }
            else {
                process.nextTick(function () {
                    callback(null, data, response);
                });
            }
        });
    });

    if (data && (method === 'POST' || method === 'PUT')) {
        request.write(data, 'utf8');
    }
    request.end();

    //logger.debug('request:', request.output[0]);
};

/**
 * Creates an error object with a message depending on the HTTP status code
 * of a response.
 */

exports.statusCodeError = function (code) {
    if (code in STATUS_MSGS) {
        return new Error(STATUS_MSGS[code]);
    }
    return new Error('Status code: ' + code);
};

/**
 * Encodes a document id or view, list or show name.
 *
 * @name encode(str)
 * @param {String} str
 * @returns {String}
 * @api public
 */

exports.encode = function (str) {
    return encodeURIComponent(str).replace(/^_design%2F/, '_design/');
};

/**
 * Test if a doc exists in the db by doing a HEAD request - doesn't fetch
 * the whole document.
 *
 * @param {String} id
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.exists = function (id, callback) {
    id = exports.encode(id || '');
    this.client('HEAD', id, null, function (err, data, res) {
        res = res || {};
        if (res.statusCode !== 404 && err) {
            return callback(err);
        }
        var exists = (res.statusCode === 200);
        var etag = res.headers.etag;
        var _rev = etag ? etag.substr(1, etag.length - 2): null;
        callback(null, exists, _rev);
    });
};

/**
 * Retrieve a document from a CouchDB instance.
 *
 * @param {String} id
 * @param {Object} data
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.get = function (id, /*optional*/data, callback) {
    if (arguments.length < 3) {
        callback = data;
        data = null;
    }
    id = exports.encode(id || '');
    this.client('GET', id, data, callback);
};

/**
 * Saves a document to a CouchDB instance.
 *
 * Options:
 *      {Boolean} force - write document regardless of conflicts!
 *
 * @param {String} id
 * @param {Object} doc
 * @param {Object} options
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.save = function (id, doc, /*optional*/options, callback) {
    var that = this;

    if (!callback) {
        callback = options;
        options = {};
    }
    var method = id ? 'PUT': 'POST';
    var path = exports.encode(id || '');

    if (options.force && id) {
        // WARNING! this is a brute-force document update
        // updates revision number to latest revision before saving
        this.exists(id, function (err, exists, rev) {
            if (err) {
                return callback(err);
            }
            if (exists) {
                doc._rev = rev;
            }
            that.client(method, path, doc, function (err, d) {
                if (err) {
                    return callback(err);
                }
                doc._id = d.id;
                doc._rev = d.rev;
                callback(null, doc);
            });
        });
    }
    else {
        this.client(method, path, doc, callback);
    }
};

/**
 * Deletes a document from a CouchDB instance.
 *
 * Options:
 *      {Boolean} force - delete document regardless of conflicts!
 *
 * @param {String} id
 * @param {Object} rev
 * @param {Object} options
 * @param {Function} callback
 * @api public
 */

CouchDB.prototype.delete = function (id, rev, /*optional*/options, callback) {
    var that = this;

    if (!callback) {
        callback = options;
        options = {};
    }
    var args = {};
    if (rev) {
        args.rev = rev;
    }
    var path = exports.encode(id || '');

    if (options.force) {
        // WARNING! this is a brute-force document delete
        // updates revision number to latest revision before deleting
        this.exists(id, function (err, exists, rev) {
            if (err) {
                return callback(err);
            }
            if (exists) {
                args.rev = rev;
            }
            that.client('DELETE', path, args, callback);
        });
    }
    else {
        this.client('DELETE', path, args, callback);
    }
};


CouchDB.prototype.uuids = function (count, callback) {
    if (!callback) {
        callback = count;
        count = undefined;
    }
    count = count || 1;
    this.client('GET', '_uuids', {count: count}, function (err, data) {
        callback(err, data.uuids);
    });
};

/*!
 * Module dependencies.
 */

var Schema = require('./schema')
    , SchemaType = require('./schematype')
    , VirtualType = require('./virtualtype')
    , Types = require('./types')
    , Promise = require('./promise')
    , Model = require('./model')
    , Document = require('./document')
    , utils = require('./utils')
    , format = utils.toCollectionName;

/**
 * Mongoose constructor.
 *
 * The exports object of the `mongoose` module is an instance of this class.
 * Most apps will only use this one instance.
 *
 * @api public
 */

function Mongoose() {
  this.connections = [];
  this.plugins = [];
  this.models = {};
  this.modelSchemas = {};
  this.options = {};
  this.createConnection(); // default connection
};

/**
 * Sets mongoose options
 *
 * ####Example:
 *
 *     mongoose.set('test', value) // sets the 'test' option to `value`
 *
 * @param {String} key
 * @param {String} value
 * @api public
 */

Mongoose.prototype.set = function (key, value) {
  if (arguments.length == 1)
    return this.options[key];
  this.options[key] = value;
  return this;
};

/**
 * Gets mongoose options
 *
 * ####Example:
 *
 *     mongoose.get('test') // returns the 'test' value
 *
 * @param {String} key
 * @method get
 * @api public
 */

Mongoose.prototype.get = Mongoose.prototype.set;

/**
 * Creates a Connection instance.
 *
 * Each `connection` instance maps to a single database. This method is helpful when mangaging multiple db connections.
 *
 * If arguments are passed, they are proxied to either [Connection#open](#connection_Connection-open) or [Connection#openSet](#connection_Connection-openSet) appropriately. This means we can pass `db`, `server`, and `replset` options to the driver.
 *
 * _Options passed take precedence over options included in connection strings._
 *
 * ####Example:
 *
 *     // with mongodb:// URI
 *     db = mongoose.createConnection('mongodb://user:pass@localhost:port/database');
 *
 *     // and options
 *     var opts = { db: { native_parser: true }}
 *     db = mongoose.createConnection('mongodb://user:pass@localhost:port/database', opts);
 *
 *     // replica sets
 *     db = mongoose.createConnection('mongodb://user:pass@localhost:port/database,mongodb://anotherhost:port,mongodb://yetanother:port');
 *
 *     // and options
 *     var opts = { replset: { strategy: 'ping', rs_name: 'testSet' }}
 *     db = mongoose.createConnection('mongodb://user:pass@localhost:port/database,mongodb://anotherhost:port,mongodb://yetanother:port', opts);
 *
 *     // with [host, database_name[, port] signature
 *     db = mongoose.createConnection('localhost', 'database', port)
 *
 *     // and options
 *     var opts = { server: { auto_reconnect: false }, user: 'username', pass: 'mypassword' }
 *     db = mongoose.createConnection('localhost', 'database', port, opts)
 *
 *     // initialize now, connect later
 *     db = mongoose.createConnection();
 *     db.open('localhost', 'database', port, [opts]);
 *
 * @param {String} [uri] a mongodb:// URI
 * @param {Object} [options] options to pass to the driver
 * @see Connection#open #connection_Connection-open
 * @see Connection#openSet #connection_Connection-openSet
 * @return {Connection} the created Connection object
 * @api public
 */

Mongoose.prototype.createConnection = function (cradleConnection) {
  if (arguments.length) {
    this.connections.push(cradleConnection);
  }

  return cradleConnection;
};

/**
 * Opens the default mongoose connection.
 *
 * If arguments are passed, they are proxied to either [Connection#open](#connection_Connection-open) or [Connection#openSet](#connection_Connection-openSet) appropriately.
 *
 * _Options passed take precedence over options included in connection strings._
 *
 * @see Mongoose#createConnection #index_Mongoose-createConnection
 * @api public
 * @return {Mongoose} this
 */

Mongoose.prototype.connect = function (cradleConnection) {
  this.connection = cradleConnection;

  return this;
};


/**
 * Defines a model or retrieves it.
 *
 * Models defined on the `mongoose` instance are available to all connection created by the same `mongoose` instance.
 *
 * ####Example:
 *
 *     var mongoose = require('mongoose');
 *
 *     // define an Actor model with this mongoose instance
 *     mongoose.model('Actor', new Schema({ name: String }));
 *
 *     // create a new connection
 *     var conn = mongoose.createConnection(..);
 *
 *     // retrieve the Actor model
 *     var Actor = conn.model('Actor');
 *
 * _When no `collection` argument is passed, Mongoose produces a collection name by passing the model `name` to the [utils.toCollectionName](#utils_exports.toCollectionName) method. This method pluralizes the name. If you don't like this behavior, either pass a collection name or set your schemas collection name option._
 *
 * ####Example:
 *
 *     var schema = new Schema({ name: String }, { collection: 'actor' });
 *
 *     // or
 *
 *     schema.set('collection', 'actor');
 *
 *     // or
 *
 *     var collectionName = 'actor'
 *     var M = mongoose.model('Actor', schema, collectionName)
 *
 * @param {String} name model name
 * @param {Schema} [schema]
 * @param {String} [collection] name (optional, induced from model name)
 * @param {Boolean} [skipInit] whether to skip initialization (defaults to false)
 * @api public
 */

Mongoose.prototype.model = function (name, schema, database, skipInit) {
  if ('string' == typeof schema) {
    database = schema;
    schema = false;
  }

  if (utils.isObject(schema) && !(schema instanceof Schema)) {
    schema = new Schema(schema);
  }

  if ('boolean' === typeof database) {
    skipInit = database;
    database = null;
  }

  // handle internal options from connection.model()
  var options;
  if (skipInit && utils.isObject(skipInit)) {
    options = skipInit;
    skipInit = true;
  } else {
    options = {};
  }

  var model;
  var sub;

  // connection.model() may be passing a different schema for
  // an existing model name. in this case don't read from cache.
  if (this.models[name] && false !== options.cache) {
    if (schema instanceof Schema && schema != this.models[name].schema) {
      throw new mongoose.Error.OverwriteModelError(name);
    }

    if (database) {
      // subclass current model with alternate collection
      model = this.models[name];
      schema = model.prototype.schema;
      sub = model.__subclass(this.connection, schema, collection);
      // do not cache the sub model
      return sub;
    }

    return this.models[name];
  }

  // ensure a schema exists
  if (!schema) {
    schema = this.modelSchemas[name];
    if (!schema) {
      throw new mongoose.Error.MissingSchemaError(name);
    }
  }

  if (!database) {
    database = schema.get('database');
  }

  var connection = options.connection || this.connection;
  model = Model.compile(name, schema, database, connection, this);

  if (!skipInit) {
    model.init();
  }

  if (false === options.cache) {
    return model;
  }

  return this.models[name] = model;
}

/**
 * Returns an array of model names created on this instance of Mongoose.
 *
 * ####Note:
 *
 * _Does not include names of models created using `connection.model()`._
 *
 * @api public
 * @return {Array}
 */

Mongoose.prototype.modelNames = function () {
  var names = Object.keys(this.models);
  return names;
}

/**
 * Applies global plugins to `schema`.
 *
 * @param {Schema} schema
 * @api private
 */

Mongoose.prototype._applyPlugins = function (schema) {
  for (var i = 0, l = this.plugins.length; i < l; i++) {
    schema.plugin(this.plugins[i][0], this.plugins[i][1]);
  }
}

/**
 * Declares a global plugin executed on all Schemas.
 *
 * Equivalent to calling `.plugin(fn)` on each Schema you create.
 *
 * @param {Function} fn plugin callback
 * @param {Object} [opts] optional options
 * @return {Mongoose} this
 * @see plugins ./plugins.html
 * @api public
 */

Mongoose.prototype.plugin = function (fn, opts) {
  this.plugins.push([fn, opts]);
  return this;
};

/**
 * The default connection of the mongoose module.
 *
 * ####Example:
 *
 *     var mongoose = require('mongoose');
 *     mongoose.connect(...);
 *     mongoose.connection.on('error', cb);
 *
 * This is the connection used by default for every model created using [mongoose.model](#index_Mongoose-model).
 *
 * @property connection
 * @return {Connection}
 * @api public
 */

Mongoose.prototype.__defineGetter__('connection', function () {
  return this.connections[0];
});

/*!
 * Driver depentend APIs
 */

var driver = global.MONGOOSE_DRIVER_PATH || './drivers/cradle';

/**
 * The Mongoose version
 *
 * @property version
 * @api public
 */

Mongoose.prototype.version = require(__dirname + '/../package.json').version;

/**
 * The Mongoose constructor
 *
 * The exports of the mongoose module is an instance of this class.
 *
 * ####Example:
 *
 *     var mongoose = require('mongoose');
 *     var mongoose2 = new mongoose.Mongoose();
 *
 * @method Mongoose
 * @api public
 */

Mongoose.prototype.Mongoose = Mongoose;

/**
 * The Mongoose Schema constructor
 *
 * ####Example:
 *
 *     var mongoose = require('mongoose');
 *     var Schema = mongoose.Schema;
 *     var CatSchema = new Schema(..);
 *
 * @method Schema
 * @api public
 */

Mongoose.prototype.Schema = Schema;

/**
 * The Mongoose SchemaType constructor.
 *
 * @method SchemaType
 * @api public
 */

Mongoose.prototype.SchemaType = SchemaType;

/**
 * The various Mongoose SchemaTypes.
 *
 * ####Note:
 *
 * _Alias of mongoose.Schema.Types for backwards compatibility._
 *
 * @property SchemaTypes
 * @see Schema.SchemaTypes #schema_Schema.Types
 * @api public
 */

Mongoose.prototype.SchemaTypes = Schema.Types;

/**
 * The Mongoose VirtualType constructor.
 *
 * @method VirtualType
 * @api public
 */

Mongoose.prototype.VirtualType = VirtualType;

/**
 * The various Mongoose Types.
 *
 * ####Example:
 *
 *     var mongoose = require('mongoose');
 *     var array = mongoose.Types.Array;
 *
 * ####Types:
 *
 * - Array
 * - Buffer
 * - Document
 * - Embedded
 * - DocumentArray
 * - ObjectId
 *
 * Using this exposed access to the `ObjectId` type, we can construct ids on demand.
 *
 *     var ObjectId = mongoose.Types.ObjectId;
 *     var id1 = new ObjectId;
 *
 * @property Types
 * @api public
 */

Mongoose.prototype.Types = Types;

/**
 * The Mongoose Promise constructor.
 *
 * @method Promise
 * @api public
 */

Mongoose.prototype.Promise = Promise;

/**
 * The Mongoose Model constructor.
 *
 * @method Model
 * @api public
 */

Mongoose.prototype.Model = Model;

/**
 * The Mongoose Document constructor.
 *
 * @method Document
 * @api public
 */

Mongoose.prototype.Document = Document;

/**
 * The MongooseError constructor.
 *
 * @method Error
 * @api public
 */

Mongoose.prototype.Error = require('./error');


/*!
 * The exports object is an instance of Mongoose.
 *
 * @api public
 */

var mongoose = module.exports = exports = new Mongoose;

/*!
 * Module dependencies.
 */

var url = require('url')
    , utils = require('./utils')
    , EventEmitter = require('events').EventEmitter
    , driver = global.MONGOOSE_DRIVER_PATH || './drivers/couchdb-cradle'
    , Model = require('./model')
    , Schema = require('./schema')
    , Collection = require(driver + '/collection')
    , MongooseError = require('./error');

/**
 * Connection constructor
 *
 * For practical reasons, a Connection equals a Db.
 *
 * @param {Mongoose} base a mongoose instance
 * @inherits NodeJS EventEmitter http://nodejs.org/api/events.html#events_class_events_eventemitter
 * @event `connecting`: Emitted when `connection.{open,openSet}()` is executed on this connection.
 * @event `connected`: Emitted when this connection successfully connects to the db. May be emitted _multiple_ times in `reconnected` scenarios.
 * @event `open`: Emitted after we `connected` and `onOpen` is executed on all of this connections models.
 * @event `disconnecting`: Emitted when `connection.close()` was executed.
 * @event `disconnected`: Emitted after getting disconnected from the db.
 * @event `close`: Emitted after we `disconnected` and `onClose` executed on all of this connections models.
 * @event `reconnected`: Emitted after we `connected` and subsequently `disconnected`, followed by successfully another successfull connection.
 * @event `error`: Emitted when an error occurs on this connection.
 * @event `fullsetup`: Emitted in a replica-set scenario, when all nodes specified in the connection string are connected.
 * @api public
 */

function Connection(base) {
  this.base = base;
  this.collections = {};
  this.models = {};
  this.connectionOpts = null;
  this.name = null;
};

/*!
 * Inherit from EventEmitter
 */

Connection.prototype.__proto__ = EventEmitter.prototype;

/**
 * A hash of the collections associated with this connection
 *
 * @property collections
 */

Connection.prototype.collections;

/**
 * The CouchDB instance, set when the connection is opened
 *
 * @property db
 */

Connection.prototype.db;

/**
 * Opens the connection to CouchDB.
 *
 * @param {Mixed} nano connection object/string
 * @param {Function} [callback]
 * @see nano https://github.com/dscape/nano
 * @api public
 */

Connection.prototype.open = function () {
  var callback = null;
  if (typeof arguments[arguments.length - 1] == 'function') {
    callback = arguments.pop();
  }

  this.connectionOpts = arguments;
  this._open(callback);
  return this;
};

/**
 * error
 *
 * Graceful error handling, passes error to callback
 * if available, else emits error on the connection.
 *
 * @param {Error} err
 * @param {Function} callback optional
 * @api private
 */

Connection.prototype.error = function (err, callback) {
  if (callback) return callback(err);
  this.emit('error', err);
}

/**
 * Handles opening the connection with the appropriate method based on connection type.
 *
 * @param {Function} callback
 * @api private
 */

Connection.prototype._open = function (callback) {
  var self = this;

  // open connection
  this.doOpen(function (err) {
    if (err) {
      return self.error(err, callback);
    }
    self.onOpen(callback);
  });
}

/**
 * Called when the connection is opened
 *
 * @api private
 */

Connection.prototype.onOpen = function (callback) {
  callback && callback();
  this.emit('open');
};

/**
 * Closes the connection
 *
 * @param {Function} [callback] optional
 * @return {Connection} self
 * @api public
 */

Connection.prototype.close = function (callback) {
  var self = this;
  this.doClose(function (err) {
    if (err) {
      return self.error(err, callback);
    }
    self.onClose();
    callback && callback();
  });

  return this;
};

/**
 * Called when the connection closes
 *
 * @api private
 */

Connection.prototype.onClose = function () {
  this.emit('close');
};

/**
 * Retrieves a collection, creating it if not cached.
 *
 * @param {String} name of the collection
 * @param {Object} [options] optional collection options
 * @return {Collection} collection instance
 * @api public
 */

Connection.prototype.collection = function (name, options) {
  if (!(name in this.collections))
    this.collections[name] = new Collection(name, this, options);
  return this.collections[name];
};

/**
 * Defines or retrieves a model.
 *
 *     var mongoose = require('mongoose');
 *     var db = mongoose.createConnection(..);
 *     db.model('Venue', new Schema(..));
 *     var Ticket = db.model('Ticket', new Schema(..));
 *     var Venue = db.model('Venue');
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
 *     var M = conn.model('Actor', schema, collectionName)
 *
 * @param {String} name the model name
 * @param {Schema} [schema] a schema. necessary when defining a model
 * @param {String} [collection] name of mongodb collection (optional) if not given it will be induced from model name
 * @see Mongoose#model #index_Mongoose-model
 * @return {Model} The compiled model
 * @api public
 */

Connection.prototype.model = function (name, schema, collection) {
  // collection name discovery
  if ('string' == typeof schema) {
    collection = schema;
    schema = false;
  }

  if (utils.isObject(schema) && !(schema instanceof Schema)) {
    schema = new Schema(schema);
  }

  if (this.models[name] && !collection) {
    // model exists but we are not subclassing with custom collection
    if (schema instanceof Schema && schema != this.models[name].schema) {
      throw new MongooseError.OverwriteModelError(name);
    }
    return this.models[name];
  }

  var opts = { cache: false, connection: this }
  var model;

  if (schema instanceof Schema) {
    // compile a model
    model = this.base.model(name, schema, collection, opts)

    // only the first model with this name is cached to allow
    // for one-offs with custom collection names etc.
    if (!this.models[name]) {
      this.models[name] = model;
    }

    model.init();
    return model;
  }

  if (this.models[name] && collection) {
    // subclassing current model with alternate collection
    model = this.models[name];
    schema = model.prototype.schema;
    var sub = model.__subclass(this, schema, collection);
    // do not cache the sub model
    return sub;
  }

  // lookup model in mongoose module
  model = this.base.models[name];

  if (!model) {
    throw new MongooseError.MissingSchemaError(name);
  }

  if (this == model.prototype.db
      && (!collection || collection == model.collection.name)) {
    // model already uses this connection.

    // only the first model with this name is cached to allow
    // for one-offs with custom collection names etc.
    if (!this.models[name]) {
      this.models[name] = model;
    }

    return model;
  }

  return this.models[name] = model.__subclass(this, schema, collection);
}

/**
 * Returns an array of model names created on this connection.
 * @api public
 * @return {Array}
 */

Connection.prototype.modelNames = function () {
  return Object.keys(this.models);
}

/*!
 * Module exports.
 */
module.exports = Connection;

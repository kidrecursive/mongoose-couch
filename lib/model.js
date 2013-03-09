/*!
 * Module dependencies.
 */

var Document = require('./document')
    , Schema = require('./schema')
    , Types = require('./schema/index')
    , utils = require('./utils')
    , EventEmitter = require('events').EventEmitter
    , Promise = require('./promise')
    , tick = utils.tick

/**
 * Model constructor
 *
 * @param {Object} doc values to with which to create the document
 * @inherits Document
 * @event `error`: If listening to this Model event, it is emitted when a document was saved without passing a callback and an `error` occurred. If not listening, the event bubbles to the connection used to create this Model.
 * @event `index`: Emitted after `Model#ensureIndexes` completes. If an error occurred it is passed with the event.
 * @api public
 */

function Model(doc, fields, skipId) {
  Document.call(this, doc, fields, skipId);
};

/*!
 * Inherits from Document.
 *
 * All Model.prototype features are available on
 * top level (non-sub) documents.
 */

Model.prototype.__proto__ = Document.prototype;

/**
 * Connection the model uses.
 *
 * @api public
 * @property db
 */

Model.prototype.db;
Model.prototype.couch = Model.prototype.db;

/**
 * Collection the model uses.
 *
 * @api public
 * @property collection
 */

Model.prototype.collection;
Model.prototype.database = Model.prototype.collection;

/**
 * The name of the model
 *
 * @api public
 * @property modelName
 */

Model.prototype.modelName;

/*!
 * Handles doc.save() callbacks
 */

function handleSave(promise, self) {
  return tick(function handleSave(err, result) {
    if (err) {
      // If the initial insert fails provide a second chance.
      // (If we did this all the time we would break updates)
      if (self.$__.inserting) {
        self.isNew = true;
        self.emit('isNew', true);
      }
      promise.error(err);
      promise = self = null;
      return;
    }

    var numAffected = 1;

    self._id = result.id;
    self._rev = result.rev;

    self.emit('save', self, numAffected);
    promise.complete(self, numAffected);
    promise = self = null;
  });
}

/**
 * Saves this document.
 *
 * ####Example:
 *
 *     product.sold = Date.now();
 *     product.save(function (err, product) {
 *       if (err) ..
 *     })
 *
 * The `fn` callback is optional. If no `fn` is passed and validation fails, the validation error will be emitted on the connection used to create this model.
 *
 *     var db = mongoose.createConnection(..);
 *     var schema = new Schema(..);
 *     var Product = db.model('Product', schema);
 *
 *     db.on('error', handleError);
 *
 * However, if you desire more local error handling you can add an `error` listener to the model and handle errors there instead.
 *
 *     Product.on('error', handleError);
 *
 * @param {Function} [fn] optional callback
 * @api public
 * @see middleware http://mongoosejs.com/docs/middleware.html
 */

Model.prototype.save = function save(fn) {
  var promise = new Promise(fn)
      , complete = handleSave(promise, this)
      , options = {}

  if (this.schema.options.safe) {
    options.safe = this.schema.options.safe;
  }

  if (this.isNew) {
    // send entire doc
    var obj = this.toObject({ depopulate: 1 });
    this.collection.insert(obj, options, complete);
    this._reset();
    this.isNew = false;
    this.emit('isNew', false);
    // Make it possible to retry the insert
    this.$__.inserting = true;

  } else {
    // Make sure we don't treat it as a new object on error,
    // since it already exists
    this.$__.inserting = false;

    var obj = this.toObject({ depopulate: 1 });
    this.collection.insert(obj, options, complete);
    this._reset();

    this.emit('isNew', false);
  }
};


/**
 * Removes this document from the db.
 *
 * ####Example:
 *
 *     product.remove(function (err, product) {
 *       if (err) return handleError(err);
 *       Product.findById(product._id, function (err, product) {
 *         console.log(product) // null
 *       })
 *     })
 *
 * @param {Function} [fn] optional callback
 * @api public
 */

Model.prototype.remove = function remove(fn) {
  if (this.$__.removing) {
    this.$__.removing.addBack(fn);
    return this;
  }

  var promise = this.$__.removing = new Promise(fn)
      , self = this;

  this.collection.remove(this._id, this._rev, tick(function (err) {
    if (err) {
      promise.error(err);
      promise = self = self.$__.removing = where = options = null;
      return;
    }
    self.emit('remove', self);
    promise.complete();
    promise = self = where = options = null;
  }));

  return this;
};

/**
 * Register hooks override
 *
 * @api private
 */

Model.prototype._registerHooks = function registerHooks() {
  Document.prototype._registerHooks.call(this);
};

/**
 * Returns another Model instance.
 *
 * ####Example:
 *
 *     var doc = new Tank;
 *     doc.model('User').findById(id, callback);
 *
 * @param {String} name model name
 * @api public
 */

Model.prototype.model = function model(name) {
  return this.db.model(name);
};

// Model (class) features

/*!
 * Give the constructor the ability to emit events.
 */

for (var i in EventEmitter.prototype)
  Model[i] = EventEmitter.prototype[i];

/**
 * Called when the model compiles.
 *
 * @api private
 */

Model.init = function init() {
  if (this.schema.options.autoIndex) {
    this.ensureIndexes();
  }

  this.schema.emit('init', this);
};

/**
 * Sends `ensureIndex` commands to mongo for each index declared in the schema.
 *
 * ####Example:
 *
 *     Event.ensureViews(function (err) {
 *       if (err) return handleError(err);
 *     });
 *
 * After completion, an `index` event is emitted on this `Model` passing an error if one occurred.
 *
 * ####Example:
 *
 *     var eventSchema = new Schema({
 *         thing: { type: 'string' }
 *       },
 *       {
 *         database: 'example',
 *         views: { 'dang': { map : function..., reduce: function... } }
 *     })
 *     var Event = mongoose.model('Event', eventSchema);
 *
 *     Event.on('index', function (err) {
 *       if (err) console.error(err); // error occurred during index creation
 *     })
 *
 * _NOTE: It is not recommended that you run this in production. View creation may impact database performance depending on your load. Use with caution._
 *
 * @param {Function} [cb] optional callback
 * @api public
 */

Model.ensureIndexes = function ensureIndexes(cb) {
  var indexes = this.schema.indexes();
  if (!indexes.length) {
    return cb && process.nextTick(cb);
  }

  // Indexes are created one-by-one to support how MongoDB < 2.4 deals
  // with background indexes.

  var self = this
      , safe = self.schema.options.safe

  function done(err) {
    self.emit('index', err);
    cb && cb(err);
  }

  function create() {
    var index = indexes.shift();
    if (!index) return done();

    var options = index[1];
    options.safe = safe;
    self.collection.ensureIndex(index[0], options, tick(function (err) {
      if (err) return done(err);
      create();
    }));
  }

  create();
}

/**
 * Schema the model uses.
 *
 * @property schema
 * @receiver Model
 * @api public
 */

Model.schema;

/*!
 * Connection instance the model uses.
 *
 * @property db
 * @receiver Model
 * @api public
 */

Model.db;

/*!
 * Collection the model uses.
 *
 * @property collection
 * @receiver Model
 * @api public
 */

Model.collection;

/**
 * Base Mongoose instance the model uses.
 *
 * @property base
 * @receiver Model
 * @api public
 */

Model.base;

/**
 * Removes documents from the collection.
 *
 * ####Example:
 *
 *     Comment.remove({ title: 'baby born from alien father' }, function (err) {
 *
 *     });
 *
 * ####Note:
 *
 * To remove documents without waiting for a response from MongoDB, do not pass a `callback`, then call `exec` on the returned [Query](#query-js):
 *
 *     var query = Comment.remove({ _id: id });
 *     query.exec();
 *
 * ####Note:
 *
 * This method sends a remove command directly to MongoDB, no Mongoose documents are involved. Because no Mongoose documents are involved, _no middleware (hooks) are executed_.
 *
 * @param {Object} conditions
 * @param {Function} [callback]
 * @return {Query}
 * @api public
 */

Model.remove = function remove(docs, callback) {
  this.collection.bulkRemove(docs, callback);
};

/**
 * Finds documents using a view
 *
 * ####Examples:
 *
 *     MyModel.findWithView();
 *
 *
 * @param {Object} conditions
 * @param {Object} [fields] optional fields to select
 * @param {Object} [options] optional
 * @param {Function} [callback]
 * @return {Query}
 * @see field selection #query_Query-select
 * @see promise #promise-js
 * @api public
 */

Model.findWithView = function findWithView(view, options, callback) {
  var self = this;
  if ('function' != typeof callback) {
    callback = options;
    options = {};
  }

  this.collection.findWithView(view, options, function (err, docs) {
    if (err) {
      return callback(err);
    }
    self.hydrate(docs, callback);
  });
};

/**
 * Finds documents using a view
 *
 * ####Examples:
 *
 *     MyModel.findOneWithView();
 *
 *
 * @param {Object} conditions
 * @param {Object} [fields] optional fields to select
 * @param {Object} [options] optional
 * @param {Function} [callback]
 * @return {Query}
 * @see field selection #query_Query-select
 * @see promise #promise-js
 * @api public
 */

Model.findOneWithView = function findOneWithView(view, options, callback) {
  var self = this;
  if ('function' != typeof callback) {
    callback = options;
    options = {};
  }

  this.collection.findOneWithView(view, options, function (err, doc) {
    if (err) {
      return callback(err);
    }
    self.hydrate(doc, callback);
  });
};

/**
 * Finds a single document by id.
 *
 * The `id` is cast based on the Schema before sending the command.
 *
 * ####Example:
 *
 *     // find adventure by id and execute immediately
 *     Adventure.findById(id, function (err, adventure) {});
 *
 *     // same as above
 *     Adventure.findById(id).exec(callback);
 *
 *     // select only the adventures name and length
 *     Adventure.findById(id, 'name length', function (err, adventure) {});
 *
 *     // same as above
 *     Adventure.findById(id, 'name length').exec(callback);
 *
 *     // include all properties except for `length`
 *     Adventure.findById(id, '-length').exec(function (err, adventure) {});
 *
 *     // passing options (in this case return the raw js objects, not mongoose documents by passing `lean`
 *     Adventure.findById(id, 'name', { lean: true }, function (err, doc) {});
 *
 *     // same as above
 *     Adventure.findById(id, 'name').lean().exec(function (err, doc) {});
 *
 * @param {ObjectId|HexId} id objectid, or a value that can be casted to one
 * @param {Object} [fields] optional fields to select
 * @param {Object} [options] optional
 * @param {Function} [callback]
 * @return {Query}
 * @see field selection #query_Query-select
 * @see lean queries #query_Query-lean
 * @api public
 */

Model.findById = function findById(ids, callback) {
  var self = this;
  this.collection.findById(ids, function (err, docs) {
    if (err) {
      return callback(err);
    }
    self.hydrate(docs, callback);
  });
};

/*!
 * hydrates documents
 *
 * @param {Document} documents
 */

Model.hydrate = function (docs, callback) {
  var self = this;
  var docArray = Array.isArray(docs);
  docs = (docArray) ? docs : [docs];

  var arr = [];
  var count = docs.length;
  var len = count;
  var i = 0;
  for (; i < len; ++i) {
    arr[i] = new self(docs[i], true);
    arr[i].init(docs[i], function (err) {
      if (err) return callback(err, null);
      --count || arr;
    });
  }

  callback(null, (docArray) ? arr : arr[0]);
};

/**
 * Executes a mapReduce command.
 *
 * ####options:
 *
 *     http://wiki.apache.org/couchdb/HTTP_view_API#Querying_Options
 *
 * ####Example:
 *
 *     var o = {};
 *     o.map = function () { emit(this.name, 1) }
 *     o.reduce = function (k, vals) { return vals.length }
 *     User.mapReduce(o, {}, function (err, res) {
 *        console.log(res);
 *     })
 *
 * @param {Object} o an object specifying map-reduce options
 * @param {Object} o an object specifying view options
 * @param {Function} callback
 * @see http://wiki.apache.org/couchdb/HTTP_view_API
 * @api public
 */

Model.mapReduce = function mapReduce(doc, opts, callback) {
  if ('function' != typeof callback) throw new Error('missing callback');

  this.collection.mapReduce(doc, opts, function (err, res) {
    callback(err, res);
  });
}

/**
 * Finds the schema for `path`. This is different than
 * calling `schema.path` as it also resolves paths with
 * positional selectors (something.$.another.$.path).
 *
 * @param {String} path
 * @return {Schema}
 * @api private
 */

Model._getSchema = function _getSchema(path) {
  var schema = this.schema
      , pathschema = schema.path(path);

  if (pathschema)
    return pathschema;

  // look for arrays
  return (function search(parts, schema) {
    var p = parts.length + 1
        , foundschema
        , trypath

    while (p--) {
      trypath = parts.slice(0, p).join('.');
      foundschema = schema.path(trypath);
      if (foundschema) {
        if (foundschema.caster) {

          // array of Mixed?
          if (foundschema.caster instanceof Types.Mixed) {
            return foundschema.caster;
          }

          // Now that we found the array, we need to check if there
          // are remaining document paths to look up for casting.
          // Also we need to handle array.$.path since schema.path
          // doesn't work for that.
          if (p !== parts.length) {
            if ('$' === parts[p]) {
              // comments.$.comments.$.title
              return search(parts.slice(p + 1), foundschema.schema);
            } else {
              // this is the last path of the selector
              return search(parts.slice(p), foundschema.schema);
            }
          }
        }
        return foundschema;
      }
    }
  })(path.split('.'), schema)
}

/*!
 * Compiler utility.
 *
 * @param {String} name model name
 * @param {Schema} schema
 * @param {String} collectionName
 * @param {Connection} connection
 * @param {Mongoose} base mongoose instance
 */

Model.compile = function compile(name, schema, collectionName, connection, base) {
  // generate new class
  function model(doc, fields, skipId) {
    if (!(this instanceof model))
      return new model(doc, fields, skipId);
    Model.call(this, doc, fields, skipId);
  };

  model.modelName = name;
  model.__proto__ = Model;
  model.prototype.__proto__ = Model.prototype;
  model.prototype.db = connection;
  model.prototype._setSchema(schema);

  var collectionOptions = { };

  model.prototype.collection = connection.collection(collectionName, collectionOptions);

  // apply methods
  for (var i in schema.methods)
    model.prototype[i] = schema.methods[i];

  // apply statics
  for (var i in schema.statics)
    model[i] = schema.statics[i];

  // apply named scopes
  if (schema.namedScopes) schema.namedScopes.compile(model);

  model.model = model.prototype.model;
  model.options = model.prototype.options;
  model.db = model.prototype.db;
  model.schema = model.prototype.schema;
  model.collection = model.prototype.collection;
  model.base = base;

  return model;
};

/*!
 * Subclass this model with `conn`, `schema`, and `collection` settings.
 *
 * @param {Connection} conn
 * @param {Schema} [schema]
 * @param {String} [collection]
 * @return {Model}
 */

Model.__subclass = function subclass(conn, schema, collection) {
  // subclass model using this connection and collection name
  var model = this;

  var Model = function Model(doc, fields, skipId) {
    if (!(this instanceof Model)) {
      return new Model(doc, fields, skipId);
    }
    model.call(this, doc, fields, skipId);
  }

  Model.__proto__ = model;
  Model.prototype.__proto__ = model.prototype;
  Model.db = Model.prototype.db = conn;

  var s = 'string' != typeof schema
      ? schema
      : model.prototype.schema;

  if (!collection) {
    collection = model.prototype.schema.get('collection')
        || utils.toCollectionName(model.modelName);
  }

  var collectionOptions = {};

  Model.prototype.collection = conn.collection(collection, collectionOptions);
  Model.collection = Model.prototype.collection;
  Model.init();
  return Model;
}

/*!
 * Module exports.
 */

module.exports = exports = Model;

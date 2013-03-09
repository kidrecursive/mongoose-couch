/*!
 * Module dependencies.
 */

var Document = require('./document')
  , MongooseArray = require('./types/array')
  , MongooseError = require('./error')
  , Schema = require('./schema')
  , Types = require('./schema/index')
  , utils = require('./utils')
  , EventEmitter = require('events').EventEmitter
  , merge = utils.merge
  , Promise = require('./promise')
  , assert = require('assert')
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

function Model (doc, fields, skipId) {
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
 * @property connection
 */

Model.prototype.connection;

/**
 * database of the model.
 *
 * @api public
 * @property collection
 */

Model.prototype.database;

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

function handleSave (promise, self) {
  return tick(function handleSave (err, result) {
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

    self._id = result.id;
    self._rev = result.rev;
    var numAffected;
    if (result) {
      // when inserting, the array of created docs is returned
      numAffected = result.length
        ? result.length
        : result;
    } else {
      numAffected = 0;
    }

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

Model.prototype.save = function save (fn) {
  var promise = new Promise(fn)
    , complete = handleSave(promise, this)
    , options = {}
    , db = this.connection.database(this.database);

  if (this.isNew) {
    // send entire doc
    var obj = this.toObject();

    //TODO: cradle create
    db.save(obj, complete);

    this._reset();
    this.isNew = false;
    this.emit('isNew', false);
    // Make it possible to retry the insert
    this.$__.inserting = true;

  } else {
    // Make sure we don't treat it as a new object on error,
    // since it already exists
    this.$__.inserting = false;
    var obj = this.toObject({virtuals:true});

    //TODO: cradle save
    db.save(obj, complete);

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

Model.prototype.remove = function remove (fn) {
  if (this.$__.removing) {
    this.$__.removing.addBack(fn);
    return this;
  }

  var promise = this.$__.removing = new Promise(fn)
    , self = this
    , db = this.connection.database(this.database);

  if (this.schema.options.safe) {
    options.safe = this.schema.options.safe;
  }

  //TODO:remove doc
  db.remove(this._id, this._rev, tick(function (err) {
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

Model.prototype._registerHooks = function registerHooks () {
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

Model.prototype.model = function model (name) {
  return this.connection.model(name);
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

Model.init = function init () {
  if (this.schema.options.autoIndex) {
    //this.ensureIndexes();
  }

  this.schema.emit('init', this);
};

/**
 * Sends `ensureIndex` commands to mongo for each index declared in the schema.
 *
 * ####Example:
 *
 *     Event.ensureIndexes(function (err) {
 *       if (err) return handleError(err);
 *     });
 *
 * After completion, an `index` event is emitted on this `Model` passing an error if one occurred.
 *
 * ####Example:
 *
 *     var eventSchema = new Schema({ thing: { type: 'string', unique: true }})
 *     var Event = mongoose.model('Event', eventSchema);
 *
 *     Event.on('index', function (err) {
 *       if (err) console.error(err); // error occurred during index creation
 *     })
 *
 * _NOTE: It is not recommended that you run this in production. Index creation may impact database performance depending on your load. Use with caution._
 *
 * The `ensureIndex` commands are not sent in parallel. This is to avoid the `MongoError: cannot add index with a background operation in progress` error. See [this ticket](https://github.com/LearnBoost/mongoose/issues/1365) for more information.
 *
 * @param {Function} [cb] optional callback
 * @api public
 */

Model.ensureIndexes = function ensureIndexes (cb) {
  var indexes = this.schema.indexes();
  if (!indexes.length) {
    return cb && process.nextTick(cb);
  }

  // Indexes are created one-by-one to support how MongoDB < 2.4 deals
  // with background indexes.

  var self = this
    , safe = self.schema.options.safe

  function done (err) {
    self.emit('index', err);
    cb && cb(err);
  }

  function create () {
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

Model.connection;

/*!
 * Collection the model uses.
 *
 * @property collection
 * @receiver Model
 * @api public
 */

Model.database;

/**
 * Base Mongoose instance the model uses.
 *
 * @property base
 * @receiver Model
 * @api public
 */

Model.base;


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

Model.findById = function (ids, callback) {
  var db = this.connection.database(this.database);
  var model = this.model;
  db.get(ids, function(err, res){
    err && callback(err);
    hydrate(model, res, callback);
  });
};


Model.findWithView = function (view, opts, callback) {
  var db = this.connection.database(this.database);
  var model = this.model;
  db.view(view, opts, function (err, res) {
    err && callback(err);
    hydrate(model, res, callback);
  });
};


/*!
 * hydrates a document
 *
 * @param {Document} documents
 */

var hydrate = function(model, docs, callback) {
  if(!Array.isArray(docs)) {
    docs = [docs];
  }

  var arr = [];
  var count = docs.length;
  var len = count;
  var i = 0;
  for (; i < len; ++i) {
    arr[i] = new model(docs[i], true);
    arr[i].init(docs[i], function (err) {
      if (err) return callback(err, null);
      --count || arr;
    });
  }

  callback(null, (Array.isArray(docs)) ? arr : arr[0]);
};


/**
 * Shortcut for creating a new Document that is automatically saved to the db if valid.
 *
 * ####Example:
 *
 *     Candy.create({ type: 'jelly bean' }, { type: 'snickers' }, function (err, jellybean, snickers) {
 *       if (err) // ...
 *     });
 *
 *     var array = [{ type: 'jelly bean' }, { type: 'snickers' }];
 *     Candy.create(array, function (err, jellybean, snickers) {
 *       if (err) // ...
 *     });
 *
 * @param {Array|Object...} doc
 * @param {Function} fn callback
 * @api public
 */

Model.create = function create (doc, fn) {
  if (1 === arguments.length) {
    return 'function' === typeof doc && doc(null);
  }

  var self = this
    , docs = [null]
    , promise
    , count
    , args

  if (Array.isArray(doc)) {
    args = doc;
  } else {
    args = utils.args(arguments, 0, arguments.length - 1);
    fn = arguments[arguments.length - 1];
  }

  if (0 === args.length) return fn(null);

  promise = new Promise(fn);
  count = args.length;

  args.forEach(function (arg, i) {
    var doc = new self(arg);
    docs[i+1] = doc;
    doc.save(function (err) {
      if (err) return promise.error(err);
      --count || fn.apply(null, docs);
    });
  });

  // TODO
  // utilize collection.insertAll for batch processing?
};


/*!
 * Assign `vals` returned by mongo query to the `rawIds`
 * structure returned from utils.getVals() honoring
 * query sort order if specified by user.
 *
 * This can be optimized.
 *
 * Rules:
 *
 *   if the value of the path is not an array, use findOne rules, else find.
 *   for findOne the results are assigned directly to doc path (including null results).
 *   for find, if user specified sort order, results are assigned directly
 *   else documents are put back in original order of array if found in results
 *
 * @param {Array} rawIds
 * @param {Array} vals
 * @param {Boolean} sort
 * @api private
 */

function assignRawDocsToIdStructure (rawIds, vals, options, recursed) {
  // honor user specified sort order
  var newOrder = [];
  var sorting = options.sort && rawIds.length > 1;
  var found;
  var doc;
  var sid;
  var id;

  for (var i = 0; i < rawIds.length; ++i) {
    id = rawIds[i];

    if (Array.isArray(id)) {
      // handle [ [id0, id2], [id3] ]
      assignRawDocsToIdStructure(id, vals, options, true);
      newOrder.push(id);
      continue;
    }

    if (null === id && !sorting) {
      // keep nulls for findOne unless sorting, which always
      // removes them (backward compat)
      newOrder.push(id);
      continue;
    }

    sid = String(id);
    found = false;

    if (recursed) {
      // apply find behavior

      // assign matching documents in original order unless sorting
      for (var f = 0; f < vals.length; ++f) {
        if (sid == String(vals[f]._id)) {
          found = true;
          if (sorting) {
            newOrder[f] = vals[f];
          } else {
            newOrder.push(vals[f]);
          }
          break;
        }
      }

      if (!found) {
        newOrder.push(id);
      }

    } else {
      // apply findOne behavior - if document in results, assign, else assign null

      doc = null;
      for (var f = 0; f < vals.length; ++f) {
        if (sid == String(vals[f]._id)) {
          doc = vals[f];
          break;
        }
      }

      newOrder[i] = doc;
    }
  }

  rawIds.length = 0;
  if (newOrder.length) {
    // reassign the documents based on corrected order

    // forEach skips over sparse entries in arrays so we
    // can safely use this to our advantage dealing with sorted
    // result sets too.
    newOrder.forEach(function (doc, i) {
      rawIds[i] = doc;
    });
  }
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

Model._getSchema = function _getSchema (path) {
  var schema = this.schema
    , pathschema = schema.path(path);

  if (pathschema)
    return pathschema;

  // look for arrays
  return (function search (parts, schema) {
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
              return search(parts.slice(p+1), foundschema.schema);
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

Model.compile = function compile (name, schema, database, base) {
  var versioningEnabled = false !== schema.options.versionKey;

  if (versioningEnabled && !schema.paths[schema.options.versionKey]) {
    // add versioning to top level documents only
    var o = {};
    o[schema.options.versionKey] = Number;
    schema.add(o);
  }

  // generate new class
  function model (doc, fields, skipId) {
    if (!(this instanceof model))
      return new model(doc, fields, skipId);
    Model.call(this, doc, fields, skipId);
  };

  model.modelName = name;
  model.__proto__ = Model;
  model.prototype.__proto__ = Model.prototype;
  model.prototype.database = database;
  model.prototype._setSchema(schema);

  model.prototype.connection = schema.options.connection;

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
  model.connection = model.prototype.connection;
  model.schema = model.prototype.schema;
  model.database = model.prototype.database;
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

Model.__subclass = function subclass (conn, schema, database) {
  // subclass model using this connection and collection name
  var model = this;

  var Model = function Model (doc, fields, skipId) {
    if (!(this instanceof Model)) {
      return new Model(doc, fields, skipId);
    }
    model.call(this, doc, fields, skipId);
  }

  Model.__proto__ = model;
  Model.prototype.__proto__ = model.prototype;
  Model.connection = Model.prototype.connection = conn;

  var s = 'string' != typeof schema
    ? schema
    : model.prototype.schema;

  if (!database) {
    database = model.prototype.schema.get('database');
  }

  Model.prototype.database = database;
  Model.database = Model.prototype.database;
  Model.init();
  return Model;
}

/*!
 * Module exports.
 */

module.exports = exports = Model;

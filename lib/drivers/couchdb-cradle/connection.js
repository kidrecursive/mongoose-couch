/*!
 * Module dependencies.
 */

var MongooseConnection = require('../../connection')
    , cradle = require('cradle');

/**
 * A [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) connection implementation.
 *
 * @inherits Connection
 * @api private
 */

function NativeConnection() {
  MongooseConnection.apply(this, arguments);
};

/*!
 * Inherits from Connection.
 */

NativeConnection.prototype.__proto__ = MongooseConnection.prototype;

/**
 * Opens the connection to MongoDB.
 *
 * @param {Function} fn
 * @return {Connection} this
 * @api private
 */

NativeConnection.prototype.doOpen = function (fn) {
  var server = new (cradle.Connection)(this.connectionOpts);
  this.db = server;
  fn();

  return this;
};

/**
 * Closes the connection
 *
 * @param {Function} fn
 * @return {Connection} this
 * @api private
 */

NativeConnection.prototype.doClose = function (fn) {
  this.collections = {};
  this.models = {};
  this.connectionOpts = null;
  this.name = null;
  delete(this.db);
  delete(this._events)

  fn && fn();
  return this;
}

/*!
 * Module exports.
 */

module.exports = NativeConnection;

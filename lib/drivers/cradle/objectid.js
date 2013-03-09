
/*!
 * [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) ObjectId
 * @constructor NodeMongoDbObjectId
 * @see ObjectId
 */

function ObjectId(id){
  this.id = id;
}

ObjectId.fromString = function(str){
  return str;
};

ObjectId.toString = function(oid){
  return oid;
};

module.exports = exports = ObjectId;
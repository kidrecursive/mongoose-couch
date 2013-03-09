var mongoose = require('./lib/index');
var Schema = mongoose.Schema;
var cradle = require('cradle');

mongoose.connect('http://localhost', 5984, {
  cache: false,
  raw: false
});


var AccountSchema = new Schema({
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    match: /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  },
  hash: {
    type: String
  },
  apiKey: {
    type: String,
    unique: true
  },
  roles: {
    type: [String],
    required: true,
    'default': ['lead']
  }
}, {
  collection: 'testy-mcgee'
});

module.exports = Account = mongoose.model('Account', AccountSchema);


var account = new Account({
  slug: 'hello',
  email: 'wut@wut.com',
  roles: ['lead']
});

account.save(function (err) {
  account.roles.push('admin');
  account.save(function (err) {

    Account.findById(account._id, function (err, res) {
      console.log(err || res);
    });
  });
});
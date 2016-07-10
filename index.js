'use strict';

var express = require('express');
var moment = require('moment');
var compression = require('compression');
var logger = require('morgan');
var path = require('path');
var bodyParser = require('body-parser');
var timeout = require('connect-timeout');
var responseTime = require('response-time');
var serveFavicon = require('serve-favicon');
var app = express();
var MongoClient = require('mongodb').MongoClient;
var url = require('url');
console.log('I am here');
/*var assert = require('assert');*/

function has_props(obj) {
  return (Object.keys(obj).length !== 0);
}

function is_number(str) {
  var num = Number.parseFloat(str);
  return Number.isNaN(num) == false;
}

//listen port expressjs
var port = process.env.PORT;
// Connection URL DB
var url_mongo = process.env.URI_MONGO; //'mongodb://jkfmongo:Belarus123@ds017205.mlab.com:17205/storev2';
var base_uri = process.env.BASE_URI;
var delayed_resource = {};
//Use connect method to connect to the server
MongoClient.connect(url_mongo, function (err, db) {
  if (err) {
    console.log('there was an error connecting to database:' + err);
    process.exit(1);
  }

  db.collection('inserts').insertOne({
    a: 1
  });

  console.log("Connected succesfully to server");
  delayed_resource.db = db;
});

app.use(responseTime({
  digits: 4
})); //make this the first middleware
app.use(compression({
  threshold: 1
}));
app.use(logger(':method :url :status :res[content-length] - :response-time ms'));

app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

var favIconFile = path.join(__dirname, 'public', 'favicon.ico');

app.use(
  serveFavicon(
    path.join(__dirname, 'public', 'favicon.ico'), {
      maxAge: '1m'
    }
  )
);

var router_for_new = express.Router();
var router_for_redirect = express.Router();

function get_next_pk() {
  if (!delayed_resource.db) {
    return Promise.reject("Database connection initializing, moment, try again in a few seconds");
  }
  var db = delayed_resource.db;
  var seq_incr = Math.trunc(1 + Math.random() * 10);
  console.log({
    seq_incr: seq_incr
  });
  var promise = db.collection('counter').findAndModify({
      name: "url_shortner_pk"
    },
    null, {
      $inc: {
        seq: seq_incr
      }
    }, {
      new: true
    }
  );
  console.log('returning promise');
  return promise;
}

app.get('/new/*', function (req, res, next) {
  // runs for all HTTP verbs first
  // think of it as route specific middleware!
  var url_raw = req.path.substr(5);
  var uri_obj = url.parse(url_raw);

  if (uri_obj.protocol == null ||
    uri_obj.hostname == null
  ) {
    return next("This is not a valid URL try in the format [http://hostname/...]");
  };
  if (!delayed_resource.db) {
    return next("Database connection initializing, moment, try again in a few seconds");
  }
  //shorthand
  var db = delayed_resource.db;
  var promise = db.collection('mapping').findOne({
    from: url_raw
  }, {
    from: 1,
    to: 1,
    _id: 0
  });
  var seq;
  console.log("search existing?");
  promise.then(function (doc) {
    if (doc != undefined) {
      return res.json({
        original_url: doc.from,
        short_url: base_uri + "/" + doc.to
      });
    }
    var new_hash_promise = get_next_pk(); //create hash and insert it
    new_hash_promise.then(function (result) {
      console.log('pk got changed:' + JSON.stringify(Object.keys(result)));
      seq = result.value.seq;
      var insert_promise = db.collection("mapping").insertOne({
        from: url_raw,
        to: seq
      });
      insert_promise.then(function (result) {
        console.log('record inserted:' + JSON.stringify(Object.keys(result)));
        res.json({
          orig: req.originalUrl,
          base: base_uri + "/" + seq
        });
      }).catch(function (err) {
        console.log("database insert error:" + err);
        next(err);
      });
    }).catch(function (err) {
      console.log("database update error:" + err);
      next(err);
    });

  }).catch(function (err) {
    console.log("database update error:" + err);
    next(err);
  });
});

app.get(/\/(?!(new\/))[A-Za-z0-9]+$/, function (req, res, next) {
  //strip the leading '/'
  console.log("reroute");
  req.originalUrl = req.originalUrl.trim();
  if (req.originalUrl.length < 2) {
    console.log("forwared to sink");
    return next();
  }
  var hash = req.originalUrl.substr(1);
  if (!delayed_resource.db) {
    return next("Database connection initializing, moment, try again in a few seconds");
  }
  //shorthand
  var db = delayed_resource.db;
  var promise = db.collection('mapping').findOne({
    to: Number.parseInt(hash)
  }, {
    from: 1,
    to: 1,
    _id: 0
  });
  promise.then(function (doc) {
    console.log({
      tag: "doc-lookup",
      doc: doc
    });
    if (!!(!doc)) {
      return res.json({
        error: "This url: [" + base_uri+ "/"+ hash + "] is not in the database."
      });
    }
    res.set({
      'Location': doc.from
    });
    res.status(301); //permanent redirect
    res.send("<html><head><title>Moved</title></head><body><h1>Moved</h1><p>This page has moved to " +
      " <a href=" + doc.from + "</a></p></body></html>");
  }).catch(function (err) {
    console.log({
      err: err
    });
    next(err);
  });

});

app.use('/css', express.static(__dirname + '/css'));

/*redirect 404 to index.html */
app.use(function (req, res, next) {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* final catch all */
/*
app.use(function (err, req, res, next) {
  if (err) {
    console.log(JSON.stringify(err));
    res.set({
      "X-Error": JSON.stringify(err)
    });
    res.status(500).send({
      error: JSON.stringify(err)
    });
  }
});
*/
app.listen(port, function () {
  console.log('The server is running at port:' + port, port);
});

process.on('SIGINT', function () {
  console.log("Caught [SIGINT] interrupt signal");
  if (delayed_resource.db) {
    delayed_resource.db.close();
    console.log("Database connection closed");
  }
  process.exit(0);
});

const p2p = require('bitcore-p2p');//require('@dashevo/dashcore-p2p');
const express = require('express');
const geoip = require('geoip-lite');
const countries = require('i18n-iso-countries');
const level = require('level');
const maxmind = require('maxmind');
const bitcore_lib = require('bitcore-lib');
const networks = require('./networks');
const BitSet = require('bitset');

var network_name = "bch-livenet";
let api_port = 3000;

const asnLookup = maxmind.openSync('GeoLite2-ASN/GeoLite2-ASN.mmdb');

const stay_connected_time = 1000*60*5;//how long to wait for addr messages.
const max_concurrent_connections = 250;
const max_failed_connections_per_minute = 200;//55;
const max_age = 1000*60*60*7;
const addr_db_ttl = -1;//How long to save addr messages for. The saved addr messages are currently not used for anything. 0 = never delete, -1 = never save
const connect_timeout = 1000*30;
const handshake_timeout = 1000*30;

process.argv.forEach(function (val, index, array) {
  let arr = val.split("=");
  if (arr.length === 2 && arr[0] === "-network") {
    network_name = arr[1];
  }
  if (arr.length === 2 && arr[0] === "-port") {
    api_port = arr[1];
  } 
}); 

let protocolVersion;
let seedNodes;
networks.forEach(network => {
  if (network.name===network_name) {
    protocolVersion = network.protocolVersion;
    seedNodes = network.seedNodes;
  }
  bitcore_lib.Networks.add(network);
});

const db = level('./databases/'+network_name, { valueEncoding: 'json', cacheSize: 128*1024*1024, blockSize: 4096, writeBufferSize: 4*1024*1024 });

//Database key prefixes
const connection_prefix = "connection/";
const connection_by_time_prefix = "connection-by-time/";
const addr_prefix = "addr/"
const addr_by_time_prefix = "addr-by-time/"
const host2lastaddr_prefix = 'host2lastaddr/';

let paused = false;

let queue = [];

let status_string = "";

let lastRefreshTime = 0;
let lastConnectTime = 0;

let concurrent_connections = 0;

let failed_connections_queue = [];//queue of timestamps

const messages = new p2p.Messages({network: bitcore_lib.Networks.get(network_name), protocolVersion: protocolVersion});

var app = express();

app.get('/node_count', function (req, res) {
  let hours = req.query.hours;
  if (!isFinite(hours) || hours > 10) hours = 10;
  let host2lastconnection = {};
  recentConnections(1000*60*60*hours)
  .on('data', function(connection) {
    let key = connection.host+":"+connection.port;
    if (host2lastconnection[key] === undefined || connection.connectTime > host2lastconnection[key].connectTime)  {
      host2lastconnection[key] = connection;
    }
  })
  .on('close', function() {
    res.send(
      ""+Object.keys(host2lastconnection).filter(host => host2lastconnection[host].success).length
    );
  });
});

app.get('/connections/:host_ip.csv', function(req, res) {
  let ip = req.params.host_ip;
  let delimiter = ","
  let result = "";
  recentConnections(undefined)
  .on('data', function(connection) {
    if (connection.host !== ip) return;
    let columns = [connection.connectTime, 
      connection.host,
      connection.port];
    if (connection.success !== undefined) {
      columns.push(connection.bestHeight);
      columns.push(connection.version);
      columns.push(connection.subversion);
      columns.push(connection.services);
    }
    if (result.length > 0) result += "\n";
    result += columns.join(delimiter);  
  })
  .on('close', function() {
    res.set('Content-Type', 'text/csv');
    res.send(result);
  });
});


function formatPercentage(val) {
  if (isNaN(val)) val = 0;
  return (val*100).toFixed(2)+"%";
}

let full_nodes_result = {};


/*
TODO:
let active30d = new BitSet;
let host2active = {};
let host2LastSuccesfullConnection = {};

every hour: 
  active30d = active30d.slice(1); active30d.set(30*24, 1)//remove last hour 30 days ago
  for (Object.keys(host2active2).forEach(host => host2active2[host] = host2active2[host].slice(1)));
*/

let data = {
  epoch_hour: 0,
  hour2first_and_last_connection_time: {},
  hostdata: {
    host2active: {},
    host2lastconnection: {},
    host2count2h: {},
    host2count8h: {},
    host2count24h: {},
    host2count7d: {},
    host2count30d: {}
  },
  count2h: 0,
  count8h: 0,
  count24h: 0,
  count7d: 0,
  count30d: 0
};

function update_crawler_data_statistics() {
  let count2h = 0, count8h = 0, count24h = 0, count7d = 0, count30d = 0;
  Object.keys(data.hour2first_and_last_connection_time).forEach(hours_ago => {
    let crawler_active = data.hour2first_and_last_connection_time[hours_ago].max-data.hour2first_and_last_connection_time[hours_ago].min > 1000*60*45;
    if (!crawler_active) {//ignore the hour if less than 45 min running time.
      //delete data.hour2first_and_last_connection_time[hours_ago];
      return;
    }
    if (hours_ago <= 2) {
      count2h++;
    }
    if (hours_ago <= 8) {
      count8h++;
    }
    if (hours_ago <= 24) {
      count24h++;
    }
    if (hours_ago <= 24*7) {
      count7d++;
    } 
    if (hours_ago <= 24*30) {
      count30d++;
    }
  });
  data.count2h = count2h;
  data.count8h = count8h;
  data.count24h = count24h;
  data.count7d = count7d;
  data.count30d = count30d;
}


function update_host_data_statistics() {
  Object.keys(data.hostdata.host2lastconnection).forEach(host => {
    let count2h = 0, count8h = 0, count24h = 0, count7d = 0, count30d = 0;
    Object.keys(data.hour2first_and_last_connection_time).forEach(hours_ago => {
      let crawler_active = data.hour2first_and_last_connection_time[hours_ago].max-data.hour2first_and_last_connection_time[hours_ago].min > 1000*60*45;
      let host_active = data.hostdata.host2active[host].get(hours_ago);
      if (!crawler_active || !host_active) {
        return;
      } 
      if (hours_ago <= 2) {
        count2h++;
      }
      if (hours_ago <= 8) {
        count8h++;
      }
      if (hours_ago <= 24) {
        count24h++;
      }
      if (hours_ago <= 24*7) {
        count7d++;
      } 
      if (hours_ago <= 24*30) {
        count30d++;
      }
    }); 
    data.hostdata.host2count2h[host] = count2h;
    data.hostdata.host2count8h[host] = count8h;
    data.hostdata.host2count24h[host] = count24h;
    data.hostdata.host2count7d[host] = count7d;
    data.hostdata.host2count30d[host] = count30d; 
  });
}

function add_connection2data(connection) {
  if (shifting_data) {//delay by 1 second
    setTimeout(function() {
      add_connection2data(connection);
    }, 1000);
    return;
  }
  let connectTime = connection.connectTime;
  let connect_hour = Math.floor(connectTime/(1000*60*60));
  let hours_ago = data.epoch_hour-connect_hour;
  if (hours_ago < 0) return;
  let host = connection.host+":"+connection.port;

  if (data.hour2first_and_last_connection_time[hours_ago] === undefined) {
    data.hour2first_and_last_connection_time[hours_ago] = {min: connectTime, max: connectTime};
  } else {
    if (connectTime < data.hour2first_and_last_connection_time[hours_ago].min) {
      data.hour2first_and_last_connection_time[hours_ago].min = connectTime;
    }
    if (connectTime > data.hour2first_and_last_connection_time[hours_ago].max) {
      data.hour2first_and_last_connection_time[hours_ago].max = connectTime;
    }
  }

  if (data.hostdata.host2active[host] === undefined) {
    data.hostdata.host2active[host] = new BitSet();
  }  
  data.hostdata.host2active[host].set(hours_ago, connection.success ? 1 : 0); 
  if (connection.success && (data.hostdata.host2lastconnection[host] === undefined || data.hostdata.host2lastconnection[host].connectedTime < connection.connectedTime)) {
    data.hostdata.host2lastconnection[host] = connection;
  }
}

function loadDataFromDb() {
  let currentTime = (new Date()).getTime();
  data.epoch_hour = Math.floor(currentTime/(1000*60*60));
  return new Promise(function(resolve, reject) {
    recentConnections(1000*60*60*24*30)
    .on('data', function(connection) {
      add_connection2data(connection);
    })  
    .on('close', function() {
      update_crawler_data_statistics();
      update_host_data_statistics();
      resolve();
    });
  });
}

function data2Csv(delimiter, language) {
  let lines = [];
  Object.keys(data.hostdata.host2lastconnection).forEach(host => {
    let lastConnection = data.hostdata.host2lastconnection[host];
    let components = host.split(":");
    let ip = components[0];
    let port = components[1];
    let geo = geoip.lookup(ip);
    let asn = asnLookup.get(ip);
    let not_available = "N/A";
    let columns = [ip,
      port, 
      data.count2h === 0 || data.hostdata.host2count2h[host] === undefined ? not_available : formatPercentage(data.hostdata.host2count2h[host]/data.count2h), 
      data.count8h-data.count2h === 0 || data.hostdata.host2count8h[host] === undefined ? not_available : formatPercentage(data.hostdata.host2count8h[host]/data.count8h), 
      data.count24h-data.count8h === 0 || data.hostdata.host2count24h[host] === undefined ? not_available : formatPercentage(data.hostdata.host2count24h[host]/data.count24h), 
      data.count7d-data.count24h === 0 || data.hostdata.host2count7d[host] === undefined ? not_available : formatPercentage(data.hostdata.host2count7d[host]/data.count7d), 
      data.count30d-data.count7d === 0 || data.hostdata.host2count30d[host] === undefined ? not_available : formatPercentage(data.hostdata.host2count30d[host]/data.count30d), 
      geo && geo.region ? geo.region : not_available,
      geo && geo.country ? countries.getName(geo.country, language) : not_available, 
      geo && geo.city ? geo.city : not_available,
      geo && geo.ll && geo.ll.length===2 ? geo.ll[0] : not_available,
      geo && geo.ll && geo.ll.length===2 ? geo.ll[1] : not_available,
      asn ? asn.autonomous_system_organization : not_available,
      lastConnection.bestHeight,
      lastConnection.version,
      lastConnection.subversion];
    lines.push(columns.map(column => "\""+column.toString().replace(/\"/g, "\"\"")+"\"").join(delimiter));
  });
  return lines.join("\n")
}

app.get("/full_nodes.csv", function(req, res) {
  let delimiter = req.query.delimiter;
  let language = req.query.language;
  if (delimiter === undefined) delimiter = ",";
  if (language === undefined) language = "en";

  res.set('Content-Type', 'text/csv');
  res.send(data2Csv(delimiter, language));
  /*
  let currentTime = (new Date()).getTime();
  res.set('Content-Type', 'text/csv');
  let key = delimiter+":"+language
  if (full_nodes_result[key] === undefined || currentTime-full_nodes_result[key].time > 1000*60*60*1) { 
    computeFullNodeCsv(delimiter, language, function(data) {
      full_nodes_result[key] = {
        data: data,
        time: (new Date()).getTime()
      };
      res.send(data);
    });
  } else {
    res.send(full_nodes_result[key].data);
  }
  */
});


function shift_data_one_hour() {
  let shifted = {};
  Object.keys(data.hour2first_and_last_connection_time).forEach(hour => {
    if (hour+1 > 24*30) return;//only keep 30 days
    shifted[hour+1] = data.hour2first_and_last_connection_time[hour];
  });
  data.hour2first_and_last_connection_time = shifted;

  Object.keys(data.hostdata.host2lastconnection).forEach(host => {
    let lastConnection = data.hostdata.host2lastconnection[host];
    let last_connect_hour = Math.floor(lastConnection.connectTime/(1000*60*60));
    if (data.epoch_hour-last_connect_hour > 24*30) {
      delete data.hostdata.host2lastconnection[host];
      return;
    }
    for (let i = 24*30; i > 0; i--) {
      data.hostdata.host2active[host].set(i, data.hostdata.host2active[host].get(i-1));
    }
  });
}

let shifting_data = false;

function update_if_hour_changed() {
  let currentTime = (new Date()).getTime();
  let epoch_hour = Math.floor(currentTime/(1000*60*60));
  if (data.epoch_hour >= epoch_hour) return;
  shifting_data = true;
  console.log("Hour changed. Updating uptimes");
  data.epoch_hour = epoch_hour;
  shift_data_one_hour();
  update_crawler_data_statistics();
  update_host_data_statistics();
  shifting_data = false;
}



console.log("Loading connections from db. This can take a while.");
loadDataFromDb().then(function() {
  console.log("Data loaded. Acccepting requests");
  app.listen(api_port);
  setInterval(connectToPeers, 50);

  if (addr_db_ttl !== undefined && addr_db_ttl > 0) 
    setInterval(removeOldAddr, 1000*60);
});


function createRandomId () {
  return '' + Math.random().toString(36).substr(2, 9);
};

//Adds leading zeros to make result 14 characters long for lexicographical ordering. Only works for integers from 0 to 99999999999999
function integer2LexString(number) {
  let result = ""+number;
  while (result.length < 14) {
    result = "0"+result;
  }
  return result;
}


function recentConnections(duration) {
  let currentTime = (new Date()).getTime();

  let event2callback = {
    'data': function(data) {},
    'error': function(err) {},
    'close': function() {},
    'end': function() {}
  }

  db.createValueStream({
    gt: connection_by_time_prefix+integer2LexString(currentTime-duration), 
    lt: connection_by_time_prefix+"z",
    valueEncoding: 'utf8'
  })
  .on('data', function (data) {
    let connectionId = data.replace(/\"/g, "");
    db.get(connection_prefix+connectionId, function(err, value) {
      if (err) return;
      event2callback['data'](value);
    });
  })
  .on('error', function (err) {
    event2callback['err'](value);
  })
  .on('close', function () {
    event2callback['close']();
  })
  .on('end', function () {
    event2callback['end']();
  });

  return {
    on: function(event, callback) {
      event2callback[event] = callback;
      return this;
    }
  }
}


function host2lastAddr(duration) {
  let event2callback = {
    'data': function(data) {},
    'error': function(err) {},
    'close': function() {},
    'end': function() {}
  }
  let currentTime = (new Date()).getTime();
  db.createReadStream({
    gt: host2lastaddr_prefix,
    lt: host2lastaddr_prefix+"z"
  })
  .on('data', function (data) {
    if (duration !== undefined && currentTime-data.value > duration) return;
    event2callback['data'](data);
  })
  .on('error', function (err) {
    event2callback['error'](error);
  })
  .on('close', function () {
    event2callback['close']();
  })
  .on('end', function () {
    event2callback['end']();
  });
  return {
    on: function(event, callback) {
      event2callback[event] = callback;
      return this;
    }
  }
}

function createQueue(callback) {
  const hour = 1000*60*60;
  let host2LastConnectionPromise = new Promise(function(resolve, reject) {
    let host2LastConnection = {};
    recentConnections(hour*3)
    .on('data', function(connection) {
      let key = connection.host+":"+connection.port;
      if (host2LastConnection[key] === undefined || connection.connectTime > host2LastConnection[key].connectTime) {
        host2LastConnection[key] = connection;
      }
    })
    .on('close', function() {
      resolve(host2LastConnection);
    });
  });
  let host2timePromise = new Promise(function(resolve, reject) {
    let host2time = {};
    host2lastAddr(max_age)
    .on('data', function(data) {
        host2time[data.key.substr(host2lastaddr_prefix.length)] = data.value;
    })
    .on('close', function() {
      resolve(host2time);
    });
  });
  Promise.all([host2LastConnectionPromise, host2timePromise]).then(function(values) {
    let host2LastConnection = values[0];
    let host2addrtime = values[1];
    let result = [];
    Object.keys(host2addrtime).forEach(host => {
      let lastAddrTime = host2addrtime[host];
      let currentTime = (new Date()).getTime();
      let nextConnection;
      if (host2LastConnection[host] === undefined) {
        nextConnection = currentTime-lastAddrTime;//connect immediately but give more priority if recent
      } else if (host2LastConnection[host].success) {
        nextConnection = host2LastConnection[host].connectTime+hour*0.5;//every ½ hours
      } else {
        if (lastAddrTime > host2LastConnection[host].connectTime) {
          nextConnection = host2LastConnection[host].connectTime+hour*1;
        } else {
          nextConnection = host2LastConnection[host].connectTime+hour*3;
        }
      }
      let components = host.split(":");
      let ip = components[0];
      let port = components[1];
      result.push({
        host: ip,
        port: port,
        nextConnection: nextConnection
      });
    });
    result.sort((a, b) => a.nextConnection-b.nextConnection);
    callback(result);
  });
}  


function saveConnection(connection, connectionId) {
  update_if_hour_changed();
  add_connection2data(connection);
  const ops = [
    { type: 'put', key: connection_prefix+connectionId, value: connection },
    { type: 'put', key: connection_by_time_prefix+integer2LexString(connection.connectTime)+"/"+connectionId, value: connectionId }
  ];
  db.batch(ops, function (err) {
    if (err) return console.log('Ooops!', err);
  });
}

function connectToPeers() {
  if (paused) return;
  update_if_hour_changed();
  let currentTime = (new Date()).getTime();
  while (failed_connections_queue.length > 0 && currentTime-failed_connections_queue[0] > 1000*60) {
    failed_connections_queue.shift();
  }

  let status = "queue: "+ queue.length+", failed_connections_queue: "+ failed_connections_queue.length+", concurrent_connections: "+concurrent_connections;
  if (queue.length > 0 && queue[0].nextConnection > currentTime) {
    status += ", next action in " + Math.floor((queue[0].nextConnection-currentTime)/1000) + " seconds.";
  }  
  if (status !== status_string) {
    console.log(status);
    status_string = status;
  }

  if (queue.length > 0) {
    let nextActionTime = currentTime-lastConnectTime > 1000*60*1 ? 0 : queue[0].nextConnection;
    if (nextActionTime <= currentTime 
      && concurrent_connections < max_concurrent_connections 
      && failed_connections_queue.length < max_failed_connections_per_minute) {
      let e = queue.shift();
      let host = e.host;
      let port = e.port;
      console.log("connecting to "+host+":"+port);
      concurrent_connections++;
      let connectionId = createRandomId();
      let connectTime = (new Date()).getTime();
      lastConnectTime = connectTime;
      failed_connections_queue.push(connectTime);
      let peer = new p2p.Peer({host: host, port: port, network: network_name, messages: messages});
      let disconnect_called = false;

      let connectionSaved = false;

      let connection = {
        host: peer.host, 
        port: peer.port,
        success:false, 
        connectTime: connectTime
      };

      /*const ops = [
        { type: 'put', key: connection_prefix+connectionId, value: connectionAttempt },
        { type: 'put', key: connection_by_time_prefix+integer2LexString(connectTime)+"/"+connectionId, value: connectionId }
      ];

      db.batch(ops, function (err) {
        if (err) return console.log('Ooops!', err);
      });*/

      let connectTimeout = setTimeout(function() {
        peer.disconnect(); 
      }, connect_timeout);

      let handshakeTimeout;
      let addrTimeout;

      peer.on('connect', function(e) {
        clearTimeout(connectTimeout);
        handshakeTimeout = setTimeout(function() {
          peer.disconnect(); 
        }, handshake_timeout);
      });

      peer.on('version', function(e) {
        peer.services = Number(e.services);
      });

      peer.on('reject', function(e) {
        peer.disconnect();
      });

      peer.on('ready', function() {
        clearTimeout(handshakeTimeout);
        let pos = failed_connections_queue.indexOf(connectTime);
        if (pos > -1) {
          failed_connections_queue.splice(pos, 1);
        }
        let node_network_limited = (peer.services & 1024) !== 0;
        let node_witness = (peer.services & 8) !== 0;
        let node_bloom = (peer.services & 4) !== 0;
        let node_getutxo = (peer.services & 2) !== 0;
        let node_network = (peer.services & 1) !== 0;
        console.log("connected to ", peer.host+":"+peer.port, peer.version, peer.subversion, peer.bestHeight, peer.services, node_network, node_getutxo, node_bloom, node_witness, node_network_limited);

        let connectedTime = (new Date()).getTime();
        connection = {
          host: peer.host,
          port: peer.port, 
          version: peer.version, 
          subversion: peer.subversion, 
          bestHeight: peer.bestHeight, 
          services: peer.services,
          success:true, 
          connectedTime: connectedTime, 
          connectTime: connectTime,
        };

        if (!connectionSaved) {
          connectionSaved = true;
          saveConnection(connection, connectionId);
        }
        /*db.put(connection_prefix+connectionId, connectionSuccess, function (err) {
          if (err) return console.log('Ooops!', err) // some kind of I/O error
        });*/

        
        let getaddr = messages.GetAddr();
        peer.sendMessage(getaddr);

        addrTimeout = setTimeout(function() {
          console.log("No addr message withing "+stay_connected_time/1000+" seconds");
          peer.disconnect(); 
        }, stay_connected_time);
      });
      
      peer.on('error', function(err) {
        clearTimeout(handshakeTimeout);
        clearTimeout(connectTimeout);
        console.log("peer error", err);
        peer.disconnect();
      });
      
      peer.on('disconnect', function() {
        clearTimeout(handshakeTimeout);
        clearTimeout(connectTimeout);
        if (!connectionSaved) {
          connectionSaved = true;
          saveConnection(connection, connectionId);
        }
        if (!disconnect_called) {
          disconnect_called = true;
          concurrent_connections--;
          console.log('connection closed to '+peer.host+":"+peer.port);
        }
      });
      
      peer.on('addr', function(message) {
        console.log(message.addresses.length+" addresses received from "+peer.host+":"+peer.port);
        let addrTimeStamp = (new Date()).getTime();
        let addrMessageId = createRandomId();
        message.addresses.forEach(function(address) {

          let addressId = createRandomId();
          let obj = {connectionId: connectionId, addrMessageId: addrMessageId, timestamp: addrTimeStamp, ip: address.ip, port: address.port, time: address.time.getTime()};
          if (obj.port < 1024 || obj.port > 65535) {
            console.log("INVALID PORT RANGE "+ obj.port+". Ignoring "+address.ip.v4);
            return;
          }
          if (address.ip.v4.startsWith("0.")) {
            console.log(address.ip.v4+" start with 0. Ignoring");
            return;
          }
          if (obj.time > addrTimeStamp+5000) {
            console.log("addr time more than 5 seconds in the future. Ignoring");
            return;
          }

          let key = host2lastaddr_prefix+address.ip.v4+":"+address.port;
          db.get(key, function(err, value) {
            
            const ops = [];
            if (addr_db_ttl === undefined || addr_db_ttl === 0 || Math.max(0, addrTimeStamp-address.time.getTime()) < addr_db_ttl) {
              ops.push({ type: 'put', key: addr_prefix+addressId, value: obj });
              ops.push({ type: 'put', key: addr_by_time_prefix+integer2LexString(address.time.getTime())+"/"+addressId, value: addressId });
            }

            if ((err && err.notFound) || address.time.getTime() > value) {
              ops.push({type: 'put', key: key, value: address.time.getTime()});
            }  
            if (ops.length > 0) {
              db.batch(ops, function (err) {
                if (err) return console.log('Ooops!', err);
              });
            }
          });

        });
        if (message.addresses.length > 20) {
          if (addrTimeout !== undefined) clearTimeout(addrTimeout);
          peer.disconnect();
        }
      });
      peer.connect();
      
    }
  }
  if (queue.length < 250 && currentTime-lastRefreshTime > 1000*15) {
    refreshQueue();
  } else if (queue.length < 500 && currentTime-lastRefreshTime > 1000*30) {//every 30 seconds
    refreshQueue();
  } else if (queue.length < 1000 && currentTime-lastRefreshTime > 1000*60) {//every minute
    refreshQueue();
  } else if (queue.length < 2000 && currentTime-lastRefreshTime > 1000*60*2) {//every 2 minutes
    refreshQueue();
  } else if (queue.length < 4000 && currentTime-lastRefreshTime > 1000*60*4) {//every 4 minutes
    refreshQueue();
  } else if (currentTime-lastRefreshTime > 1000*60*8) {//every 8 minutes
    refreshQueue();
  }
}

function refreshQueue() {
  paused = true;
  createQueue(function(data) {
    if (data.length === 0) {
      queue = [];
      seedNodes.forEach(host => queue.push({host:host, port: bitcore_lib.Networks.get(network_name).port, nextConnection:0}));
    } else {
      queue = data;
    }  
    console.log("Queue refreshed. New size: "+queue.length);
    paused = false;
    lastRefreshTime = (new Date()).getTime();
  });
}

let removing_addresses = false;

function removeOldAddr() {
  if (removing_addresses) return;
  removing_addresses = true;
  let currentTime = (new Date()).getTime();
  let removeArr = [];
  db.createReadStream({
    gt:addr_by_time_prefix, 
    lt:addr_by_time_prefix+integer2LexString(currentTime-addr_db_ttl), 
    valueEncoding: 'utf8',
    limit: 100000
  })
  .on('data', function (data) {
    let addrId = data.value.replace(/\"/g, "");
    let key = data.key;
    removeArr.push({ type: 'del', key: addr_prefix+addrId });
    removeArr.push({ type: 'del', key: key });

  })
  .on('error', function (err) {
    console.log('Oh my!', err)
  })
  .on('close', function () {
    if (removeArr.length > 0) {
      db.batch(removeArr, function (err) {
        removing_addresses = false;
        if (err) return console.log('Ooops!', err);
      });
    } else {
      removing_addresses = false;
    }
  })
  .on('end', function () {
  });

}

process.on('uncaughtException', (err) => {
  if (!err.toString().startsWith('Error: Unsupported message command')) {
    console.log("unkown err", err);
  }
});
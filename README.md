# Coin Crawler Documentation

## 1. Install

**Prerequisites**

Node 6.x.x or higher

NPM 3.5.x or higher

On Debian / Ubuntu, you can run:

\# apt-get install nodejs npm

Tested on Ubuntu 18.04 LTS.

download maxmind database and place it in the GeoLite folder

npm install

currently btc, bch, ltc and dash are supported. You can add more coins to networks.js

## 2. Run:

node run.js -network=btc-livenet -port=3003

## 3. Commands / Server Query:

see if it's running: http://$hostIP:3003/node_count, http://$hostIP:3003/full_nodes.csv

## 4. Advanced commands:
### 4.1. Language of country

For example in 
Russian: http://$hostIP:3000/full_nodes.csv?language=ru

German: http://$hostIP:3000/full_nodes.csv?language=de

Hebrew: http://$hostIP:3000/full_nodes.csv?language=he

Japanese: http://$hostIP:3000/full_nodes.csv?language=ja

### 4.2. Filter out inactive nodes:

$hostIP:3003/full_nodes.csv?active=1

### 4.3. Rate limiter: 
(some host or VPS providers will balk at you for virus-like activity, which crawler is.)

feel free to edit these variables in run.js:

const max_failed_connections_per_minute = 200;

const max_concurrent_connections = 200;

## 5. Known Issues:
on occasion, it might 'crawl' or 'connect' to the wrong network, adding their data into statistics.

&nbsp;

Special thanks to Alexey Eromenko a.k.a. "Technologov" for sponsoring this project!

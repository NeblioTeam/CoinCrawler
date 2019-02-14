## Prerequisites

Node 6.x.x or higher

NPM 3.5.x or higher

On Debian / Ubuntu, you can run:

\# apt-get install nodejs npm

## 1. Install

npm install -g coin-crawler

Download [maxmind ASN database](https://geolite.maxmind.com/download/geoip/database/GeoLite2-ASN.tar.gz) and place GeoLite2-ASN.mmdb in the directory where you are planning to run the crawler.

## 2. Run:

coin-clustering -network=btc -port=3003

currently btc, bch, ltc and dash are supported.

## 3. Commands / Server Query:

see if it's running: http://localhost:3003/node_count, http://localhost:3003/full_nodes.csv

### 4.2. Filter out inactive nodes:

http://localhost:3003/full_nodes.csv?active=1

### 4.3. Rate limiter: 
(some host or VPS providers will balk at you for virus-like activity, which crawler is.)

coin-clustering -network=btc -port=3003 -max_failed_connections_per_minute=200 -max_concurrent_connections=300

defaults: -max_failed_connections_per_minute=300 -max_concurrent_connections=800

## 5. Known Issues:
on occasion, it might 'crawl' or 'connect' to the wrong network, adding their data into statistics.

&nbsp;

Special thanks to Alexey Eromenko a.k.a. "Technologov" for sponsoring this project!

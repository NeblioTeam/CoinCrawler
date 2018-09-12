# CoinCrawler
## Prerequisites
* Node 6.x.x or higher
* NPM 5.x.x or higher
## Setup
* [download maxmind database](https://github.com/Antti-Kaikkonen/CoinCrawler/blob/master/GeoLite2-ASN/README.md) and place it in the GeoLite folder
* npm install
* node run.js -network=btc-livenet -port=3003
* see if it's running: localhost:3003/node_count, localhost:3003/full_nodes.csv
* currently btc, bch, ltc and dash are supported. You can add more coins to [networks.js](networks.js)

Special thanks to Alexey Eromenko a.k.a. "Technologov" for sponsoring this project!

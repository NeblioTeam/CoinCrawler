let networks = [
  {
    name: 'btc',
    networkMagic: 0xf9beb4d9,
    port: 8333,
    protocolVersion: 70001,
    seedNodes: [
      '104.198.122.115', '35.185.146.52', '35.185.174.92', '35.187.204.47',
      '18.217.214.141', '198.187.28.6'

    ],
    heightIncludeUA: [
      'Satoshi'
    ]
  },
  {
    name: 'bch',
    networkMagic: 0xe3e1f3e8,
    port: 8333,
    protocolVersion: 70001,
    seedNodes: [
      '144.76.186.69', '93.104.208.119', '54.183.239.226', '159.89.96.177',
      '47.94.57.92', '13.125.213.202', '35.168.169.158', '13.126.239.87',
      '70.174.181.21', '194.14.247.163', '95.216.21.109', '139.162.179.234'
    ],
    heightIncludeUA: [
      'Bitcoin ABC',
      'bitprim',
      'BUCash',
      'bcash'
    ]
  },
  {
    name: 'dash',
    networkMagic: 0xbf0c6bbd,
    port: 9999,
    protocolVersion: 130000,
    seedNodes: [
      '146.185.143.241', '74.207.228.180', '34.227.124.8', '138.68.84.0',
      '45.32.127.103', '95.216.2.183', '85.255.4.212', '45.63.26.62',
      '95.213.242.194'
    ],
    heightIncludeUA: [
      'Dash Core'
    ]
  },
  {
    name: 'ltc',
    networkMagic: 0xfbc0b6db,
    port: 9333,
    protocolVersion: 70015,
    seedNodes: [
      '23.225.199.250', '52.51.118.175', '47.91.139.113', '47.90.245.73',
      '37.187.110.91', '23.92.221.66', '148.66.58.194', '138.201.30.201',
      '178.32.125.112', '78.25.100.22', '207.254.60.12', '185.183.161.35',
      '78.46.177.74', '94.130.52.104', '37.221.209.222', '193.46.80.101',
      '204.228.147.42', '130.240.22.202', '85.31.186.66', '47.97.215.104',
      '165.227.77.105',  '144.217.77.231', '35.158.105.195', '176.9.122.21',
      '107.150.56.162', '163.172.194.30', '213.136.88.77', '144.76.168.46',
      '185.215.227.217', '159.89.44.142', '176.126.167.10', '108.170.26.210'
    ],
    heightIncludeUA: [
      'LitecoinCore'
    ]
  },
  {
    name: 'nebl',
    networkMagic: 0x325e6f86,
    port: 6325,
    protocolVersion: 60210,
    seedNodes: [
       '128.199.205.137', '178.62.247.189', 'seed.nebl.io', 'explorer.nebl.io'
    ],
    heightIncludeUA: [
      'Satoshi'
    ]
  }

];

module.exports = networks;
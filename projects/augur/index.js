/*==================================================
  Modules
  ==================================================*/

  const sdk = require('../../sdk');

/*==================================================
  Main
  ==================================================*/

  async function run(timestamp, block) {
    let getBalance = await sdk.api.eth.getBalance({target: '0xd5524179cB7AE012f5B642C1D6D700Bbaa76B96b', block});

    let balances = {
      '0x0000000000000000000000000000000000000000': getBalance.output
    };

    let symbolBalances = await sdk.api.util.toSymbols(balances);

    return symbolBalances.output;
  }

/*==================================================
  Exports
  ==================================================*/

  module.exports = {
    name: 'Augur',
    token: 'REP',
    category: 'Derivatives',
    start: 1531008000, // 07/08/2018 @ 12:00am (UTC)
    run
  }

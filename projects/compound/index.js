/*==================================================
  Modules
  ==================================================*/

const _ = require('underscore');
const sdk = require('../../sdk');
const abi = require('./abi.json');
const BigNumber = require('bignumber.js');

/*==================================================
  Settings
  ==================================================*/

  // cache some data
  const markets = [
    {
      underlying: '0x0D8775F648430679A709E98d2b0Cb6250d2887EF',
      symbol: 'BAT',
      decimals: 18,
      cToken: '0x6C8c6b02E7b2BE14d4fA6022Dfd6d75921D90E4E',
    },
    {
      underlying: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      decimals: 18,
      cToken: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
    },
    {
      underlying: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      decimals: 18,
      cToken: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
    }, //cETH => WETH
    {
      underlying: '0x1985365e9f78359a9B6AD760e32412f4a445E862',
      symbol: 'REP',
      decimals: 18,
      cToken: '0x158079Ee67Fce2f58472A96584A73C7Ab9AC95c1',
    },
    {
      underlying: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6,
      cToken: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
    },
    {
      underlying: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      decimals: 6,
      cToken: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
    },
    {
      underlying: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      decimals: 8,
      cToken: '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4',//cWBTC - legacy
    },
    {
      underlying: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      decimals: 8,
      cToken: '0xccf4429db6322d5c611ee964527d42e5d685dd6a'//cWBTC
    },
    {
      underlying: '0xE41d2489571d322189246DaFA5ebDe1F4699F498',
      symbol: 'ZRX',
      decimals: 18,
      cToken: '0xB3319f5D18Bc0D84dD1b4825Dcde5d5f7266d407',
    },
    {
      underlying: '0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359',
      symbol: 'SAI',
      decimals: 18,
      cToken: '0xF5DCe57282A584D2746FaF1593d3121Fcac444dC',
    },
  ];

/*==================================================
  TVL
  ==================================================*/

// ask comptroller for all markets array
async function getAllCTokens(block) {
  return (await sdk.api.abi.call({
    block,
    target: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b',
    params: [],
    abi: abi['getAllMarkets'],
  })).output;
}

async function getUnderlying(block, cToken) {
  if (cToken === '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5') {
    return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';//cETH => WETH
  }

  return (await sdk.api.abi.call({
    block,
    target: cToken,
    abi: abi['underlying'],
  })).output;
}

// returns {[underlying]: {cToken, decimals, symbol}}
async function getMarkets(block) {
  if (block < 10271924) {
    // the allMarkets getter was only added in this block.
    return markets;
  } else {
    let allCTokens = await getAllCTokens(block);
    // if not in cache, get from the blockchain
    await (
      Promise.all(allCTokens.map(async (cToken) => {
        let foundMarket = false;
        for (let market of markets) {
          if (market.cToken.toLowerCase() === cToken.toLowerCase()) {
            foundMarket = true;
          }
        }
        if (!foundMarket) {
          let underlying = await getUnderlying(block, cToken);
          let info = await sdk.api.erc20.info(underlying);
          markets.push({ underlying, cToken, decimals: info.output.decimals, symbol: info.output.symbol })
        }
      }))
    );

    return markets;
  }
}

async function tvl(timestamp, block) {
  let balances = {};
  let markets = await getMarkets(block);

  // Get V1 tokens locked
  let v1Locked = await sdk.api.abi.multiCall({
    block,
    calls: _.map(markets, (market) => ({
      target: market.underlying,
      params: '0x3FDA67f7583380E67ef93072294a7fAc882FD7E7',
    })),
    abi: 'erc20:balanceOf',
  });

  sdk.util.sumMultiBalanceOf(balances, v1Locked);

  // Get V2 tokens locked
  let v2Locked = await sdk.api.abi.multiCall({
    block,
    calls: _.map(markets, (market) => ({
      target: market.cToken,
    })),
    abi: abi['getCash'],
  });

  _.each(markets, (market) => {
    let getCash = _.find(v2Locked.output, (result) => result.success && result.input.target === market.cToken);

    if (getCash) {
      balances[market.underlying] = BigNumber(balances[market.underlying] || 0)
        .plus(getCash.output)
        .toFixed();
    }
  });
  return balances;
}

/*==================================================
  Rates
  ==================================================*/

async function rates(timestamp, block) {
  let rates = {
    lend: {},
    borrow: {},
    supply: {},
  };

  let v1Tokens = {};

  // V2
  const markets = await getMarkets();

  const calls = _.map(markets, (data) => ({
    target: data.cToken,
  }));

  const supplyResults = (await sdk.api.abi.multiCall({
    block,
    calls,
    abi: abi['supplyRatePerBlock'],
  })).output;

  const borrowResults = (await sdk.api.abi.multiCall({
    block,
    calls,
    abi: abi['borrowRatePerBlock'],
  })).output;

  const totalBorrowsResults = (await sdk.api.abi.multiCall({
    block,
    calls,
    abi: abi['totalBorrows'],
  })).output;

  _.each(markets, (data) => {
    let supplyRate = _.find(
      supplyResults,
      (result) => result.success && result.input.target == data.cToken
    );
    let borrowRate = _.find(
      borrowResults,
      (result) => result.success && result.input.target == data.cToken
    );
    let totalBorrows = _.find(
      totalBorrowsResults,
      (result) => result.success && result.input.target == data.cToken
    );

    if (supplyRate && borrowRate && totalBorrows) {
      let symbol = data.symbol;
      rates.lend[symbol] = String(
        ((1 + supplyRate.output / 1e18) ** (365 * 5760) - 1) * 100
      );
      rates.borrow[symbol] = String(
        ((1 + borrowRate.output / 1e18) ** (365 * 5760) - 1) * 100
      );
      rates.supply[symbol] = BigNumber(totalBorrows.output)
        .div(10 ** data.decimals)
        .toFixed();
    } else {
      v1Tokens[data.underlying] = data;
    }
  });

  // V1
  if (_.keys(v1Tokens).length) {
    const blocksPerYear = 2102400;

    const marketsResults = (await sdk.api.abi.multiCall({
      block,
      calls: _.map(v1Tokens, (data) => ({
        target: '0x3FDA67f7583380E67ef93072294a7fAc882FD7E7',
        params: data.underlying,
      })),
      abi: abi['markets'],
    })).output;

    _.each(marketsResults, (market) => {
      if (market.success && market.output.isSupported) {
        const underlying = market.input.params[0];
        if (v1Tokens[underlying]) {
          const symbol = v1Tokens[underlying].symbol;
          rates.lend[symbol] = String(
            (market.supplyRateMantissa / 1e18) * blocksPerYear * 100
          );
          rates.borrow[symbol] = String(
            (market.borrowRateMantissa / 1e18) * blocksPerYear * 100
          );
          rates.supply[symbol] = String(market.totalBorrows / 1e18);
        }
      }
    });
  }

  return rates;
}

/*==================================================
  Exports
  ==================================================*/

module.exports = {
  name: 'Compound',
  website: 'https://compound.finance',
  token: null,
  category: 'lending',
  start: 1538006400, // 09/27/2018 @ 12:00am (UTC)
  tvl,
  rates,
  term: '1 block',
  permissioning: 'Open',
  variability: 'Medium',
};

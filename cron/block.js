require('babel-polyfill');

const blockchain = require('../lib/blockchain');
const config = require('../config');
const { exit, rpc } = require('../lib/cron');
const { forEachSeries } = require('p-iteration');
const locker = require('../lib/locker');
const util = require('./util');

// Models.
const Block = require('../model/block');
const TX = require('../model/tx');
const UTXO = require('../model/utxo');
const BlockRewardDetails = require('../model/blockRewardDetails');

/**
 * console.log but with date prepended to it
 */
console.dateLog = (...log) => {
  if (!config.verboseCron) {
    console.log(...log);
    return;
  }

  const currentDate = new Date().toGMTString();
  console.log(`${currentDate}\t`,...log);
}

/**
 * Process the blocks and transactions.
 * @param {Number} start The current starting block height.
 * @param {Number} stop The current block height at the tip of the chain.
 */
async function syncBlocks(start, stop, clean = false) {
  if (clean) {
    await Block.remove({ height: { $gte: start, $lte: stop } });
    await TX.remove({ blockHeight: { $gte: start, $lte: stop } });
    await UTXO.remove({ blockHeight: { $gte: start, $lte: stop } });
    await BlockRewardDetails.remove({ blockHeight: { $gte: start, $lte: stop } });
  }

  let block;
  for (let height = start; height <= stop; height++) {
    const hash = await rpc.call('getblockhash', [height]);
    const rpcblock = await rpc.call('getblock', [hash]);

    block = new Block({
      hash,
      height,
      bits: rpcblock.bits,
      confirmations: rpcblock.confirmations,
      createdAt: new Date(rpcblock.time * 1000),
      diff: rpcblock.difficulty,
      merkle: rpcblock.merkleroot,
      nonce: rpcblock.nonce,
      prev: (rpcblock.height == 1) ? 'GENESIS' : rpcblock.previousblockhash ? rpcblock.previousblockhash : 'UNKNOWN',
      size: rpcblock.size,
      txs: rpcblock.tx ? rpcblock.tx : [],
      ver: rpcblock.version
    });

    // Count how many inputs/outputs are in each block
    let vinsCount = 0;
    let voutsCount = 0;

    // Notice how we're ensuring to only use a single rpc call with forEachSeries()
    await forEachSeries(block.txs, async (txhash) => {
      const rpctx = await util.getTX(txhash, true);

      vinsCount += rpctx.vin.length;
      voutsCount += rpctx.vout.length;

      if (blockchain.isPoS(block)) {
        await util.addPoS(block, rpctx);
      } else {
        await util.addPoW(block, rpctx);
      }
    });

    block.vinsCount = vinsCount;
    block.voutsCount = voutsCount;

    // Notice how this is done at the end. If we crash half way through syncing a block, we'll re-try till the block was correctly saved.
    await block.save();

    const syncPercent = ((block.height / stop) * 100).toFixed(2);
    console.dateLog(`(${syncPercent}%) Height: ${block.height}/${stop} Hash: ${block.hash} Txs: ${block.txs.length} Vins: ${vinsCount} Vouts: ${voutsCount}`);
  }
}

/**
 * Handle locking.
 */
async function update() {
  const type = 'block';
  let code = 0;

  config.verboseCron && console.dateLog(`Block Sync Started`)
  try {
    // Create the cron lock, if return is called below the finally will still be triggered releasing the lock without errors
    // Notice how we moved the cron lock on top so we lock before block height is fetched otherwise collisions could occur
    locker.lock(type);

    const info = await rpc.call('getinfo');
    const block = await Block.findOne().sort({ height: -1 });

    let clean = true; // We no longer need to clean by default because block is the last item inserted. If we have the block that means all data for that block exists
    let dbHeight = block && block.height ? block.height + 1 : 1;
    let rpcHeight = info.blocks;

    // If heights provided then use them instead.
    if (!isNaN(process.argv[2])) {
      clean = true;
      dbHeight = parseInt(process.argv[2], 10);
    }
    if (!isNaN(process.argv[3])) {
      clean = true;
      rpcHeight = parseInt(process.argv[3], 10);
    }
    console.dateLog(`DB Height: ${dbHeight - 1}, RPC Height: ${rpcHeight}, Clean Start: (${clean ? "YES" : "NO"})`);

    // If nothing to do then exit.
    if (dbHeight >= rpcHeight) {
      console.dateLog(`No Sync Required!`);
      locker.unlock(type); // Be sure to properly unlock cron
      return;
    }
    // If starting from genesis skip.
    else if (dbHeight === 0) {
      dbHeight = 1;
    }

    config.verboseCron && console.dateLog(`Sync Started!`);
    await syncBlocks(dbHeight, rpcHeight, clean);
    config.verboseCron && console.dateLog(`Sync Finished!`);

    locker.unlock(type); // It is important that we keep proper lock during syncing otherwise there will be blockchain data corruption and we can't be sure of integrity
  } catch (err) {
    console.dateLog(err);
    code = 1;
  } finally {
    config.verboseCron && console.log(""); // Adds new line between each run with verbosity
    exit(code);
  }
}

update();
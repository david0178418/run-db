/**
 * mattercloud.js
 *
 * MatterCloud API
 */

const axios = require('axios')
const bsv = require('bsv')
global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const RUN_0_6_FILTER = '006a0372756e0105'

// ------------------------------------------------------------------------------------------------
// MatterCloud
// ------------------------------------------------------------------------------------------------

class MatterCloud {
  constructor (apiKey, logger) {
    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolEvents = null
  }

  async connect (height, network) {
    if (network !== 'main') throw new Error(`Network not supported with MatterCloud: ${network}`)
  }

  async disconnect () {
    if (this._mempoolEvents) {
      this.mempoolEvents.close()
      this.mempoolEvents = null
    }
  }

  async fetch (txid) {
    const response = await axios.get(`https://media.bitcoinfiles.org/tx/${txid}/raw${this.suffix}`)
    return response.data
  }

  async getNextBlock (currHeight, currHash) {
    const height = currHeight + 1
    let hash = null

    try {
      const response = await axios.get(`https://media.bitcoinfiles.org/height/${height}${this.suffix}`)
      hash = response.data.blockhash
    } catch (e) {
      if (e.response && e.response.status === 404) return undefined
      throw e
    }

    try {
      const response = await axios.get(`https://media.bitcoinfiles.org/block/${hash}/tx/filter/${RUN_0_6_FILTER}${this.suffix}`)

      const prevHash = response.data.header.prevHash
      if (currHash && prevHash !== currHash) return { reorg: true }

      const txhexs = response.data.tx.map(tx => tx.raw)
      const txids = txhexs.map(hex => new bsv.Transaction(hex).hash)
      const time = response.data.header.time
      return { height, hash, time, txids, txhexs }
    } catch (e) {
      if (e.response && e.response.status === 404) return undefined
      throw e
    }
  }

  async listenForMempool (mempoolTxCallback) {
    this.logger.info('Listening for mempool via MatterCloud SSE')

    return new Promise((resolve, reject) => {
      this.mempoolEvents = new ReconnectingEventSource(`https://stream.bitcoinfiles.org/mempool?filter=${RUN_0_6_FILTER}`)

      this.mempoolEvents.onerror = (e) => reject(e)

      this.mempoolEvents.onmessage = event => {
        if (event.type === 'message') {
          const data = JSON.parse(event.data)

          if (data === 'connected') {
            resolve()
            return
          }

          mempoolTxCallback(data.h, data.raw)
        }
      }
    })
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = MatterCloud

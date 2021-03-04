/**
 * database.js
 *
 * Layer between the database and the application
 */

const Sqlite3Database = require('better-sqlite3')
const { DEFAULT_TRUSTLIST } = require('./config')

// ------------------------------------------------------------------------------------------------
// Tx
// ------------------------------------------------------------------------------------------------

class Tx {
  constructor (txid, downloaded, hasCode) {
    this.txid = txid
    this.hasCode = hasCode
    this.queuedForExecution = false
    this.upstream = new Set()
    this.downstream = new Set()
  }
}

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor (path) {
    this.path = path
    this.db = null
    this.trustlist = null
    this.unexecuted = null
    this.numQueuedForExecution = 0

    this.onReadyToExecute = null
    this.onAddTransaction = null
    this.onDeleteTransaction = null
    this.onTrustTransaction = null
    this.onUntrustTransaction = null
  }

  open () {
    if (this.db) throw new Error('Database already open')

    this.db = new Sqlite3Database(this.path)

    this.db.pragma('cache_size = 128000')
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = OFF')
    this.db.pragma('journal_mode = MEMORY')

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS tx (
        txid TEXT NOT NULL,
        height INTEGER,
        time INTEGER,
        hex TEXT,
        has_code INTEGER,
        executable INTEGER,
        executed INTEGER,
        indexed INTEGER,
        UNIQUE(txid)
      )`
    ).run()

    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)'
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS deps (
        up TEXT NOT NULL,
        down TEXT NOT NULL,
        UNIQUE(up, down)
      )`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS jig (
        location TEXT NOT NULL PRIMARY KEY,
        state TEXT NOT NULL
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS berry (
        location TEXT NOT NULL PRIMARY KEY,
        state TEXT NOT NULL
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS trust (
        txid TEXT NOT NULL PRIMARY KEY,
        value INTEGER
      ) WITHOUT ROWID`
    ).run()

    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS crawl (
        role TEXT UNIQUE,
        height INTEGER,
        hash TEXT
      )`
    ).run()

    const setupCrawlStmt = this.db.prepare('INSERT OR IGNORE INTO crawl (role, height, hash) VALUES (\'tip\', 0, NULL)')
    const trustIfMissingStmt = this.db.prepare('INSERT OR IGNORE INTO trust (txid, value) VALUES (?, 1)')

    this.transaction(() => {
      setupCrawlStmt.run()
      for (const txid of DEFAULT_TRUSTLIST) {
        trustIfMissingStmt.run(txid)
      }
    })

    this.addNewTransactionStmt = this.db.prepare('INSERT OR IGNORE INTO tx (txid, hex, height, time, has_code, executable, executed, indexed) VALUES (?, null, ?, ?, 0, 0, 0, 0)')
    this.setTransactionHexStmt = this.db.prepare('UPDATE tx SET hex = ? WHERE txid = ?')
    this.setTransactionExecutableStmt = this.db.prepare('UPDATE tx SET executable = ? WHERE txid = ?')
    this.setTransactionTimeStmt = this.db.prepare('UPDATE tx SET time = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.db.prepare('UPDATE tx SET height = ? WHERE txid = ?')
    this.setTransactionHasCodeStmt = this.db.prepare('UPDATE tx SET has_code = ? WHERE txid = ?')
    this.setTransactionExecutedStmt = this.db.prepare('UPDATE tx SET executed = ? WHERE txid = ?')
    this.setTransactionIndexedStmt = this.db.prepare('UPDATE tx SET indexed = ? WHERE txid = ?')
    this.hasTransactionStmt = this.db.prepare('SELECT txid FROM tx WHERE txid = ?')
    this.getTransactionHexStmt = this.db.prepare('SELECT hex FROM tx WHERE txid = ?')
    this.getTransactionTimeStmt = this.db.prepare('SELECT time FROM tx WHERE txid = ?')
    this.getTransactionIndexedStmt = this.db.prepare('SELECT indexed FROM tx WHERE txid = ?')
    this.getTransactionDownloadedStmt = this.db.prepare('SELECT hex IS NOT NULL AS downloaded FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?')
    this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getMempoolTransactionsBeforeTimeStmt = this.db.prepare('SELECT txid FROM tx WHERE height IS NULL AND time < ?')
    this.getTransactionsToDownloadStmt = this.db.prepare('SELECT txid FROM tx WHERE hex IS NULL')
    this.getTransactionsDownloadedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE hex IS NOT NULL')
    this.getTransactionsIndexedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1')
    this.getUnexecutedStmt = this.db.prepare(`
      SELECT txid, hex IS NOT NULL AS downloaded, has_code
      FROM tx WHERE (executable = 1 AND executed = 0) OR hex IS NULL
    `)

    this.addDepStmt = this.db.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)')
    this.deleteDepsStmt = this.db.prepare('DELETE FROM deps WHERE down = ?')
    this.getDownstreamStmt = this.db.prepare('SELECT down FROM deps WHERE up = ?')
    this.getUpstreamUnexecuted = this.db.prepare(`
      SELECT txdeps.txid as txid
      FROM (SELECT up AS txid FROM deps WHERE down = ?) as txdeps
      JOIN tx ON tx.txid = txdeps.txid
      WHERE tx.executable = 1 AND tx.executed = 0
    `)
    this.getUnexecutedDepsStmt = this.db.prepare(`
      SELECT deps.up as up, deps.down as down FROM deps
      JOIN tx ON tx.txid = deps.down
      WHERE tx.executable = 1 AND tx.executed = 0
    `)

    this.setJigStateStmt = this.db.prepare('INSERT OR IGNORE INTO jig (location, state) VALUES (?, ?)')
    this.getJigStateStmt = this.db.prepare('SELECT state FROM jig WHERE location = ?')
    this.deleteJigStatesStmt = this.db.prepare('DELETE FROM jig WHERE location LIKE ? || \'%\'')

    this.setBerryStateStmt = this.db.prepare('INSERT OR IGNORE INTO berry (location, state) VALUES (?, ?)')
    this.getBerryStateStmt = this.db.prepare('SELECT state FROM berry WHERE location = ?')
    this.deleteBerryStatesStmt = this.db.prepare('DELETE FROM berry WHERE location LIKE ? || \'%\'')

    this.setTrustedStmt = this.db.prepare('INSERT OR REPLACE INTO trust (txid, value) VALUES (?, ?)')
    this.getTrustlistStmt = this.db.prepare('SELECT txid FROM trust WHERE value = 1')

    this.getHeightStmt = this.db.prepare('SELECT height FROM crawl WHERE role = \'tip\'')
    this.getHashStmt = this.db.prepare('SELECT hash FROM crawl WHERE role = \'tip\'')
    this.setHeightAndHashStmt = this.db.prepare('UPDATE crawl SET height = ?, hash = ? WHERE role = \'tip\'')

    this.trustlist = new Set(this.getTrustlistStmt.raw(true).all().map(row => row[0]))

    this.unexecuted = new Map()
    const readyToExecute = new Set()

    const unexecuted = this.getUnexecutedStmt.raw(true).all()
    for (const [txid, downloaded, hasCode] of unexecuted) {
      const tx = new Tx(txid, downloaded, hasCode)
      this.unexecuted.set(txid, tx)
      const untrusted = hasCode && !this.trustlist.has(txid)
      if (downloaded && !untrusted) readyToExecute.add(tx)
    }

    for (const [up, down] of this.getUnexecutedDepsStmt.raw(true).all()) {
      const uptx = this.unexecuted.get(up)
      if (!uptx) continue
      const downtx = this.unexecuted.get(down)
      downtx.upstream.add(uptx)
      uptx.downstream.add(downtx)
      readyToExecute.delete(downtx)
    }

    readyToExecute.forEach(tx => this._queueForExecution(tx))
  }

  close () {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  transaction (f) {
    if (!this.db) return
    this.db.transaction(f)()
  }

  // --------------------------------------------------------------------------
  // tx
  // --------------------------------------------------------------------------

  addNewTransaction (txid, height = null) {
    if (this.hasTransaction(txid)) return

    const time = Math.round(Date.now() / 1000)

    this.addNewTransactionStmt.run(txid, height, time)

    if (this.onAddTransaction) this.onAddTransaction(txid)

    if (!this.unexecuted.has(txid)) {
      const tx = new Tx(txid, false, null)
      this.unexecuted.set(txid, tx)
    }
  }

  setTransactionHeight (txid, height) {
    this.setTransactionHeightStmt.run(height, txid)
  }

  setTransactionTime (txid, time) {
    this.setTransactionTimeStmt.run(time, txid)
  }

  // Non-executable might be berry data. We execute once we receive them.
  storeParsedNonExecutableTransaction (txid, hex) {
    this.transaction(() => {
      this.setTransactionHexStmt.run(hex, txid)
      this.setTransactionExecutableStmt.run(0, txid)

      const tx = this.unexecuted.get(txid)

      this.unexecuted.delete(txid)

      for (const downtx of tx.downstream) {
        downtx.upstream.delete(tx)

        const queuedForExecution = (!downtx.hasCode || this.trustlist.has(downtx.txid)) &&
          !Array.from(downtx.upstream).some(uptx => !uptx.queuedForExecution)

        if (queuedForExecution) this._queueForExecution(downtx)
      }
    })
  }

  storeParsedExecutableTransaction (txid, hex, hasCode, deps) {
    this.transaction(() => {
      this.setTransactionHexStmt.run(hex, txid)
      this.setTransactionExecutableStmt.run(1, txid)
      this.setTransactionHasCodeStmt.run(hasCode ? 1 : 0, txid)

      const tx = this.unexecuted.get(txid)

      tx.hasCode = hasCode

      for (const deptxid of deps) {
        this.addNewTransaction(deptxid)
        this.addDepStmt.run(deptxid, txid)

        const deptx = this.unexecuted.get(deptxid)
        if (deptx) {
          deptx.downstream.add(tx)
          tx.upstream.add(deptx)
          continue
        }

        if (!this.getTransactionIndexedStmt.get(deptxid).indexed) {
          this.setTransactionExecutionFailed(txid)
          return
        }
      }

      const queuedForExecution = (!hasCode || this.trustlist.has(txid)) &&
        !Array.from(tx.upstream).some(uptx => !uptx.queuedForExecution)

      if (queuedForExecution) {
        this._queueForExecution(tx)
      } else {
        this._dequeueFromExecution(tx)
      }
    })
  }

  storeExecutedTransaction (txid, state) {
    const tx = this.unexecuted.get(txid)
    if (!tx) return

    this.transaction(() => {
      this.setTransactionExecutedStmt.run(1, txid)
      this.setTransactionIndexedStmt.run(1, txid)

      for (const key of Object.keys(state)) {
        if (key.startsWith('jig://')) {
          const location = key.slice('jig://'.length)
          this.setJigStateStmt.run(location, JSON.stringify(state[key]))
          continue
        }

        if (key.startsWith('berry://')) {
          const location = key.slice('berry://'.length)
          this.setBerryStateStmt.run(location, JSON.stringify(state[key]))
          continue
        }
      }

      for (const downtx of tx.downstream) downtx.upstream.delete(tx)
      this.unexecuted.delete(txid)
      if (tx.queuedForExecution) this.numQueuedForExecution--
      tx.queuedForExecution = false

      for (const downtx of tx.downstream) {
        if (downtx.queuedForExecution && !downtx.upstream.size) {
          if (this.onReadyToExecute) this.onReadyToExecute(downtx.txid)
        }
      }
    })
  }

  setTransactionExecutionFailed (txid) {
    const tx = this.unexecuted.get(txid)
    if (!tx) return

    this.transaction(() => {
      this.setTransactionExecutableStmt.run(0, txid)
      this.setTransactionExecutedStmt.run(1, txid)
      this.setTransactionIndexedStmt.run(0, txid)

      this.unexecuted.delete(txid)
      if (tx.queuedForExecution) this.numQueuedForExecution--

      for (const downtx of tx.downstream) {
        this.setTransactionExecutionFailed(downtx.txid)
      }
    })
  }

  getTransactionHex (txid) {
    const row = this.getTransactionHexStmt.raw(true).get(txid)
    return row && row[0]
  }

  getTransactionTime (txid) {
    const row = this.getTransactionTimeStmt.raw(true).get(txid)
    return row && row[0]
  }

  deleteTransaction (txid) {
    this.transaction(() => {
      this.deleteTransactionStmt.run(txid)
      this.deleteJigStatesStmt.run(txid)
      this.deleteBerryStatesStmt.run(txid)
      this.deleteDepsStmt.run(txid)

      const tx = this.unexecuted.get(txid)
      if (tx && tx.queuedForExecution) this.numQueuedForExecution--
      this.unexecuted.delete(txid)

      if (this.onDeleteTransaction) this.onDeleteTransaction(txid)

      const downtxids = this.getDownstreamStmt.raw(true).all(txid).map(row => row[0])
      downtxids.forEach(downtxid => this.deleteTransaction(downtxid))
    })
  }

  hasTransaction (txid) { return !!this.hasTransactionStmt.get(txid) }
  isTransactionDownloaded (txid) { return !!this.getTransactionDownloadedStmt.raw(true).get(txid)[0] }
  getTransactionsAboveHeight (height) { return this.getTransactionsAboveHeightStmt.raw(true).all(height).map(row => row[0]) }
  getMempoolTransactionsBeforeTime (time) { return this.getMempoolTransactionsBeforeTimeStmt.raw(true).all(time).map(row => row[0]) }
  getTransactionsToDownload () { return this.getTransactionsToDownloadStmt.raw(true).all().map(row => row[0]) }
  getDownloadedCount () { return this.getTransactionsDownloadedCountStmt.get().count }
  getIndexedCount () { return this.getTransactionsIndexedCountStmt.get().count }
  getNumQueuedForExecution () { return this.numQueuedForExecution }

  // --------------------------------------------------------------------------
  // deps
  // --------------------------------------------------------------------------

  addMissingDeps (txid, deptxids) {
    const tx = this.unexecuted.get(txid)

    this.transaction(() => {
      if (tx.queuedForExecution) this._dequeueFromExecution(tx)

      for (const deptxid of deptxids) {
        this.addDep(tx, deptxid)
      }

      const queuedForExecution = (!tx.hasCode || this.trustlist.has(tx.txid)) &&
        !Array.from(tx.upstream).some(uptx => !uptx.queuedForExecution)

      if (queuedForExecution) this._queueForExecution(tx)
    })
  }

  addDep (tx, deptxid) {
    this.addNewTransaction(deptxid)
    this.addDepStmt.run(deptxid, deptxid)

    const deptx = this.unexecuted.get(deptxid)
    if (deptx) {
      deptx.downstream.add(tx)
      tx.upstream.add(deptx)
    } else {
      if (!this.getTransactionIndexedStmt.get(deptxid).indexed) {
        this.setTransactionExecutionFailed(tx.txid)
      }
    }
  }

  // --------------------------------------------------------------------------
  // jig
  // --------------------------------------------------------------------------

  getJigState (location) {
    const row = this.getJigStateStmt.raw(true).get(location)
    return row && row[0]
  }

  // --------------------------------------------------------------------------
  // berry
  // --------------------------------------------------------------------------

  getBerryState (location) {
    const row = this.getBerryStateStmt.raw(true).get(location)
    return row && row[0]
  }

  // --------------------------------------------------------------------------
  // trust
  // --------------------------------------------------------------------------

  isTrusted (txid) {
    return this.trustlist.has(txid)
  }

  trust (txid) {
    if (this.trustlist.has(txid)) return
    this.setTrustedStmt.run(txid, 1)
    this.trustlist.add(txid)
    const tx = this.unexecuted.get(txid)
    const queuedForExecution = !Array.from(tx.upstream).some(uptx => !uptx.queuedForExecution)
    if (queuedForExecution) this._queueForExecution(tx)
    if (this.onTrustTransaction) this.onTrustTransaction(txid)
  }

  untrust (txid) {
    if (!this.trustlist.has(txid)) return
    // We don't remove state already calculated
    this.setTrustedStmt.run(txid, 0)
    this.trustlist.delete(txid)
    if (this.onUntrustTransaction) this.onUntrustTransaction(txid)
  }

  getTrustlist () {
    return Array.from(this.trustlist)
  }

  getAllUntrusted () {
    return Array.from(this.unexecuted.values())
      .filter(tx => tx.hasCode && !this.trustlist.has(tx.txid))
      .map(tx => tx.txid)
  }

  getTransactionUntrusted (txid) {
    const untrusted = new Set()
    const visited = new Set([txid])
    const queue = [txid]
    while (queue.length) {
      const next = queue.shift()
      const tx = this.unexecuted.get(next)
      if (tx.hasCode && !this.trustlist.has(next)) untrusted.add(next)
      const upstreamUnexecuted = this.getUpstreamUnexecuted.raw(true).all(next).map(row => row[0])
      upstreamUnexecuted.forEach(uptxid => {
        if (visited.has(uptxid)) return
        visited.add(uptxid)
        queue.push(uptxid)
      })
    }
    return Array.from(untrusted)
  }

  // --------------------------------------------------------------------------
  // crawl
  // --------------------------------------------------------------------------

  getHeight () {
    const row = this.getHeightStmt.raw(true).all()[0]
    return row && row[0]
  }

  getHash () {
    const row = this.getHashStmt.raw(true).all()[0]
    return row && row[0]
  }

  setHeightAndHash (height, hash) {
    this.setHeightAndHashStmt.run(height, hash)
  }

  // --------------------------------------------------------------------------
  // internal
  // --------------------------------------------------------------------------

  _queueForExecution (tx) {
    if (tx.queuedForExecution) return

    tx.queuedForExecution = true

    this.numQueuedForExecution++

    const queue = [tx]

    while (queue.length) {
      const tx = queue.shift()

      for (const downtx of tx.downstream) {
        if (downtx.queuedForExecution) continue

        downtx.queuedForExecution = (!downtx.hasCode || this.trustlist.has(downtx.txid)) &&
          !Array.from(downtx.upstream).some(uptx => !uptx.queuedForExecution)

        if (downtx.queuedForExecution) {
          this.numQueuedForExecution++
          queue.push(downtx)
        }
      }
    }

    if (!tx.upstream.size && this.onReadyToExecute) this.onReadyToExecute(tx.txid)
  }

  _dequeueFromExecution (tx) {
    if (!tx.queuedForExecution) return

    tx.queuedForExecution = false
    this.numQueuedForExecution--

    const queue = [tx]

    while (queue.length) {
      const tx = queue.shift()

      for (const downtx of tx.downstream) {
        if (!downtx.queuedForExecution) continue

        downtx.queuedForExecution = false
        this.numQueuedForExecution--

        queue.push(downtx)
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Database

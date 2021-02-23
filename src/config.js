/**
 * config.js
 *
 * Configuration from environment variables
 */

require('dotenv').config()

// ----------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const API = process.env.API || 'mattercloud'
const MATTERCLOUD_KEY = process.env.MATTERCLOUD_KEY
const PLANARIA_TOKEN = process.env.PLANARIA_TOKEN
const NETWORK = process.env.NETWORK || 'main'
const DB = process.env.DB || 'run.db'
const PORT = process.env.PORT || 0
const WORKERS = process.env.WORKERS || 4
const FETCH_LIMIT = process.env.FETCH_LIMIT || 20
const START_HEIGHT = process.env.START_HEIGHT || (NETWORK === 'test' ? 1382000 : 650000)
const TIMEOUT = process.env.TIMEOUT || 10000

require('axios').default.defaults.timeout = TIMEOUT

// ----------------------------------------------------------------------------------------
// Default trustlist
// ------------------------------------------------------------------------------------------------

const DEFAULT_TRUSTLIST = [
  /**
   * Run ▸ Extras
   */
  '61e1265acb3d93f1bf24a593d70b2a6b1c650ec1df90ddece8d6954ae3cdd915', // asm
  '6fe169894d313b44bd54154f88e1f78634c7f5a23863d1713342526b86a39b8b', // B
  '71fba386341b932380ec5bfedc3a40bce43d4974decdc94c419a94a8ce5dfc23', // expect
  '780ab8919cb89323707338070323c24ce42cdec2f57d749bd7aceef6635e7a4d', // Group
  '90a3ece416f696731430efac9657d28071cc437ebfff5fb1eaf710fe4b3c8d4e', // Group
  '727e7b423b7ee40c0b5be87fba7fa5673ea2d20a74259040a7295d9c32a90011', // Hex
  'b17a9af70ab0f46809f908b2e900e395ba40996000bf4f00e3b27a1e93280cf1', // Token (v1)
  '72a61eb990ffdb6b38e5f955e194fed5ff6b014f75ac6823539ce5613aea0be8', // Token (v2)
  '312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490', // Tx
  '312985bd960ae4c59856b3089b04017ede66506ea181333eec7c9bb88b11c490', // txo

  /**
   * RelayX
   */
  'd792d10294a0d9b05a30049f187a1704ced14840ecf41d00663d79c695f86633', // USDC
  '318d2a009e29cb3a202b2a167773341dcd39809b967889a7e306d504cc266faf', // OKBSV

  /**
   * Run ▸ Extras (testnet)
   */
  '1f0abf8d94477b1cb57629d861376616f6e1d7b78aba23a19da3e6169caf489e', // asm
  '5435ae2760dc35f4329501c61c42e24f6a744861c22f8e0f04735637c20ce987', // B
  'f97d4ac2a3d6f5ed09fad4a4f341619dc5a3773d9844ff95c99c5d4f8388de2f', // expect
  '63e0e1268d8ab021d1c578afb8eaa0828ccbba431ffffd9309d04b78ebeb6e56', // Group
  '03320f1244e509bb421e6f1ff724bf1156182890c3768cfa4ea127a78f9913d2', // Group
  '1f0abf8d94477b1cb57629d861376616f6e1d7b78aba23a19da3e6169caf489e', // Hex
  '72a61eb990ffdb6b38e5f955e194fed5ff6b014f75ac6823539ce5613aea0be8', // Token (v1)
  '7d14c868fe39439edffe6982b669e7b4d3eb2729eee7c262ec2494ee3e310e99', // Token (v2)
  '33e78fa7c43b6d7a60c271d783295fa180b7e9fce07d41ff1b52686936b3e6ae', // Tx
  '33e78fa7c43b6d7a60c271d783295fa180b7e9fce07d41ff1b52686936b3e6ae', // txo

  /**
   * Other
   */
  '24cde3638a444c8ad397536127833878ffdfe1b04d5595489bd294e50d77105a', // B (old)
  'bfa5180e601e92af23d80782bf625b102ac110105a392e376fe7607e4e87dc8d', // Class with logo
  '3f9de452f0c3c96be737d42aa0941b27412211976688967adb3174ee18b04c64' // Tutorial jigs
]

// ------------------------------------------------------------------------------------------------

module.exports = { API, MATTERCLOUD_KEY, PLANARIA_TOKEN, NETWORK, DB, PORT, WORKERS, FETCH_LIMIT, START_HEIGHT, DEFAULT_TRUSTLIST }

'use strict'

import { action, computed, configure, keys, observable, reaction, values } from 'mobx'

import ChannelStore from './ChannelStore'
import IpfsStore from './IpfsStore'
import OrbitStore from './OrbitStore'

import Logger from '../utils/logger'

configure({ enforceActions: 'observed' })

const logger = new Logger()

export default class NetworkStore {
  constructor (rootStore) {
    this.sessionStore = rootStore.sessionStore
    this.settingsStore = rootStore.settingsStore

    this.ipfsStore = new IpfsStore(this)
    this.orbitStore = new OrbitStore(this)

    this.joinChannel = this.joinChannel.bind(this)

    // Stop if user logs out, start if not already online or not starting
    reaction(
      () => this.sessionStore.username,
      username => {
        if (!username) this.stop()
        else if (!(this.isOnline || this.starting)) this.start()
      }
    )
  }

  // Public instance variables

  networkName = 'Orbit DEV Network'

  @observable
  channels = {}

  @observable
  swarmPeers = []

  // Public instance getters

  @computed
  get ipfs () {
    return this.ipfsStore.node
  }

  @computed
  get orbit () {
    return this.orbitStore.node
  }

  @computed
  get isOnline () {
    return this.ipfs && this.orbit
  }

  @computed
  get starting () {
    return this.ipfsStore.starting || this.orbitStore.starting
  }

  @computed
  get hasUnreadMessages () {
    return this.channelsAsArray.some(c => c.hasUnreadMessages)
  }

  @computed
  get channelNames () {
    return keys(this.channels)
  }

  @computed
  get channelsAsArray () {
    return values(this.channels)
  }

  // Private instance actions

  @action.bound
  _onJoinedChannel (channelName) {
    if (this.channelNames.indexOf(channelName) !== -1) return

    this.channels[channelName] = new ChannelStore(
      Object.assign({}, this.orbit.channels[channelName], { network: this })
    )

    // Save the channel to localstorage
    // so user will connect to it automatically next time
    const networkSettings = this.settingsStore.networkSettings
    networkSettings.channels = [
      ...networkSettings.channels.filter(c => c !== channelName),
      channelName
    ]
  }

  @action.bound
  _onLeftChannel (channelName) {
    this._removeChannel(channelName)

    // Remove the channel from localstorage
    const networkSettings = this.settingsStore.networkSettings
    networkSettings.channels = networkSettings.channels.filter(c => c !== channelName)
  }

  @action.bound
  _onSwarmPeerUpdate (peers) {
    this.swarmPeers = peers
  }

  @action.bound
  _removeChannel (channelName) {
    this.channels[channelName].stop()
    delete this.channels[channelName]
  }

  @action.bound
  _resetSwarmPeers () {
    this.swarmPeers = []
  }

  // Private instance methods

  _onOrbitStarted (orbitNode) {
    orbitNode.events.on('joined', this._onJoinedChannel)
    orbitNode.events.on('left', this._onLeftChannel)
    orbitNode.events.on('peers', this._onSwarmPeerUpdate)

    // Join all channnels that are saved in localstorage for current user
    this.settingsStore.networkSettings.channels.map(this.joinChannel)
  }

  _onOrbitStopped (orbitNode) {
    orbitNode.events.removeListener('joined', this._onJoinedChannel)
    orbitNode.events.removeListener('left', this._onLeftChannel)
    orbitNode.events.removeListener('peers', this._onSwarmPeerUpdate)
  }

  // Public instance methods

  async joinChannel (channelName) {
    if (!this.isOnline) throw new Error('Network is not online')
    if (this.channelNames.indexOf(channelName) === -1) {
      await this.orbit.join(channelName)
    }
    return this.channels[channelName]
  }

  async leaveChannel (channelName) {
    if (!this.isOnline) throw new Error('Network is not online')
    if (this.channelNames.indexOf(channelName) !== -1) {
      await this.orbit.leave(channelName)
    }
  }

  async start () {
    if (this.isOnline) return
    logger.info('Starting network')

    await this.ipfsStore.useJsIPFS()
    await this.orbitStore.init(this.ipfs)

    this._onOrbitStarted(this.orbit)
  }

  async stop () {
    if (!this.isOnline) return
    logger.info('Stopping network')

    this.channelNames.map(this._removeChannel)
    this._resetSwarmPeers()
    this._onOrbitStopped(this.orbit)

    await this.orbitStore.stop()
    await this.ipfsStore.stop()
  }
}

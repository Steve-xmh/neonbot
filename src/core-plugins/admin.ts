/**
 * @fileoverview
 * 核心插件 - 管理员指令，可以在机器人会话中操作插件等其他东西
 */

import NeonPlugin, { InitConfig } from '../plugin'
import * as oicq from 'oicq'

let config: InitConfig

function onPrivateMessage (evt: oicq.PrivateMessageEventData) {
    if (config.admins.includes(evt.user_id)) {
        if (evt.raw_message) {
            // evt.reply('Hello')
        }
    }
}

const plugin: NeonPlugin = {
    name: '管理员指令插件',
    id: 'net.stevexmh.neonbot.admin',
    shortName: 'admin',
    async init (initConfig) {
        config = initConfig
    },
    async enable (bot) {
        bot.on('message.private', onPrivateMessage)
    },
    async disable (bot) {
        bot.off('message.private', onPrivateMessage)
    }
}

export default plugin

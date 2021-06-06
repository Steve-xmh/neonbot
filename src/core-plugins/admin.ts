/**
 * @fileoverview
 * 核心插件 - 管理员指令，可以在机器人会话中操作插件等其他东西
 */

import NeonPlugin, { InitConfig } from '../plugin'
import * as oicq from 'oicq'
import { BotProxy } from '../botproxy'
import { logger } from '..'

let config: InitConfig

async function onPrivateMessage (this: BotProxy, evt: oicq.PrivateMessageEventData) {
    if (config.admins.includes(evt.user_id)) {
        if (evt.raw_message.startsWith('.')) {
            const args = evt.raw_message.match(/"[^"]*"|[^\s"]+/g)!!.map(v => {
                if (v.startsWith('"') && v.endsWith('"')) {
                    return v.substring(1, v.length - 1)
                } else {
                    return v
                }
            })
            switch (args[0]) {
            case '.plugins':
            {
                const plugins = await this.getListPlugin()
                logger.debug('插件', plugins)
                // await evt.reply(Object.keys(plugins).join('\n'))
                break
            }
            default:
            {
                await evt.reply('未知的指令：' + args[0])
            }
            }
        }
    }
}

async function onOnline (this: BotProxy, evt: oicq.OnlineEventData) {
    for (const admin of config.admins) {
        await this.sendPrivateMsg(admin, 'NeonBot 已上线，正在运行框架')
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
        bot.on('system.online', onOnline)
    },
    async disable (bot) {
        bot.off('message.private', onPrivateMessage)
    }
}

export default plugin

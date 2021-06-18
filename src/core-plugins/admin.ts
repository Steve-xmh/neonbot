/**
 * @fileoverview
 * 核心插件 - 管理员指令，可以在机器人会话中操作插件等其他东西
 */

import NeonPlugin, { InitConfig } from '../plugin'
import * as oicq from 'oicq'
import { BotProxy } from '../botproxy'
import * as os from 'os'

let config: InitConfig
const startTime = Date.now() / 1000

function getCpuInfo () {
    const cpus = os.cpus()
    let idle = 0
    let total = 0
    for (const cpu of cpus) {
        idle += cpu.times.idle
        total += cpu.times.idle + cpu.times.irq + cpu.times.nice + cpu.times.sys + cpu.times.user
    }
    return {
        idle,
        total
    }
}

function getCPUUsage (): Promise<number> {
    return new Promise((resolve) => {
        const startInfo = getCpuInfo()
        setTimeout(() => {
            const endInfo = getCpuInfo()
            resolve(1 - ((endInfo.idle - startInfo.idle) / (endInfo.total - startInfo.total)))
        }, 1000)
    })
}

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
                if (args.length === 1) {
                    // List plugins
                    const plugins = await this.getListPlugin()
                    const msgs = Object.keys(plugins).map(pluginId => `${plugins[pluginId].id} - ${plugins[pluginId].name || plugins[pluginId].shortName}`)
                    await evt.reply('目前已搜索到的插件：\n' + msgs.join('\n'))
                } else if (args.length === 3) {
                    switch (args[1]) {
                    case 'enable':
                    {
                        const plugins = await this.getListPlugin()
                        if (args[2] in plugins) {
                            await this.enablePlugin(args[2])
                            await evt.reply('成功对本机器人启用了插件 ' + args[2])
                        } else {
                            await evt.reply('错误：找不到 ID 为 ' + args[2] + ' 的插件')
                        }
                        break
                    }
                    case 'disable':
                    {
                        const plugins = await this.getListPlugin()
                        if (args[2] in plugins) {
                            await this.disablePlugin(args[2])
                            await evt.reply('成功对本机器人禁用了插件 ' + args[2])
                        } else {
                            await evt.reply('错误：找不到 ID 为 ' + args[2] + ' 的插件')
                        }
                        break
                    }
                    case 'reload':
                    {
                        const plugins = await this.getListPlugin()
                        if (args[2] in plugins) {
                            await this.reloadPlugin(args[2])
                            await evt.reply('成功重启了插件 ' + args[2])
                        } else {
                            await evt.reply('错误：找不到 ID 为 ' + args[2] + ' 的插件')
                        }
                        break
                    }
                    case 'restart':
                    {
                        const plugins = await this.getListPlugin()
                        if (args[2] in plugins) {
                            await this.reloadPlugin(args[2])
                            await evt.reply('成功重启了插件 ' + args[2])
                        } else {
                            await evt.reply('错误：找不到 ID 为 ' + args[2] + ' 的插件')
                        }
                        break
                    }
                    }
                } else {
                    await evt.reply([
                        '帮助：.plugins [enable|disable|reload [插件ID]]',
                        '.plugins - 列出所有可用插件',
                        '.plugins enable (插件ID) - 对本机器人账户启用指定插件',
                        '.plugins disable (插件ID) - 对本机器人账户禁用指定插件',
                        '.plugins reload (插件ID) - 对所本机器人重载指定插件',
                        '.plugins restart (插件ID) - 对所有机器人重新启动指定插件'
                    ].join('\n'))
                }
                break
            }
            case '.status':
            {
                const currentTime = Date.now() / 1000
                const runningTime = currentTime - startTime
                let formatedTime = ''
                let reply = ''
                formatedTime = Math.floor(runningTime % 60) + ' 秒' + formatedTime
                if (runningTime / 60 >= 1) { formatedTime = Math.floor((runningTime / 60) % 60) + ' 分 ' + formatedTime }
                if (runningTime / 3600 >= 1) { formatedTime = Math.floor((runningTime / 3600) % 24) + ' 时 ' + formatedTime }
                if (runningTime / 86400 >= 1) { formatedTime = Math.floor(runningTime / 86400) + ' 天 ' + formatedTime }
                reply += '框架运行时间：' + formatedTime
                const usage = await getCPUUsage()
                reply += '\n' + 'CPU 当前占用：' + (usage * 100).toFixed(1) + '%'
                evt.reply(reply)
                break
            }
            case '.help':
            {
                await evt.reply([
                    '--- NeonBot 使用帮助 ---',
                    '.plugins - 列出所有可用插件',
                    '.plugins enable (插件ID) - 对本机器人账户启用指定插件',
                    '.plugins disable (插件ID) - 对本机器人账户禁用指定插件',
                    '.plugins reload (插件ID) - 对所本机器人重载指定插件',
                    '.plugins restart (插件ID) - 对所有机器人重新启动指定插件',
                    '.status - 输出当前框架运行状态',
                    '.help - 显示此帮助'
                ].join('\n'))
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

let offlineTime: Date

function getDuration (t: Date) {
    let d = Math.floor((new Date().getTime() - t.getTime()) / 1000)
    let result = '前'
    result = d % 60 + ' 秒' + result
    d = Math.floor(d / 60)
    if (d % 60) {
        result = d % 60 + ' 分 ' + result
        d = Math.floor(d / 60)
        if (d % 24) {
            result = d % 24 + ' 时 ' + result
            d = Math.floor(d / 24)
            if (d > 0) {
                result = d + ' 天 ' + result
            }
        }
    }
    return result
}

async function onOffline (this: BotProxy, evt: oicq.OfflineEventData) {
    offlineTime = new Date()
}

async function onOnline (this: BotProxy, evt: oicq.OnlineEventData) {
    for (const admin of config.admins) {
        if (offlineTime) {
            await this.sendPrivateMsg(admin, `NeonBot 在${getDuration(offlineTime)} (${offlineTime.toLocaleString('zh-cn')}) 断开连接，现已重新上线`)
        } else {
            await this.sendPrivateMsg(admin, 'NeonBot 已上线，正在运行框架，发送 .help 以查看指令帮助')
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
        bot.randomHashedMessage = true // 防止消息被清除
        bot.on('message.private', onPrivateMessage)
        bot.on('system.online', onOnline)
        bot.on('system.offline', onOffline)
    },
    async disable (bot) {
        bot.off('message.private', onPrivateMessage)
    }
}

export default plugin

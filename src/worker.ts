import { Client, createClient } from 'oicq'
import { parentPort } from 'worker_threads'
import { logger } from '.'
import { accpetableEvents, BotProxy } from './botproxy'
import corePlugins from './core-plugins'
import { messages } from './messages'
import NeonPlugin from './plugin'
import { randonID } from './utils'

let bot: Client
let plugin: NeonPlugin
const botProxies = new Map<number, BotProxy>()

export async function onWorkerMessage (message: messages.BaseMessage) {
    switch (message.type) {
    case 'deploy-worker':
    {
        const data = message.value as messages.DeployWorkerData
        if (data.workerType === messages.WorkerType.Bot) {
            logger.info('正在登录账户')
            const qqid = (data as messages.DeployBotWorkerData).qqid
            const config = (data as messages.DeployBotWorkerData).config
            bot = createClient(qqid, {
                log_level: 'off',
                ...config
            })
            bot.on('system.online', () => {
                logger.info('账户已登录上线，开始接收消息')
            })
            bot.on('system.offline', (event) => {
                logger.warn('账户已离线，正在重新登录')
            })
            bot.on('system.login', (event) => {
                switch (event.sub_type) {
                case 'device': {
                    logger.warn('检测到设备锁，请完成验证后重启机器人以继续登录', event.url)
                    break
                }
                case 'error': {
                    logger.error('登录账户失败', `#${event.code}`, event.message)
                    break
                }
                case 'slider': {
                    logger.warn('检测到滑动验证，请完成验证后后在控制台内输入', 'verify ' + qqid + ' [token]', '以继续登录', event.url)
                    break
                }
                }
            })
            for (const eventName of accpetableEvents) {
                bot.on(eventName, (data) => {
                    data.eventName = eventName
                    if ('reply' in data) {
                        delete data.reply
                    }
                    const postData: messages.NodeOICQEventMessage = {
                        id: randonID(),
                        type: 'node-oicq-event',
                        value: data
                    }
                    parentPort!!.postMessage(postData)
                })
            }
            bot.login(config.password)
        } else if (data.workerType === messages.WorkerType.CorePlugin) {
            const pluginId = (data as messages.DeployCorePluginWorkerData).pluginId
            const config = (data as messages.DeployCorePluginWorkerData).config
            config.logger = logger
            logger.info('正在初始化核心插件', pluginId)
            const iplugin = corePlugins.find((v) => v.id === pluginId)
            if (iplugin) {
                plugin = iplugin
                if (plugin.init) await plugin.init(config)
                logger.info('核心插件初始化完毕')
            } else {
                logger.error('找不到核心插件', pluginId)
            }
        } else if (data.workerType === messages.WorkerType.Plugin) {
            logger.info('正在初始化插件')
        }
        break
    }
    case 'enable-plugin':
    {
        const qqid = (message as messages.SetPluginMessage).value.qqId
        if (!botProxies.has(qqid)) {
            const proxy = new BotProxy(qqid)
            if (plugin.enable) await plugin.enable(proxy)
            botProxies.set(qqid, proxy)
        }
        break
    }
    case 'disable-plugin':
    {
        const qqid = (message as messages.SetPluginMessage).value.qqId
        if (botProxies.has(qqid)) {
            const proxy = botProxies.get(qqid)
            if (proxy) {
                if (plugin.disable) await plugin.disable(proxy)
                botProxies.delete(qqid)
            }
        }
        break
    }
    case 'node-oicq-event':
    {
        // 在 BotProxy 内实现
        break
    }
    case 'node-oicq-invoke':
    {
        const data = message as messages.NodeOICQInvokeMessage
        const invokeData = data.value
        if (typeof (bot as any)[invokeData.methodName] === 'function') {
            const result = (bot as any)[invokeData.methodName](...invokeData.arguments)
            if (result instanceof Promise) {
                try {
                    parentPort!!.postMessage({
                        id: data.id,
                        succeed: true,
                        value: await result
                    } as messages.BaseResult)
                } catch (err) {
                    parentPort!!.postMessage({
                        id: data.id,
                        succeed: false,
                        value: err
                    } as messages.BaseResult)
                }
            } else {
                parentPort!!.postMessage({
                    id: data.id,
                    succeed: true,
                    value: result
                } as messages.BaseResult)
            }
        } else {
            parentPort!!.postMessage({
                id: data.id,
                succeed: false,
                value: `找不到 ${invokeData.methodName} 调用方法`
            } as messages.BaseResult)
        }
        break
    }
    case 'verify-message':
    {
        if (bot) {
            bot.sliderLogin(message.value.token)
        } else {
            logger.warn('机器人尚未初始化，无法验证！')
        }
        break
    }
    default:
    {
        logger.warn('未知（或暂未实现）的通信消息类型：', message.type)
    }
    }
}

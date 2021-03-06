import { isMainThread, parentPort, threadId, workerData } from 'worker_threads'
import * as log4js from 'log4js'
import { ConfBot, constants } from 'oicq'
import { resolve } from 'path'
import { setupConsole } from './console'
import corePlugins from './core-plugins'
import { createBotWorker, createCorePluginWorker, NeonWorker, onWorkerMessage } from './worker'
import { enablePlugin, listPlugins } from './plugin'
import { clearConfigLock, loadConfig } from './config'

export type { NeonPlugin, InitConfig } from './plugin'
export type { BotProxy, BotProxyError } from './botproxy'

export const logger = log4js.getLogger(workerData?.logger || '[NeonBot]')
logger.level = workerData?.loggerLevel || 'info'

export interface AccountConfig {
    /**
     * 账户的密码，可以使用明文字符串或 MD5 后的 Buffer
     * 为了你的账户安全，推荐通过使用环境变量导入而不是直接写在配置文件内
     */
    password: string | Buffer,
    /** 需要让机器人模拟运行的设备环境，默认为 `Platform.AndroidPhone` */
    // eslint-disable-next-line no-use-before-define
    platform?: Platform,
}

/**
 * 机器人的配置数据结构
 */
export interface NeonBotConfig {
    /**
     * 用于搜索插件的目录清单，如果为空则为配置文件同文件夹中的 plugins 文件夹
     */
    pluginSearchPath?: string[]
    /**
     * 用于保存插件自身配置数据的文件路径，默认和配置文件同目录且命名为 `plugins.json`
     */
    pluginDataFile?: string
    /**
     * 日志输出的等级，将会通用至所有线程，机器人线程中的日志输出等级将会优先于此配置，默认为 `info`
     */
    loggerLevel?: string
    /**
     * 最高管理员的 QQ 号码，只有在此列表的用户可以与核心插件交互
     */
    admins: number[]
    /**
     * 需要作为机器人的 QQ 账户配置，键值为 QQ 号码
     */
    accounts: { [qqid: number]: AccountConfig & ConfBot }
    /**
     * 数据存储文件夹，如果为空则为配置文件同文件夹中的 data 文件夹
     */
    dataDir?: string
}

/**
 * 需要让机器人模拟运行的设备环境，不同环境可能会导致部分事件或功能无法触发或使用，默认为 `Platform.AndroidPhone`
 */
export enum Platform {
    /** 安卓手机设备（默认） */
    // eslint-disable-next-line no-unused-vars
    AndroidPhone = constants.PLATFORM_ANDROID,
    /** 安卓平板设备 */
    // eslint-disable-next-line no-unused-vars
    AndroidTablet = constants.PLATFORM_APAD,
    /** 安卓手表设备 */
    // eslint-disable-next-line no-unused-vars
    AndroidWatch = constants.PLATFORM_WATCH,
    /** 苹果电脑系统 */
    // eslint-disable-next-line no-unused-vars
    MacOS = constants.PLATFORM_IMAC,
    /** 苹果平板设备 */
    // eslint-disable-next-line no-unused-vars
    IPad = constants.PLATFORM_IPAD
}

export const pluginWorkers = new Map<string, NeonWorker>()
export const corePluginWorkers = new Map<string, NeonWorker>()
export const botWorkers = new Map<number, NeonWorker>()
export const indexPath = __filename
export let config: NeonBotConfig

async function main () {
    logger.info('线程 ID', threadId)
    if (isMainThread) {
        logger.info('NeonBot - by SteveXMH')
        if (process.argv.length < 3) {
            logger.info('使用方式：npm start [配置文件路径]')
        } else {
            const configPath = process.argv[process.argv.length - 1]
            logger.info('正在加载配置文件', configPath)
            try {
                config = require(configPath) as NeonBotConfig
            } catch (err) {
                logger.fatal('无法加载配置文件，请检查配置文件是否正确：', err)
                process.exit(1)
            }
            if (config.loggerLevel) {
                logger.level = config.loggerLevel
            }
            setupConsole()
            config.admins = config.admins || []
            config.pluginSearchPath = config.pluginSearchPath || [resolve(configPath, '../plugins')]
            config.pluginDataFile = config.pluginDataFile || resolve(configPath, '../plugins.json')
            if (config.admins.length === 0) {
                logger.fatal('请至少在配置文件内设置一名最高管理员，否则你将无法在聊天窗口内操作机器人！')
                process.exit(1)
            }
            if (!config.pluginDataFile) {
                logger.fatal('请在配置文件里设置插件数据文件路径，否则插件将无法保存自身数据！')
                process.exit(1)
            }
            if (config.pluginSearchPath.length === 0) {
                config.pluginSearchPath.push(resolve(configPath, '../plugins'))
            }
            config.dataDir = config.dataDir || resolve(configPath, '../data')
            logger.info('机器人数据文件夹：', config.dataDir)
            clearConfigLock()
            // Launch bots
            logger.info('正在启动机器人线程')
            for (const qqid in config.accounts) {
                botWorkers.set(parseInt(qqid), createBotWorker(parseInt(qqid)))
            }
            // Launch core plugins
            logger.info('正在启动核心插件线程')
            for (const plugin of corePlugins) {
                corePluginWorkers.set(plugin.id, createCorePluginWorker(plugin))
            }
            // Launch user plugins
            logger.info('正在读取插件配置文件')
            const pluginConfigs = await loadConfig()
            const plugins = await listPlugins()
            logger.info('正在加载已启用的插件')
            for (const pluginId in plugins) {
                const plugin = plugins[pluginId]
                const pluginConfig = pluginConfigs[pluginId]
                if (pluginConfig) {
                    const canEnable = !!pluginConfig.enabledQQIds.find(v => [...botWorkers.keys()].includes(v))
                    if (canEnable) {
                        for (const qqId of pluginConfig.enabledQQIds) {
                            if (botWorkers.has(qqId)) {
                                await enablePlugin(qqId, plugin.id)
                            }
                        }
                    }
                }
            }
            logger.info('初始化完成！输入 help 以查看命令行帮助')
            logger.info('你也可以通过管理员账户发送 .help 查看聊天管理帮助')
        }
    } else {
        parentPort!!.on('message', onWorkerMessage)
    }
}

main()

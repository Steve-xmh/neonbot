/**
 * @fileoverview
 * 插件的类型定义
 */

import { BotProxy } from './botproxy'
import { Logger } from 'log4js'
import { botWorkers, config, logger, pluginWorkers } from '.'
import { createPluginWorker } from './worker'
import { MessageChannel } from 'worker_threads'
import { messages } from './messages'
import { readdir, stat } from 'fs/promises'
import { resolve } from 'path'
import { loadConfig, saveConfig } from './config'
import { format } from 'util'

/**
 * 一个初始化时会被传递的配置对象
 */
export interface InitConfig<D = any> {
    /** 配置文件中定义的管理员 QQID 列表 */
    admins: number[]
    /** 可以随意使用的 log4js.Logger 记录对象 */
    logger: Logger,
    /** 插件上一次退出时保存的全局数据 */
    pluginData: D
}

/**
 * 一个插件对象，包含了与 NeonBot 交互的各个接口
 */
export interface NeonPlugin {
    /**
     * 插件的名称
     */
    name?: string
    /**
     * 插件的 ID，推荐以 Java 包名的方式命名（net.bob.plugin）
     */
    id: string
    /**
     * 插件的短名，用于记录器（logger）的类型标识
     */
    shortName: string
    /**
     * 插件初始化函数，这将在启动 NeonBot 创建插件线程时第一个被调用
     */
    init?: (config: InitConfig) => Promise<void>
    /**
     * 插件在一个机器人上被启用或重载后调用，此时可以处理相关的机器人操作
     * @param pluginData 上一次插件于此机器人禁用时保存的局部机器人数据
     */
    enable?: (bot: BotProxy, pluginData: any) => Promise<void>
    /**
     * 插件在一个机器人上被禁用、关闭或重载前调用，此时可以处理相关的机器人操作
     *
     * 为了良好的代码习惯，请在此解除挂载一系列先前挂载的事件
     *
     * @returns 返回值将会作为局部机器人数据保存
     */
    disable?: (bot: BotProxy) => Promise<any>
    /**
     * 插件卸载函数，将在插件被完全禁用时或 NeonBot 将要关闭时调用，请在此处立即处理需要关闭的东西
     *
     * @returns 返回值将会作为全局插件数据保存
     */
    uninit?: () => Promise<any>
}

export interface PluginInfos {
    [pluginKey: string]: {
        id: string,
        shortName: string,
        name?: string,
        pluginPath: string
    }
}

export async function listPluginErrorOutputs () {
    const result: string[] = []
    for (const subdir of config.pluginSearchPath || []) {
        try {
            const plugins = await readdir(subdir)
            for (const pluginDir of plugins) {
                try {
                    const pluginPath = resolve(subdir, pluginDir)
                    const fullPath = require.resolve(pluginPath)
                    if (!(await stat(pluginPath)).isDirectory()) {
                        result.push(format('位于', resolve(subdir, pluginDir), '的文件夹不存在插件'))
                        continue
                    }
                    delete require.cache[fullPath]
                    const plugin = require(pluginPath) as NeonPlugin
                    if (!plugin.id) {
                        result.push(format('位于', resolve(subdir, pluginDir), '的插件没有提供插件 ID'))
                        continue
                    }
                    if (!plugin.shortName) {
                        result.push(format('位于', resolve(subdir, pluginDir), '的插件没有提供插件短名'))
                        continue
                    }
                } catch (err) {
                    // logger.warn('读取插件时发生错误', subdir, err)
                    result.push(format('无法读取位于 ' + resolve(subdir, pluginDir), '的插件：', err))
                }
            }
        } catch (err) {
            logger.warn('搜索插件文件夹时发生错误', subdir, err)
            result.push(format('无法搜索插件文件夹', resolve(subdir)))
        }
    }
    return result
}

export async function listPlugins () {
    const result: PluginInfos = {}
    for (const subdir of config.pluginSearchPath || []) {
        try {
            const plugins = await readdir(subdir)
            for (const pluginDir of plugins) {
                try {
                    const pluginPath = resolve(subdir, pluginDir)
                    const fullPath = require.resolve(pluginPath)
                    if (!(await stat(pluginPath)).isDirectory()) continue
                    delete require.cache[fullPath]
                    const plugin = require(pluginPath) as NeonPlugin
                    if (!plugin.id) continue
                    if (!plugin.shortName) continue
                    result[plugin.id] = ({
                        id: plugin.id,
                        shortName: plugin.shortName,
                        name: plugin.name,
                        pluginPath: pluginPath
                    })
                } catch (err) {
                    logger.warn('读取插件时发生错误', subdir, err)
                }
            }
        } catch (err) {
            logger.warn('搜索插件文件夹时发生错误', subdir, err)
        }
    }
    return result
}

/**
 *  对 QQ 账户启用插件并写入配置文件
 * @param qqId QQ 账户
 * @param pluginId 插件 ID
 */
export async function enablePlugin (qqId: number, pluginId: string) {
    if (!botWorkers.has(qqId)) throw new Error('机器人 ' + qqId + ' 不存在')
    const plugins = await listPlugins()
    if (pluginId in plugins) {
        const plugin = plugins[pluginId]
        const pluginConfigs = await loadConfig()
        pluginConfigs[pluginId] = pluginConfigs[pluginId] || {
            enabledQQIds: [],
            localSavedData: {},
            savedData: undefined
        }
        pluginConfigs[pluginId].enabledQQIds = pluginConfigs[pluginId].enabledQQIds.filter(v => v !== qqId)
        pluginConfigs[pluginId].enabledQQIds.push(qqId)
        await saveConfig()
        if (!pluginWorkers.has(pluginId)) {
            const pluginWorker = await createPluginWorker(plugin.pluginPath, plugin.id, plugin.shortName, plugin.name)
            pluginWorkers.set(pluginId, pluginWorker)
        }
        const pluginWorker = pluginWorkers.get(pluginId)
        const ports = new MessageChannel()
        botWorkers.get(qqId)!!.postMessage({
            type: 'connect-plugin',
            value: {
                port: ports.port1,
                pluginType: messages.WorkerType.Plugin
            }
        } as messages.ConnectPluginMessage, [ports.port1])
        const pluginData = pluginConfigs[pluginId].localSavedData[qqId]
        pluginWorker!!.postMessage({
            type: 'enable-plugin',
            value: { qqId, port: ports.port2, pluginData }
        } as messages.SetPluginMessage, [ports.port2])
        logger.info('已对 ' + qqId + ' 启用插件(线程)  ' + pluginId)
    } else {
        throw new Error('未找到插件 ' + pluginId + ' 可供机器人 ' + qqId + ' 使用')
    }
}

/**
 * 对 QQ 账户禁用插件并写入配置文件
 * @param qqId QQ 账户
 * @param pluginId 插件 ID
 */
export async function disablePlugin (qqId: number, pluginId: string) {
    if (!botWorkers.has(qqId)) throw new Error('机器人 ' + qqId + ' 不存在')
    const plugins = await listPlugins()
    if (pluginId in plugins) {
        const pluginConfigs = await loadConfig()
        pluginConfigs[pluginId] = pluginConfigs[pluginId] || {
            enabledQQIds: [],
            localSavedData: {},
            savedData: undefined
        }
        pluginConfigs[pluginId].enabledQQIds = pluginConfigs[pluginId].enabledQQIds.filter(v => v !== qqId)
        await saveConfig()
        const pluginWorker = pluginWorkers.get(pluginId)
        pluginWorker?.postMessage({
            type: 'disable-plugin',
            value: { qqId }
        } as messages.SetPluginMessage)
    } else {
        throw new Error('未找到插件 ' + pluginId)
    }
}

/**
 * 如果正在运行，发送 disable-plugin 禁用插件并关闭线程
 */
export async function stopPlugin (qqId: number, pluginId: string) {
    const plugins = await listPlugins()
    if (pluginId in plugins) {
        const plugin = pluginWorkers.get(pluginId)
        if (plugin) {
            plugin.postMessage({
                type: 'disable-plugin',
                value: {
                    qqId
                }
            } as messages.SetPluginMessage)
        }
    } else {
        throw new Error('未找到插件 ' + pluginId)
    }
}

/**
 * 如果正在运行，立刻停止插件线程的运行，且不发送 disable-plugin 以禁用插件
 */
export async function shutdownPlugin (pluginId: string) {
    const plugins = await listPlugins()
    if (pluginId in plugins) {
        const plugin = pluginWorkers.get(pluginId)
        pluginWorkers.delete(pluginId)
        if (plugin) {
            logger.info('正在中止插件线程 ' + pluginId)
            await plugin.terminate()
            logger.info('插件 ' + pluginId + ' 已终止')
        }
    } else {
        throw new Error('未找到插件 ' + pluginId)
    }
}

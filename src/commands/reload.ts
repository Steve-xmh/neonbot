import { Command } from '.'
import { botWorkers, corePluginWorkers, logger, pluginWorkers } from '..'
import { loadConfig } from '../config'
import corePlugins from '../core-plugins'
import { enablePlugin, listPlugins } from '../plugin'
import { createBotWorker, createCorePluginWorker, createPluginWorker } from '../worker'

const reload: Command = {
    description: '重启插件或机器人',
    usage: 'reload (bot|plugin|coreplugin) PLUGIN_OR_BOT_ID',
    async exec (args) {
        if (args.length !== 3) {
            return logger.info('指令帮助：reload (bot|plugin|coreplugin) PLUGIN_OR_BOT_ID')
        }
        if (args[1] === 'bot') {
            const qqId = parseInt(args[2])
            const bot = botWorkers.get(qqId)
            if (bot) {
                await bot.terminate()
                const botWorker = createBotWorker(qqId)
                botWorkers.set(qqId, botWorker)
                return logger.info('已重新启动机器人 #' + qqId)
            } else {
                return logger.error('找不到指定机器人 QQID 的工作线程')
            }
        } else if (args[1] === 'plugin') {
            const pluginId = args[2]
            const pluginWorker = pluginWorkers.get(pluginId)
            if (pluginWorker) {
                await pluginWorker.terminate()
                const pluginConfigs = await loadConfig()
                const plugins = await listPlugins()
                if (pluginId in plugins) {
                    const pluginConfig = pluginConfigs[pluginId]
                    const plugin = plugins[pluginId]
                    const newPluginWorker = createPluginWorker(plugin.pluginPath, plugin.id, plugin.shortName, plugin.name)
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
                    pluginWorkers.set(pluginId, newPluginWorker)
                }
                return logger.info('已重新启动插件 ' + pluginId)
            } else {
                return logger.error('找不到指定插件 ID 的工作线程，可能是插件不存在或插件未被启用')
            }
        } else if (args[1] === 'coreplugin') {
            const pluginId = args[2]
            const pluginWorker = corePluginWorkers.get(pluginId)
            if (pluginWorker) {
                await pluginWorker.terminate()
                const plugin = corePlugins.find(v => v.id === pluginId)
                if (plugin) {
                    corePluginWorkers.set(pluginId, createCorePluginWorker(plugin))
                } else {
                    return logger.error('找不到指定核心插件，这应该是内部错误而不是插件不存在的问题')
                }
                return logger.info('已重新启动插件 ' + pluginId)
            } else {
                return logger.error('找不到指定核心插件 ID 的工作线程，可能是核心插件不存在或核心插件未被启用')
            }
        } else {
            return logger.info('指令帮助：reload (bot|plugin|coreplugin) PLUGIN_OR_BOT_ID')
        }
    }
}

export default reload

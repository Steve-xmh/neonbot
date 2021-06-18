import { Command } from '.'
import { botWorkers, corePluginWorkers, logger } from '..'
import { loadConfig } from '../config'
import { messages } from '../messages'
import { stopPlugin } from '../plugin'

const stop: Command = {
    description: '关闭 NeonBot [尚未实现]',
    usage: 'stop',
    async exec (args) {
        logger.warn('正在关闭 NeonBot！')
        // 停止插件线程
        logger.info('正在停止插件线程')
        const pluginConfigs = await loadConfig()
        await Promise.all(Object.keys(pluginConfigs).map(pluginId => Promise.all(pluginConfigs[pluginId].enabledQQIds.map(qqId => stopPlugin(qqId, pluginId)))))
        // 停止核心插件线程
        logger.info('正在停止核心插件线程')
        for (const [, corePluginWorker] of corePluginWorkers) {
            await Promise.all([...botWorkers.keys()].map(qqId => new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    corePluginWorker.terminate()
                })
                corePluginWorker.once('exit', () => {
                    clearTimeout(timeout)
                    resolve()
                })
                corePluginWorker.postMessage({
                    type: 'disable-plugin',
                    value: { qqId }
                } as messages.SetPluginMessage)
            })))
        }
        // 停止机器人线程
        logger.info('正在停止机器人线程')
        await Promise.all([...botWorkers.values()].map(botWorker => new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                botWorker.terminate()
            })
            botWorker.once('exit', () => {
                clearTimeout(timeout)
                resolve()
            })
            botWorker.postMessage({
                type: 'stop-bot'
            } as messages.StopBotMessage)
        })))
        logger.warn('所有线程已停止！正在退出')
        process.exit()
    }
}

export default stop

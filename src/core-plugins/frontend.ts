/**
 * @fileoverview
 * 一个配备了前端管理功能的核心脚本，提供网页上控制机器人的能力
 */

import { logger } from '..'
import { InitConfig, NeonPlugin } from '../plugin'

let config: InitConfig<{
    disabled?: boolean,
    port?: number
}>

const plugin: NeonPlugin = {
    name: '前端管理插件',
    id: 'net.stevexmh.neonbot.frontend',
    shortName: 'frontend',
    async init (initConfig) {
        config = initConfig
        config.pluginData = config.pluginData || {}
        if (config.pluginData.port) {
            if (config.pluginData.port >= 0) {
                logger.info('前端管理核心正在运行（其实并没有，还在开发中）')
            }
        } else {
            logger.warn('若需使用前端管理核心插件，请在配置文件中设置 \'net.stevexmh.neonbot.frontend\'.savedData.port 启用端口以启用前端管理')
            logger.warn('如不需要，将其设置为 -1 即可禁用本提示')
        }
    },
    async uninit () {
        return config.pluginData
    }
}
export default plugin

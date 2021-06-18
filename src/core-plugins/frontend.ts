/**
 * @fileoverview
 * 一个配备了前端管理功能的核心脚本，提供网页上控制机器人的能力
 */

import { logger } from '..'
import NeonPlugin, { InitConfig } from '../plugin'

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
            logger.info('前端管理核心正在运行')
        } else {
            logger.warn('若需使用前端管理核心插件，请在配置文件中设置 ')
        }
    },
    async uninit () {
        return config.pluginData
    }
}
export default plugin

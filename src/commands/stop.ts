import { Command } from '.'
import { logger } from '..'

const stop: Command = {
    description: '关闭 NeonBot [尚未实现]',
    usage: 'stop',
    exec (args) {
        logger.warn('正在关闭 NeonBot！')
    }
}

export default stop

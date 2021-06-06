import { Command } from '.'
import { logger } from '..'

const help: Command = {
    description: '关闭 NeonBot',
    usage: 'stop',
    exec (args) {
        logger.warn('正在关闭 NeonBot！')
    }
}

export default help

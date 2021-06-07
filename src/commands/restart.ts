import { Command } from '.'
import { logger } from '..'

const restart: Command = {
    description: '重启 NeonBot [尚未实现]',
    usage: 'restart',
    exec (args) {
        logger.warn('正在重启 NeonBot！')
    }
}

export default restart
